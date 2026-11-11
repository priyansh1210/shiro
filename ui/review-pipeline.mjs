// The review pipeline the Shiro app runs. Instead of one "orchestrator" Claude session that reads files
// and coordinates subagents (which re-reads its whole context every turn), the app does the plumbing
// for free and gives each agent exactly one turn, with everything it needs pasted into its prompt.
// Same agents, same instructions, same model: just no wasted tokens.
//
//   free:   read the JD, extract resume text, pre-rank resumes, write files, build HTML + PDF, summary
//   Claude: resume-picker (top 3 only) → reviewers in parallel → debrief → resume-writer

import fs from 'node:fs';
import path from 'node:path';
import { cachedText, writeCache } from '../tools/resume-text.mjs';
import { convertFile } from '../tools/resume-html.mjs';
import { htmlToPdf, pdfPages } from '../tools/html-to-pdf.mjs';

export const PANEL = ['ats', 'recruiter', 'hiring-manager', 'teammate', 'rival-applicant', 'ceo', 'technical-interviewer', 'skeptic', 'design-lead', 'skip-level-manager', 'hr-screener'];
export const AGENTS = ['resume-picker', ...PANEL, 'debrief', 'resume-writer'];
export const AGENT_EFFORTS = ['low', 'medium', 'high'];
export const RECOMMENDED = {
  'resume-picker': 'low', ats: 'low', recruiter: 'low', 'hiring-manager': 'medium', teammate: 'low',
  'rival-applicant': 'medium', ceo: 'low', 'technical-interviewer': 'medium', skeptic: 'medium', 'design-lead': 'medium',
  'skip-level-manager': 'low', 'hr-screener': 'low', debrief: 'medium', 'resume-writer': 'high',
};
const MEMORY_FOR_WRITER = ['profile', 'experience', 'education', 'projects', 'certifications', 'skills', 'achievements'];
const INLINE = 'Everything you need is in this message: do not use tools and do not read files.';
const VERDICT_RE = /\b(REJECT|MAYBE|ADVANCE)\b\D{0,4}(\d+(?:\.\d+)?)\s*\/\s*10/i;
const STOP = new Set('the and for with you your are our will this that from have has its into about who what when where how all any can may must not but per such their they them able work team role job jobs years year experience skills skill strong good using use used etc including include within across also other more most well new based'.split(' '));

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'job';
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();
// Local date (not UTC), so a run started on the evening of the 6th in India isn't filed under the 5th.
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// Lines that start many pasted job posts but say nothing about the job.
const GENERIC = /^(about the (job|role|company)|job description|overview|description|the role|role overview|summary|position summary|apply|save|share|easy apply|posted.*)$/i;

function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

const terms = (text) => {
  const out = new Set();
  for (const w of String(text).toLowerCase().match(/[a-z][a-z0-9+#.]{2,}/g) || []) {
    const t = w.replace(/\.+$/, '');
    if (!STOP.has(t)) out.add(t);
  }
  return out;
};

/** Free keyword pre-rank: share of the JD's terms that appear in each resume. */
export function preRank(jd, resumes) {
  const want = terms(jd);
  return resumes
    .map((r) => {
      const have = terms(r.text);
      let hit = 0;
      for (const t of want) if (have.has(t)) hit++;
      return { ...r, score: want.size ? hit / want.size : 0 };
    })
    .sort((a, b) => b.score - a.score);
}

function splitWriterReply(text) {
  const out = {};
  const re = /^=====\s*(resume\.md|changes\.md|questions\.md)\s*=====\s*$/gm;
  const marks = [...text.matchAll(re)];
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    out[m[1]] = text.slice(m.index + m[0].length, end).trim().replace(/^```\w*\n([\s\S]*?)\n```$/, '$1').trim();
  });
  return out;
}

/**
 * Run a review. `ctx` comes from the server:
 *   { root, runsDir, memoryDir, emit(ev), runAgent(job, name, effort, prompt) → {text, tokens, isError},
 *     runClaudeOnce(job, args, prompt) → text, listBaseResumes() → [{role, path}], usageNow() → {session}|null }
 * `o`: { jdText, jdUrl, resume ('auto' | path), agents: {name: {on, effort}}, round2Dir }
 */
export async function runReviewPipeline(job, o, ctx) {
  const { emit } = ctx;
  const step = (text) => emit(job, { kind: 'tool', action: 'other', text });
  const on = (name) => o.agents[name]?.on !== false;
  const effortOf = (name) => (AGENT_EFFORTS.includes(o.agents[name]?.effort) ? o.agents[name].effort : RECOMMENDED[name]);
  // Each agent can run on its own model; agents without one use the model picked for the Review tab.
  const modelOf = (name) => o.agents[name]?.model || job.model;
  const stopped = () => job.stopping;
  const stopText = () => (job.limitHit
    ? `**Stopped: you've reached your Claude usage limit.** ${job.limitHit}\n\nNothing more was launched. Reports that finished are saved in the run folder; run the review again after the limit resets.`
    : '*Stopped.*');
  const usageBefore = await ctx.usageNow();

  // ---------- Round 2: re-score the new resume with the same reviewers ----------
  if (o.round2Dir) {
    const dir = path.join(ctx.runsDir, o.round2Dir);
    const jd = fs.readFileSync(path.join(dir, 'jd.md'), 'utf8');
    const resume = fs.readFileSync(path.join(dir, 'resume.md'), 'utf8');
    emit(job, { kind: 'run_dir', dir: o.round2Dir });
    const verdicts = await runPanel(job, ctx, o, { jd, resume, outDir: path.join(dir, 'round-2', 'feedback'), round: 2, on, effortOf, modelOf, stopped });
    const before = readVerdicts(path.join(dir, 'feedback'));
    return finish(job, ctx, usageBefore, round2Summary(before, verdicts));
  }

  // ---------- 1. Job description (free when pasted; fetched if a link) ----------
  let jd = String(o.jdText || '').trim();
  if (!jd && o.jdUrl) {
    step(`Reading ${new URL(o.jdUrl).host}`);
    jd = await fetchJd(job, ctx, o.jdUrl);
    if (!jd) throw new Error('Couldn’t read the job description from that link. Paste the text instead.');
  }
  const firstLine = jd.split('\n').map((l) => l.replace(/[#*_`:]/g, '').trim()).find((l) => l.length > 3 && l.length < 90 && !GENERIC.test(l)) || 'job';
  let dirName = `${today()}-${slug(o.jdUrl ? `${new URL(o.jdUrl).host.replace(/^www\./, '').split('.')[0]} ${firstLine}` : firstLine)}`;
  for (let i = 2; fs.existsSync(path.join(ctx.runsDir, dirName)); i++) dirName = dirName.replace(/(-\d+)?$/, `-${i}`);
  const dir = path.join(ctx.runsDir, dirName);
  fs.mkdirSync(path.join(dir, 'feedback'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'jd.md'), `Source: ${o.jdUrl || 'pasted in the Shiro app'}\n\n${jd}\n`);
  emit(job, { kind: 'run_dir', dir: dirName });

  // ---------- 2. Resume text (free, cached) and the pick ----------
  step('Reading your resumes');
  let chosen;
  let pickNotes = '';
  if (o.resume && o.resume !== 'auto') {
    chosen = { path: o.resume, text: await resumeText(job, ctx, o.resume) };
  } else {
    const base = ctx.listBaseResumes();
    if (!base.length) throw new Error('No resumes in memory yet. Add one in the Memory tab.');
    const withText = [];
    for (const r of base) {
      const text = await resumeText(job, ctx, r.path);
      if (text) withText.push({ ...r, text });
    }
    const ranked = preRank(jd, withText);
    if (ranked.length === 1 || !on('resume-picker')) {
      chosen = ranked[0];
      pickNotes = `# Resume pick\n\n**Pick:** \`${chosen.path}\` — best keyword match with the job (${Math.round(chosen.score * 100)}% of its terms)${ranked.length > 1 ? '; the picker agent was switched off' : ''}.\n`;
    } else {
      // The closest few by keywords, plus the reference resume (the user's most accurate one) every time.
      const ref = ctx.referenceResume();
      const top = ranked.slice(0, 3);
      const refRow = ref && ranked.find((r) => r.path === ref);
      if (refRow && !top.includes(refRow)) top.push(refRow);
      const prompt = [
        `Pick the best resume to start from for the job below. ${INLINE} These are ${top.length} of the candidate's ${ranked.length} resumes: the closest by keyword match${refRow ? ', plus the reference resume' : ''}. Reply with the pick.md content, ending with the PICK line.`,
        `<job_description>\n${jd}\n</job_description>`,
        ...top.map((r) => `<resume path="${r.path}" role="${r.role}"${r.path === ref ? ' reference="true"' : ''}>\n${r.text}\n</resume>`),
      ].join('\n\n');
      const res = await ctx.runAgent(job, 'resume-picker', effortOf('resume-picker'), prompt, 'resume-picker', modelOf('resume-picker'));
      const m = res.text.match(/PICK\s+`?([^\s`]+)`?/i);
      const picked = m && top.find((r) => r.path === m[1] || r.path.endsWith(m[1]) || m[1].endsWith(r.path));
      // If the picker didn't answer, fall back to the reference resume (the user's most accurate), not just keywords.
      chosen = picked || refRow || top[0];
      pickNotes = picked ? res.text : `# Resume pick\n\n**Pick:** \`${chosen.path}\` — the picker didn't finish, so Shiro started from ${refRow ? 'your reference resume' : 'the closest keyword match'}.\n`;
      if (!picked) chosen.pickerFailed = true;
    }
    fs.writeFileSync(path.join(dir, 'pick.md'), `${pickNotes.trim()}\n`);
  }
  if (!chosen?.text) throw new Error('Couldn’t read the resume text.');
  const resume = chosen.text;
  fs.writeFileSync(path.join(dir, 'resume-original.md'), `Source file: ${chosen.path}\n\n${resume}\n`);
  if (stopped()) return finish(job, ctx, usageBefore, stopText());

  // ---------- 3. The panel, in parallel ----------
  const verdicts = await runPanel(job, ctx, o, { jd, resume, outDir: path.join(dir, 'feedback'), round: 1, on, effortOf, modelOf, stopped });
  if (stopped()) return finish(job, ctx, usageBefore, stopText());
  const reports = Object.entries(verdicts).filter(([, v]) => v.report);
  if (!reports.length) throw new Error('No reviewer finished, so there is nothing to work from.');

  // ---------- 4. Debrief ----------
  let debrief = '';
  if (on('debrief')) {
    const prompt = [
      `Chair the debrief for this resume and job. ${INLINE} Your whole reply is debrief.md.`,
      `<job_description>\n${jd}\n</job_description>`,
      `<resume>\n${resume}\n</resume>`,
      ...reports.map(([name, v]) => `<report reviewer="${name}">\n${v.report}\n</report>`),
    ].join('\n\n');
    const res = await ctx.runAgent(job, 'debrief', effortOf('debrief'), prompt, 'debrief', modelOf('debrief'));
    if (!res.isError && res.text.trim()) {
      debrief = res.text.trim();
      fs.writeFileSync(path.join(dir, 'debrief.md'), `${debrief}\n`);
    }
  }
  if (stopped()) return finish(job, ctx, usageBefore, stopText());

  // ---------- 5. Rewrite ----------
  let written = false;
  let pages = 0;
  if (on('resume-writer')) {
    const memory = MEMORY_FOR_WRITER
      .map((f) => [f, path.join(ctx.memoryDir, `${f}.md`)])
      .filter(([, p]) => fs.existsSync(p))
      .map(([f, p]) => `<memory file="${f}.md">\n${stripComments(fs.readFileSync(p, 'utf8'))}\n</memory>`);
    const prompt = [
      `Rewrite this resume for the job below. ${INLINE} Follow every item under "Resume preferences" in profile.md. Reply with resume.md, changes.md and questions.md in the inline delimited format, nothing else.`,
      `<job_description>\n${jd}\n</job_description>`,
      `<resume source="${chosen.path}">\n${resume}\n</resume>`,
      pickNotes ? `<pick_notes>\n${pickNotes}\n</pick_notes>` : '',
      debrief ? `<debrief>\n${debrief}\n</debrief>` : reports.map(([name, v]) => `<report reviewer="${name}">\n${v.report}\n</report>`).join('\n\n'),
      ...memory,
    ].filter(Boolean).join('\n\n');
    const res = await ctx.runAgent(job, 'resume-writer', effortOf('resume-writer'), prompt, 'resume-writer', modelOf('resume-writer'));
    const files = splitWriterReply(res.text);
    if (files['resume.md']) {
      for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), `${body}\n`);
      step('Building resume.html and resume.pdf');
      try {
        convertFile(`runs/${dirName}/resume.md`, `runs/${dirName}/resume.html`);
        await htmlToPdf(`runs/${dirName}/resume.html`, `runs/${dirName}/resume.pdf`);
        pages = pdfPages(`runs/${dirName}/resume.pdf`);
      } catch (err) {
        step(`PDF not made: ${err.message}`);
      }
      written = true;
    } else if (res.text.trim()) {
      fs.writeFileSync(path.join(dir, 'writer-output.md'), res.text);
    }
  }

  if (job.limitHit) return finish(job, ctx, usageBefore, stopText());
  return finish(job, ctx, usageBefore, summary({ dirName, chosen, verdicts, debrief, dir, written, pages, writerOn: on('resume-writer') }));
}

async function runPanel(job, ctx, o, { jd, resume, outDir, round, on, effortOf, modelOf, stopped }) {
  fs.mkdirSync(outDir, { recursive: true });
  const names = PANEL.filter(on);
  const prompt = [
    `Review this resume for the job below. ${INLINE} Reply with your full report in your output format, and nothing else.`,
    `<job_description>\n${jd}\n</job_description>`,
    `<resume>\n${resume}\n</resume>`,
  ].join('\n\n');
  const verdicts = {};
  const queue = [...names];
  const worker = async () => {
    while (queue.length && !stopped()) {
      const name = queue.shift();
      const res = await ctx.runAgent(job, name, effortOf(name), prompt, round === 2 ? `${name}@2` : name, modelOf(name));
      if (res.isError || !res.text.trim()) { verdicts[name] = { error: true }; continue; }
      const report = res.text.trim();
      fs.writeFileSync(path.join(outDir, `${name}.md`), `${report}\n`);
      const m = report.match(VERDICT_RE);
      verdicts[name] = { report, verdict: m ? m[1].toUpperCase() : '', score: m ? Number(m[2]) : null };
    }
  };
  // A few at a time: still parallel, but gentler on memory and rate limits than 10 processes at once.
  await Promise.all(Array.from({ length: Math.min(ctx.parallel || 5, names.length) }, worker));
  return verdicts;
}

async function resumeText(job, ctx, rel) {
  const full = path.resolve(ctx.root, rel);
  let text = await cachedText(full);
  if (text) return text;
  // No local tool could read it (e.g. no pdftotext/pypdf on this computer): ask Claude once, then cache.
  note(job, ctx, `Transcribing ${path.basename(rel)} once (no local PDF reader found)`);
  text = await ctx.runClaudeOnce(job, ['--model', 'sonnet', '--effort', 'low', '--tools', 'Read', '--allowedTools', 'Read'],
    `Read the file ${rel} and reply with its complete text exactly as written, in reading order, with no commentary.`);
  if (text && text.trim().length > 40) { writeCache(full, text.trim()); return text.trim(); }
  return null;
}

function note(job, ctx, text) {
  ctx.emit(job, { kind: 'tool', action: 'other', text });
}

async function fetchJd(job, ctx, url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (Shiro job helper)' } });
    const text = htmlToText(await res.text()).slice(0, 30000);
    if (text.length > 800) return text;
  } catch { /* fall through to Claude */ }
  const text = await ctx.runClaudeOnce(job, ['--model', 'sonnet', '--effort', 'low', '--tools', 'WebFetch', '--allowedTools', 'WebFetch'],
    `Fetch ${url} and reply with only the job description's full text (title, company, location, responsibilities, requirements). If the page has no job description, reply with exactly: NONE`);
  return text && !/^\s*NONE\s*$/.test(text) && text.length > 200 ? text.trim() : null;
}

function readVerdicts(dir) {
  const out = {};
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!f.endsWith('.md')) continue;
    const m = fs.readFileSync(path.join(dir, f), 'utf8').match(VERDICT_RE);
    out[f.replace(/\.md$/, '')] = { verdict: m ? m[1].toUpperCase() : '', score: m ? Number(m[2]) : null };
  }
  return out;
}

function scoreboard(verdicts) {
  const rows = Object.entries(verdicts).filter(([, v]) => v.verdict);
  const avg = rows.length ? rows.reduce((s, [, v]) => s + v.score, 0) / rows.length : 0;
  const count = (x) => rows.filter(([, v]) => v.verdict === x).length;
  return { rows, avg, line: `**Average ${avg.toFixed(1)}/10** · ADVANCE ${count('ADVANCE')} · MAYBE ${count('MAYBE')} · REJECT ${count('REJECT')}` };
}

function section(md, heading) {
  const i = md.search(new RegExp(`^#{2,3} ${heading}`, 'm'));
  if (i < 0) return '';
  const rest = md.slice(i).split('\n').slice(1);
  const end = rest.findIndex((l) => /^#{2,3} /.test(l));
  return rest.slice(0, end < 0 ? undefined : end).join('\n').trim();
}

function summary({ dirName, chosen, verdicts, debrief, dir, written, pages, writerOn }) {
  const sb = scoreboard(verdicts);
  const failed = Object.entries(verdicts).filter(([, v]) => v.error).map(([n]) => n);
  const picker = chosen.pickerFailed ? ' (the picker didn’t finish, so this is a fallback)' : '';
  const parts = [`**Review finished** · started from \`${path.basename(chosen.path)}\`${picker}`, '', sb.line];
  if (failed.length) parts.push('', `Didn’t finish: ${failed.join(', ')}.`);
  const p0 = debrief ? section(debrief, 'P0') : '';
  if (p0) parts.push('', '**Must fix (P0)**', p0.split('\n').slice(0, 6).join('\n'));
  if (written) {
    parts.push('', `**New resume:** \`runs/${dirName}/resume.pdf\`${pages ? ` · ${pages} page${pages > 1 ? 's' : ''}` : ''} (use the buttons on the resume card).`);
    if (pages > 1) {
      const words = fs.readFileSync(path.join(dir, 'resume.md'), 'utf8').split(/\s+/).filter(Boolean).length;
      parts.push('', `It still runs to ${pages} pages even at the tightest readable spacing (${words} words). If you want one page, run the review again, or tell Claude which items to cut.`);
    }
    const q = fs.existsSync(path.join(dir, 'questions.md')) ? fs.readFileSync(path.join(dir, 'questions.md'), 'utf8').trim() : '';
    if (q) parts.push('', '**The writer’s questions** (answer them in the Memory tab, then run the review again):', q.split('\n').filter((l) => /^\s*\d+[.)]/.test(l)).slice(0, 6).join('\n'));
  } else {
    parts.push('', writerOn ? 'The resume writer didn’t finish, so there’s no new resume this time.' : 'The resume writer was switched off, so no new resume this time.');
  }
  return parts.join('\n');
}

function round2Summary(before, after) {
  const a = scoreboard(before);
  const b = scoreboard(after);
  const rows = Object.keys(after).map((n) => `| ${n} | ${before[n]?.verdict || '–'} ${before[n]?.score ?? ''} | ${after[n]?.verdict || '–'} ${after[n]?.score ?? ''} |`);
  return [`**Round 2:** the new resume scored **${b.avg.toFixed(1)}/10**, up from ${a.avg.toFixed(1)}/10.`, '', '| Reviewer | Before | After |', '|---|---|---|', ...rows].join('\n');
}

async function finish(job, ctx, usageBefore, text) {
  const after = await ctx.usageNow(true);
  const s0 = usageBefore?.windows?.find((w) => /session/i.test(w.label));
  const s1 = after?.windows?.find((w) => /session/i.test(w.label));
  let out = text;
  if (s0 && s1 && s1.pct >= s0.pct) out += `\n\n*This run used about ${s1.pct - s0.pct}% of your current session (${s1.pct}% used now).*`;
  return out;
}
