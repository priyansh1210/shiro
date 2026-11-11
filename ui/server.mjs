#!/usr/bin/env node
// Shiro local app.
// Serves the UI on 127.0.0.1 and runs Claude Code headless (`claude -p`) on your own subscription.
// The characters and animations are plain browser code and cost nothing. Tokens are only spent
// by the Claude runs you start (review, apply, remember).

import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { htmlToPdf } from '../tools/html-to-pdf.mjs';
import { runReviewPipeline, AGENTS, AGENT_EFFORTS } from './review-pipeline.mjs';
import { createMemoryEditor } from './memory-edit.mjs';

// Bump together with APP_VERSION in public/app.js, so an old server left running is spotted.
const VERSION = '0.9.2';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'ui', 'public');
const RUNS_DIR = path.join(ROOT, 'runs');
const MEMORY_DIR = path.join(ROOT, 'memory');
const PORT = Number(process.env.SHIRO_PORT) || 4747;
const HOST = '127.0.0.1';
const TOKEN = randomBytes(24).toString('hex');
const IS_WIN = process.platform === 'win32';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Model aliases Claude Code understands. 'default' means: don't pass --model, use the user's own setting.
const MODELS = ['default', 'opus', 'sonnet', 'haiku', 'fable'];
const MODEL_LABELS = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', default: 'default model' };
const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHROME = 'mcp__claude-in-chrome__';

// What each kind of run may do without asking. Edits are limited to the project folder by acceptEdits.
// The only shell commands pre-approved are Shiro's own two tools. Only /apply gets the browser.
const PDF_TOOL = 'Bash(node tools/html-to-pdf.mjs:*)';
const FILE_TOOL = 'Bash(node tools/file-doc.mjs:*)';
const MODES = {
  review: { tools: `Read,Glob,Grep,WebFetch,Agent,Task,${PDF_TOOL}`, chrome: false },
  apply: { tools: `Read,Glob,Grep,Agent,Task,ToolSearch,mcp__claude-in-chrome,${PDF_TOOL},${FILE_TOOL}`, chrome: true },
  remember: { tools: `Read,Glob,Grep,WebFetch,${FILE_TOOL},${PDF_TOOL}`, chrome: false },
  setup: {
    tools: `Read,Glob,Grep,WebFetch,${FILE_TOOL},${PDF_TOOL}`,
    chrome: false,
    note: 'This is the interactive setup. Do not guess answers: ask the skill\'s questions in your final message, one short batch at a time, then stop. The user answers in the app and you continue in the same conversation.',
  },
};

// Files you can keep in memory/documents/ for forms that ask for uploads.
// HTML is accepted but only ever served back as plain text, so it can't run scripts in this page.
const DOCS_DIR = path.join(ROOT, 'memory', 'documents');
const MAX_UPLOAD = 20 * 1024 * 1024;
const UPLOAD_TYPES = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text', '.rtf': 'application/rtf',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.html': 'text/plain; charset=utf-8', '.htm': 'text/plain; charset=utf-8',
};
const SECTIONS = [
  ['certificates', 'Certificates'], ['academic', 'Transcripts & degrees'], ['letters', 'Letters'],
  ['portfolio', 'Portfolio & samples'], ['cover-letters', 'Cover letters'], ['other', 'Other'],
  ['duplicates', 'Duplicates (safe to delete)'],
];
const INLINE_TYPES = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.md', '.csv']);
// Free, instant removals from memory, each with an Undo (see memory-edit.mjs).
const memoryEditor = createMemoryEditor({ root: ROOT, memoryDir: MEMORY_DIR, templatesDir: path.join(ROOT, 'templates', 'memory') });
memoryEditor.purge(true);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const jobs = new Map();
let jobSeq = 0;
let claudeVersion = null;

// ---------- Claude process ----------

function systemNote(effort, model, extra) {
  const e = effort.toUpperCase();
  return [
    extra || '',
    'You are running headless from the Shiro web app. The user cannot answer while you work, so never wait for input.',
    'Where a skill says to ask the user, make the most reasonable safe choice and continue. If you truly cannot continue safely, stop and put your question in your final message; the user will reply from the app.',
    `The user chose effort level ${e} for this run: pass effort ${e} on every Agent or Task call you make.`,
    model !== 'default' ? `The user chose the model ${model} for this run: pass model ${model} on every Agent or Task call you make.` : '',
    'Wait for background agents to finish before you write your final message.',
  ].filter(Boolean).join(' ');
}

// On Windows `claude` is usually a .cmd shim, which needs a shell. Every argument is either a constant
// from this file or validated, but refuse anything cmd.exe would treat specially, just in case.
function winArg(a) {
  if (/["%^&|<>!\r\n]/.test(a)) throw new Error(`Refusing unsafe argument: ${a.slice(0, 40)}`);
  return /^[\w.,:=@/+-]+$/.test(a) ? a : `"${a}"`;
}

function spawnClaude(args) {
  return IS_WIN
    ? spawn('claude', args.map(winArg), { cwd: ROOT, shell: true, windowsHide: true })
    : spawn('claude', args, { cwd: ROOT });
}

function runClaude(job, prompt, resumeId) {
  const mode = MODES[job.kind];
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--effort', job.effort,
    '--permission-mode', 'acceptEdits',
    '--allowedTools', mode.tools,
    '--append-system-prompt', systemNote(job.effort, job.model, mode.note),
  ];
  if (job.model !== 'default') args.push('--model', job.model);
  if (mode.chrome) args.push('--chrome');
  if (resumeId) args.push('--resume', resumeId);

  let child;
  try {
    child = spawnClaude(args);
  } catch (err) {
    emit(job, { kind: 'error', text: err.message });
    return;
  }
  job.child = child;
  job.running = true;
  job.lastResult = null;
  job.lastIsError = false;
  emit(job, { kind: 'started', effort: job.effort, model: job.model, resumed: Boolean(resumeId) });

  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { emit(job, { kind: 'log', text: line.slice(0, 500) }); continue; }
      try { translate(job, ev); } catch (err) { console.error('[shiro] could not read an event:', err.message); }
    }
  });

  let errText = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => { errText = (errText + d).slice(-20000); });
  child.on('error', (err) => emit(job, { kind: 'error', text: `Could not start Claude Code: ${err.message}` }));
  child.on('close', (code) => {
    job.running = false;
    job.child = null;
    emit(job, {
      kind: 'exit',
      code,
      stopped: Boolean(job.stopping),
      result: job.lastResult,
      isError: code !== 0 || job.lastIsError,
      stderr: code !== 0 ? errText.trim().slice(-2000) : '',
    });
    job.stopping = false;
  });
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
}

// ---------- Plan usage, the same numbers as /usage in Claude Code ----------
// `/usage` is answered locally by Claude Code (no model call), so checking it costs no tokens.
// --no-session-persistence keeps these checks out of your session history.

const USAGE_TTL = 60_000;
const usageCache = { at: 0, data: null, pending: null };

function parseUsage(text) {
  const windows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(.+?):\s*(\d+(?:\.\d+)?)%\s*used(?:\s*·\s*resets\s+(.+?))?\s*$/i);
    if (m) windows.push({ label: m[1].trim(), pct: Number(m[2]), resets: (m[3] || '').trim() });
  }
  return windows.length ? { windows, at: Date.now() } : null;
}

function fetchUsage(force) {
  if (!force && usageCache.data && Date.now() - usageCache.at < USAGE_TTL) return Promise.resolve(usageCache.data);
  if (usageCache.pending) return usageCache.pending;
  usageCache.pending = new Promise((resolve) => {
    let child;
    try {
      child = spawnClaude(['-p', '--output-format', 'json', '--no-session-persistence']);
    } catch {
      resolve(usageCache.data);
      return;
    }
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => {});
    const timer = setTimeout(() => {
      if (IS_WIN) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
      else child.kill('SIGTERM');
    }, 30000);
    child.on('close', () => {
      clearTimeout(timer);
      let text = '';
      try { text = JSON.parse(out).result || ''; } catch { /* not signed in, or an older Claude Code */ }
      const data = parseUsage(text);
      if (data) { usageCache.data = data; usageCache.at = data.at; }
      resolve(usageCache.data);
    });
    child.stdin.on('error', () => {});
    child.stdin.end('/usage');
  }).finally(() => { usageCache.pending = null; });
  return usageCache.pending;
}

function killProcess(child) {
  if (!child || child.exitCode !== null) return;
  if (IS_WIN) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  else child.kill('SIGTERM');
}

function stopJob(job) {
  job.stopping = true;
  killProcess(job.child);
  for (const c of job.children || []) killProcess(c);
}

// ---------- One agent, one turn (used by the review pipeline) ----------
// The agent gets everything inline, so no tools, skills or MCP servers are loaded: the cheapest possible call.

function runAgent(job, name, effort, prompt, id = name, model = job.model) {
  return new Promise((resolve) => {
    const args = [
      '-p', '--agent', name, '--output-format', 'stream-json', '--verbose', '--effort', effort,
      '--tools', '', '--disable-slash-commands', '--strict-mcp-config', '--no-session-persistence',
    ];
    if (model && model !== 'default') args.push('--model', model);
    emit(job, { kind: 'agent_start', id, agent: name, text: `${MODEL_LABELS[model] || 'default model'} · ${effort}`, model, effort });
    let child;
    try { child = spawnClaude(args); } catch (err) { emit(job, { kind: 'agent_done', id, agent: name, status: 'failed', summary: err.message }); resolve({ text: '', isError: true }); return; }
    job.children.add(child);
    let buf = '';
    let result = null;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'system' && e.subtype === 'thinking_tokens') {
          emit(job, { kind: 'agent_activity', id, agent: name, text: `Thinking… ${(e.estimated_tokens / 1000).toFixed(1)}k`, tokens: e.estimated_tokens });
        } else if (e.type === 'assistant' && e.message?.content?.some((c) => c.type === 'text')) {
          emit(job, { kind: 'agent_activity', id, agent: name, text: 'Writing the report' });
        } else if (e.type === 'rate_limit_event') {
          usageCache.at = 0;
          emit(job, { kind: 'usage', usage: e.rate_limit_info });
        } else if (e.type === 'result') {
          result = e;
        }
      }
    });
    let errText = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { errText = (errText + d).slice(-4000); });
    child.on('error', () => {});
    child.on('close', () => {
      job.children.delete(child);
      const text = result?.result || '';
      const isError = !result || result.is_error || !text.trim();
      // Out of usage: every further call would fail too, so stop the whole run and say why.
      if (isError && !job.limitHit && /usage limit|limit reached|hit your limit|rate.?limit|out of (usage|credits)|resets? (at|in)/i.test(`${text} ${errText}`)) {
        job.limitHit = (text || errText).trim().split('\n')[0].slice(0, 200) || 'Usage limit reached.';
        job.stopping = true;
        for (const c of job.children) if (c !== child) killProcess(c);
      }
      const u = result?.usage || {};
      const tokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
      emit(job, { kind: 'agent_done', id, agent: name, status: isError ? (job.stopping ? 'killed' : 'failed') : 'completed', summary: isError ? (text || errText.trim() || 'Stopped') : agentSummary(name, text), tokens });
      resolve({ text: isError ? '' : text, isError, tokens });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

// A one-line summary of an agent's reply, for the speech bubble and activity log.
function agentSummary(name, text) {
  if (name === 'resume-picker') return (text.match(/PICK\s+.+$/im) || [''])[0];
  if (name === 'debrief') return (text.match(/\*\*Average:\*\*.*$/m) || ['Debrief written'])[0].replace(/\*\*/g, '');
  if (name === 'resume-writer') {
    const words = (text.split(/=====\s*changes\.md/)[0].match(/\b\w+\b/g) || []).length;
    const questions = (text.split(/=====\s*questions\.md\s*=====/)[1] || '').split('\n').filter((l) => /^\s*\d+[.)]/.test(l)).length;
    return `Wrote the new resume (~${words} words) and ${questions} question${questions === 1 ? '' : 's'}`;
  }
  const head = (text.match(/^#\s.*$/m) || [''])[0].replace(/^#\s*/, '');
  const verdict = head.match(/\b(REJECT|MAYBE|ADVANCE)\b\D{0,4}(\d+(?:\.\d+)?)\s*\/\s*10/i);
  const why = (text.match(/\*\*In one line:\*\*\s*(.+)$/m) || [])[1] || '';
  return verdict ? `${verdict[1].toUpperCase()} ${verdict[2]}/10 — ${why}` : head || 'Report written';
}

// A plain one-shot Claude call (fetching a JD page, transcribing a resume no local tool can read).
function runClaudeOnce(job, extra, prompt) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnClaude(['-p', '--output-format', 'json', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config', ...extra]);
    } catch { resolve(''); return; }
    job.children.add(child);
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => {});
    child.on('close', () => {
      job.children.delete(child);
      try { resolve(JSON.parse(out).result || ''); } catch { resolve(''); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

function startReview(job, b) {
  const agents = {};
  for (const name of AGENTS) {
    const a = (b.agents && typeof b.agents === 'object' && b.agents[name]) || {};
    agents[name] = { on: a.on !== false, effort: AGENT_EFFORTS.includes(a.effort) ? a.effort : undefined, model: MODELS.includes(a.model) ? a.model : undefined };
  }
  let round2Dir = null;
  if (b.round2Dir) {
    if (!/^[^/\\.][^/\\]*$/.test(b.round2Dir) || !fs.existsSync(path.join(RUNS_DIR, b.round2Dir, 'resume.md'))) throw httpError(400, 'That run has no new resume to re-score.');
    round2Dir = b.round2Dir;
  }
  const opts = {
    jdText: typeof b.jdText === 'string' ? b.jdText.slice(0, 200000) : '',
    jdUrl: b.jdUrl ? checkUrl(b.jdUrl) : '',
    resume: b.resume && b.resume !== 'auto' ? checkResume(b.resume) : 'auto',
    agents,
    round2Dir,
  };
  if (!round2Dir && !opts.jdUrl && opts.jdText.trim().length < 40) throw httpError(400, 'Paste the job description, or give its link.');
  job.pipeline = true;
  job.running = true;
  job.children = new Set();
  emit(job, { kind: 'started', effort: 'per agent', model: job.model });
  const ctx = {
    root: ROOT, runsDir: RUNS_DIR, memoryDir: MEMORY_DIR, emit, runAgent, runClaudeOnce,
    parallel: Number(process.env.SHIRO_PARALLEL) || 5,
    listBaseResumes: () => listResumes().filter((r) => r.kind === 'base'),
    referenceResume: () => (readText(path.join(MEMORY_DIR, 'profile.md')).match(/^- Reference resume[^:]*:\s*(memory\/resume\/[^\s(]+)/m) || [])[1] || null,
    usageNow: (force) => fetchUsage(force),
  };
  runReviewPipeline(job, opts, ctx)
    .then((text) => {
      emit(job, { kind: 'result', text });
      emit(job, { kind: 'exit', code: 0, result: text, stopped: Boolean(job.stopping), noReply: true });
    })
    .catch((err) => {
      const text = `**The review stopped:** ${err.message}`;
      emit(job, { kind: 'exit', code: 1, result: text, isError: true, stopped: Boolean(job.stopping), noReply: true });
    })
    .finally(() => { job.running = false; job.stopping = false; });
}

// ---------- Translate Claude's stream-json into simple UI events ----------

function translate(job, e) {
  if (e.type === 'system') {
    switch (e.subtype) {
      case 'init': {
        if (e.session_id) job.sessionId = e.session_id;
        if (!job.sawInit) {
          job.sawInit = true;
          const chrome = (e.mcp_servers || []).find((s) => s.name === 'claude-in-chrome');
          emit(job, { kind: 'init', model: e.model, chrome: chrome ? chrome.status : 'off' });
        }
        return;
      }
      case 'task_started':
        job.tasks.set(e.task_id, e.tool_use_id);
        return agentStart(job, e.tool_use_id, e.subagent_type, e.description);
      case 'task_progress':
        return emit(job, {
          kind: 'agent_activity', id: e.tool_use_id,
          agent: job.agents.get(e.tool_use_id) || e.subagent_type,
          text: e.description, tokens: e.usage?.total_tokens,
        });
      case 'task_notification': {
        const id = e.tool_use_id || job.tasks.get(e.task_id);
        return agentDone(job, id, e.status, e.summary || '', e.usage?.total_tokens);
      }
      case 'thinking_tokens':
        return emit(job, { kind: 'thinking', tokens: e.estimated_tokens });
      default:
        return;
    }
  }

  if (e.type === 'rate_limit_event') {
    usageCache.at = 0; // the next /api/usage call fetches fresh numbers
    return emit(job, { kind: 'usage', usage: e.rate_limit_info });
  }

  if (e.type === 'assistant') {
    const parent = e.parent_tool_use_id;
    for (const c of e.message?.content || []) {
      if (c.type === 'tool_use') {
        noteRunDir(job, c.input);
        if (parent) {
          emit(job, { kind: 'agent_activity', id: parent, agent: job.agents.get(parent), text: describeTool(c.name, c.input || {}) });
        } else if (c.name === 'Agent' || c.name === 'Task') {
          agentStart(job, c.id, c.input?.subagent_type || 'general-purpose', c.input?.description);
        } else {
          emit(job, { kind: 'tool', ...toolEvent(c.name, c.input || {}) });
        }
      } else if (c.type === 'text' && !parent && c.text.trim()) {
        emit(job, { kind: 'text', text: c.text });
      }
    }
    return;
  }

  // Foreground agents (if a version runs them that way) report back as a plain tool result.
  if (e.type === 'user' && !e.parent_tool_use_id) {
    for (const c of e.message?.content || []) {
      if (c.type !== 'tool_result' || !job.agents.has(c.tool_use_id)) continue;
      const text = resultText(c.content);
      if (/^Async agent launched/i.test(text)) continue;
      agentDone(job, c.tool_use_id, c.is_error ? 'failed' : 'completed', text);
    }
    return;
  }

  if (e.type === 'result') {
    job.lastResult = e.result || '';
    job.lastIsError = Boolean(e.is_error);
    emit(job, { kind: 'result', text: job.lastResult, isError: job.lastIsError });
  }
}

function agentStart(job, id, agent, text) {
  if (!id || job.agents.has(id)) return;
  job.agents.set(id, agent);
  emit(job, { kind: 'agent_start', id, agent, text });
}

function agentDone(job, id, status, summary, tokens) {
  if (!id || job.doneIds.has(id)) return;
  job.doneIds.add(id);
  emit(job, { kind: 'agent_done', id, agent: job.agents.get(id), status, summary, tokens });
}

function resultText(content) {
  if (typeof content === 'string') return content;
  return (content || []).map((x) => (x.type === 'text' ? x.text : '')).join('\n');
}

function noteRunDir(job, input) {
  const fp = input?.file_path;
  if (!fp) return;
  const m = String(fp).replace(/\\/g, '/').match(/(?:^|\/)runs\/([^/.][^/]*)\//);
  if (m && m[1] !== job.runDir) {
    job.runDir = m[1];
    emit(job, { kind: 'run_dir', dir: m[1] });
  }
}

const base = (p) => (p ? String(p).split(/[\\/]/).pop() : '');
const host = (u) => { try { return new URL(u).host; } catch { return u || ''; } };

function describeTool(name, input) {
  switch (name) {
    case 'Read': return `Reading ${base(input.file_path)}`;
    case 'Write': return `Writing ${base(input.file_path)}`;
    case 'Edit': return `Editing ${base(input.file_path)}`;
    case 'Glob': return `Looking for ${input.pattern || 'files'}`;
    case 'Grep': return `Searching for “${String(input.pattern || '').slice(0, 40)}”`;
    case 'WebFetch': return `Fetching ${host(input.url)}`;
    case 'ToolSearch': return 'Loading tools';
    case 'Bash':
    case 'PowerShell': return `Running: ${String(input.command || '').replace(/\s+/g, ' ').slice(0, 70)}`;
    default: break;
  }
  if (!name.startsWith(CHROME)) return name;
  const t = name.slice(CHROME.length);
  switch (t) {
    case 'navigate': return `Opening ${host(input.url)}`;
    case 'form_input': return input.action_summary || 'Filling a field';
    case 'file_upload': return `Uploading ${(input.paths || []).map(base).join(', ')}`;
    case 'read_page':
    case 'get_page_text': return 'Reading the page';
    case 'find': return `Looking for ${String(input.query || 'a field').slice(0, 50)}`;
    case 'tabs_create_mcp': return 'Opening a new tab';
    case 'tabs_context_mcp': return 'Checking Chrome tabs';
    case 'computer': {
      const a = input.action || '';
      if (a === 'type') return `Typing “${String(input.text || '').slice(0, 40)}”`;
      if (a.includes('click')) return 'Clicking';
      if (a === 'scroll') return 'Scrolling';
      if (a === 'screenshot') return 'Looking at the page';
      if (a === 'key') return `Pressing ${input.text || 'a key'}`;
      return a || 'Using the page';
    }
    default: return t.replace(/_mcp$/, '').replace(/_/g, ' ');
  }
}

function toolEvent(name, input) {
  const isChrome = name.startsWith(CHROME);
  const t = isChrome ? name.slice(CHROME.length) : name;
  let action = 'other';
  if (isChrome) {
    if (t === 'navigate') action = 'navigate';
    else if (t === 'form_input') action = 'fill';
    else if (t === 'file_upload') action = 'upload';
    else if (t === 'computer') {
      const a = input.action || '';
      action = a === 'type' ? 'type' : a.includes('click') ? 'click' : a === 'screenshot' ? 'look' : 'other';
    } else if (['read_page', 'get_page_text', 'find'].includes(t)) action = 'look';
    else if (t.startsWith('tabs_')) action = 'tabs';
  }
  return { tool: t, action, text: describeTool(name, input), url: t === 'navigate' ? input.url : undefined };
}

// ---------- Jobs and server-sent events ----------

function emit(job, ev) {
  ev.t = Date.now();
  const i = job.events.push(ev) - 1;
  for (const res of job.clients) writeEvent(res, i, ev);
}

function writeEvent(res, i, ev) {
  res.write(`id: ${i}\ndata: ${JSON.stringify(ev)}\n\n`);
}

function streamEvents(req, res, id) {
  const job = jobs.get(id);
  if (!job) return json(res, 404, { error: 'No such run. The app may have restarted.' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  const last = Number(req.headers['last-event-id']);
  for (let i = Number.isFinite(last) ? last + 1 : 0; i < job.events.length; i++) writeEvent(res, i, job.events[i]);
  job.clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); job.clients.delete(res); });
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function startJob(b) {
  const kind = b.kind;
  if (!MODES[kind]) throw httpError(400, 'Unknown run type.');
  const effort = EFFORTS.includes(b.effort) ? b.effort : 'medium';
  const model = MODELS.includes(b.model) ? b.model : 'default';
  if ([...jobs.values()].some((j) => j.kind === kind && j.running)) {
    throw httpError(409, `A ${kind} run is already going. Stop it or wait for it to finish.`);
  }

  // Reviews run as the app's own pipeline: one direct call per agent, inputs inline (see review-pipeline.mjs).
  if (kind === 'review') {
    const job = {
      id: `${kind}-${++jobSeq}-${Date.now().toString(36)}`,
      kind, effort: 'per agent', model, events: [], clients: new Set(),
      agents: new Map(), tasks: new Map(), doneIds: new Set(), running: false, sessionId: null, runDir: null,
    };
    jobs.set(job.id, job);
    startReview(job, b);
    return { jobId: job.id };
  }

  const resume = b.resume && b.resume !== 'auto' ? checkResume(b.resume) : '';
  const resumeArg = resume ? ` ${/\s/.test(resume) ? `"${resume}"` : resume}` : '';
  let prompt;
  if (kind === 'review') {
    let jd;
    if (b.jdUrl) {
      jd = checkUrl(b.jdUrl);
    } else if (typeof b.jdText === 'string' && b.jdText.trim().length >= 40) {
      if (b.jdText.length > 200000) throw httpError(400, 'That job description is too long.');
      const dir = path.join(RUNS_DIR, '.inbox');
      fs.mkdirSync(dir, { recursive: true });
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-jd.md`;
      fs.writeFileSync(path.join(dir, name), `${b.jdText.trim()}\n`);
      jd = `runs/.inbox/${name}`;
    } else {
      throw httpError(400, 'Paste the job description, or give its link.');
    }
    prompt = `/review ${jd}${resumeArg}`;
  } else if (kind === 'apply') {
    prompt = `/apply ${checkUrl(b.url)}${resumeArg}`;
  } else if (kind === 'setup') {
    ensureMemory();
    const files = listDir(path.join(MEMORY_DIR, 'resume')).filter((f) => /\.(pdf|docx?|md|txt|html?)$/i.test(f));
    if (!files.length) throw httpError(400, 'Drop your resume into the Resumes box first.');
    prompt = `/setup ${files.map((f) => `"memory/resume/${f}"`).join(' ')}`;
  } else {
    const text = String(b.text || '').trim();
    if (!text) throw httpError(400, b.mode === 'forget' ? 'Tell Shiro what to forget.' : 'Tell Shiro what to remember.');
    ensureMemory();
    if (text.length > 20000) throw httpError(400, 'That is too long for one memory. Split it up.');
    prompt = b.mode === 'forget' ? `/remember FORGET: ${text}` : `/remember ${text}`;
  }

  const job = {
    id: `${kind}-${++jobSeq}-${Date.now().toString(36)}`,
    kind, effort, model, events: [], clients: new Set(),
    agents: new Map(), tasks: new Map(), doneIds: new Set(),
    running: false, sessionId: null, runDir: null,
  };
  jobs.set(job.id, job);
  emit(job, { kind: 'user', text: prompt });
  runClaude(job, prompt);
  return { jobId: job.id };
}

function replyJob(b) {
  const job = jobs.get(b.jobId);
  if (!job) throw httpError(404, 'That run is gone. The app may have restarted.');
  if (job.running) throw httpError(409, 'Claude is still working on this run.');
  if (job.pipeline) throw httpError(400, 'Reviews don’t take replies. Use Round 2 on the resume card, or answer the questions in the Memory tab.');
  if (!SESSION_RE.test(job.sessionId || '')) throw httpError(400, 'This run has no conversation to continue.');
  const text = String(b.text || '').trim();
  if (!text) throw httpError(400, 'Write a reply first.');
  if (EFFORTS.includes(b.effort)) job.effort = b.effort;
  if (MODELS.includes(b.model)) job.model = b.model;
  job.sawInit = false;
  emit(job, { kind: 'user', text });
  runClaude(job, text, job.sessionId);
  return { jobId: job.id };
}

function checkUrl(u) {
  let url;
  try { url = new URL(String(u).trim()); } catch { throw httpError(400, 'That link doesn’t look right.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw httpError(400, 'Only http and https links work.');
  return url.href;
}

function checkResume(rel) {
  const full = path.resolve(ROOT, String(rel));
  if (!(inside(full, MEMORY_DIR) || inside(full, RUNS_DIR)) || !fs.existsSync(full)) {
    throw httpError(400, 'That resume file isn’t in memory/ or runs/.');
  }
  return path.relative(ROOT, full).split(path.sep).join('/');
}

// ---------- Reading the project for the UI ----------

const inside = (full, dir) => full === dir || full.startsWith(dir + path.sep);
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const listDir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };

function listRuns() {
  return listDir(RUNS_DIR)
    .filter((d) => !d.startsWith('.') && isDir(path.join(RUNS_DIR, d)))
    .sort()
    .reverse()
    .map((dir) => {
      const has = (f) => fs.existsSync(path.join(RUNS_DIR, dir, f));
      return { dir, hasFeedback: has('feedback'), hasDebrief: has('debrief.md'), hasResume: has('resume.md'), hasHtml: has('resume.html'), hasPdf: has('resume.pdf') };
    });
}

function listResumes() {
  const out = [];
  const seen = new Set();
  const add = (role, rel, kind) => {
    const key = rel.replace(/\\/g, '/').replace(/^\.\//, '');
    if (seen.has(key) || !fs.existsSync(path.join(ROOT, key))) return;
    seen.add(key);
    out.push({ role, label: shortLabel(role), path: key, kind });
  };
  const profile = readText(path.join(MEMORY_DIR, 'profile.md')).replace(/<!--[\s\S]*?-->/g, '');
  const section = profile.split(/^## /m).find((s) => /^Resumes\b/.test(s)) || '';
  // The path is the first "memory/…" or "runs/…" after a colon, so a role note that contains a colon doesn't break the line.
  for (const m of section.matchAll(/^-\s*(.+?):\s*`?((?:memory|runs)\/[^`\n]+?)`?\s*$/gm)) add(m[1].trim(), m[2].trim(), 'base');
  for (const f of listDir(path.join(MEMORY_DIR, 'resume'))) {
    if (/\.(pdf|docx?|md|txt)$/i.test(f)) add(path.parse(f).name.replace(/[-_]+/g, ' '), `memory/resume/${f}`, 'base');
  }
  for (const r of listRuns()) if (r.hasPdf) add(`Tailored: ${r.dir}`, `runs/${r.dir}/resume.pdf`, 'tailored');
  return out;
}

// A role line can carry long notes ("AI Engineer (used for X, v3: leads with …)"). The resume pickers show only
// the role before any parenthesis, cut to a few words; the full line still goes to the resume-picker agent.
function shortLabel(role) {
  let s = String(role).replace(/\s*\(.*$/, '').replace(/\s+/g, ' ').trim() || String(role).trim();
  if (s.length > 30 && s.indexOf(',') > 2) s = s.slice(0, s.indexOf(',')).trim();
  if (s.length > 40) s = `${s.slice(0, 40).replace(/[\s,;:–-]+\S*$/, '')}…`;
  return s;
}

const MEMORY_ORDER =['profile', 'experience', 'education', 'projects', 'certifications', 'skills', 'achievements', 'documents', 'answers', 'applications'];

// Create any missing memory file from the blank templates. Plain file copies: free, no Claude needed.
function ensureMemory() {
  for (const d of [MEMORY_DIR, DOCS_DIR, path.join(MEMORY_DIR, 'resume')]) fs.mkdirSync(d, { recursive: true });
  const tdir = path.join(ROOT, 'templates', 'memory');
  for (const f of listDir(tdir)) {
    const dest = path.join(MEMORY_DIR, f);
    if (f.endsWith('.md') && !fs.existsSync(dest)) fs.copyFileSync(path.join(tdir, f), dest);
  }
}

// Setup is done once the profile has a name or an email in it.
function setupDone() {
  return /^- (Full legal name|Email):[ \t]*\S/m.test(readText(path.join(MEMORY_DIR, 'profile.md')));
}

// Files directly in memory/documents/ are new; files in a section folder have been filed.
function listDocuments() {
  const index = readText(path.join(MEMORY_DIR, 'documents.md')).replace(/<!--[\s\S]*?-->/g, '');
  const titles = {};
  for (const block of index.split(/^### /m).slice(1)) {
    const file = (block.match(/^- File:\s*(\S+)/m) || [])[1];
    if (file) titles[file.replace(/\\/g, '/')] = block.split('\n')[0].trim();
  }
  const fileInfo = (dir, f, sub) => {
    const st = fs.statSync(path.join(dir, f));
    const p = `memory/documents/${sub ? `${sub}/` : ''}${f}`;
    return { name: f, title: titles[p] || '', path: p, href: `${sub ? `${sub}/` : ''}${f}`, size: st.size, added: st.mtimeMs };
  };
  const filesIn = (dir, sub) => listDir(dir)
    .filter((f) => !f.startsWith('.') && !isDir(path.join(dir, f)))
    .map((f) => fileInfo(dir, f, sub))
    .sort((a, b) => a.name.localeCompare(b.name));

  const groups = [{ id: 'new', label: 'New: not filed yet', files: filesIn(DOCS_DIR, '').sort((a, b) => b.added - a.added) }];
  const known = new Set(SECTIONS.map(([id]) => id));
  for (const [id, label] of SECTIONS) groups.push({ id, label, files: filesIn(path.join(DOCS_DIR, id), id) });
  for (const d of listDir(DOCS_DIR)) {
    if (!known.has(d) && !d.startsWith('.') && isDir(path.join(DOCS_DIR, d))) groups.push({ id: d, label: d, files: filesIn(path.join(DOCS_DIR, d), d) });
  }

  const links = [];
  const section = index.split(/^## /m).find((s) => /^Links\b/.test(s)) || '';
  for (const block of section.split(/^### /m).slice(1)) {
    const title = block.split('\n')[0].trim();
    const url = (block.match(/^- Link:\s*(\S+)/m) || [])[1];
    const type = (block.match(/^- Type:\s*(.+)$/m) || [])[1] || '';
    if (url && /^https?:\/\//i.test(url)) links.push({ title, url, type: type.trim() });
  }
  return { groups: groups.filter((g) => g.id === 'new' || g.files.length), links };
}

// Uploads go to memory/documents/ (to be sorted) or, with ?to=resume, straight to memory/resume/.
async function saveUpload(req, url) {
  const raw = String(url.searchParams.get('name') || '');
  const ext = path.extname(raw).toLowerCase();
  const toResume = url.searchParams.get('to') === 'resume';
  if (!UPLOAD_TYPES[ext]) throw httpError(400, `Shiro can't keep ${ext || 'that kind of'} files. Use PDF, Word, images or text.`);
  if (toResume && !/^\.(pdf|docx?|md|txt|html?)$/.test(ext)) throw httpError(400, 'A resume should be a PDF, Word, HTML or text file.');
  const stem = path.basename(raw, path.extname(raw)).toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 80) || 'document';
  ensureMemory();
  const dir = toResume ? path.join(MEMORY_DIR, 'resume') : DOCS_DIR;
  let name = `${stem}${ext}`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${stem}-${i}${ext}`;
  const tmp = path.join(dir, `.${name}.part`);
  try {
    await new Promise((resolve, reject) => {
      let size = 0;
      const ws = fs.createWriteStream(tmp);
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_UPLOAD) { req.unpipe(ws); ws.destroy(); req.resume(); reject(httpError(413, 'Files can be up to 20 MB.')); }
      });
      req.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', () => (size ? resolve() : reject(httpError(400, 'That file is empty.'))));
      req.pipe(ws);
    });
    fs.renameSync(tmp, path.join(dir, name));
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return { name, path: `memory/${toResume ? 'resume' : 'documents'}/${name}` };
}

async function makePdf(rel) {
  const src = String(rel || '');
  if (!/^runs\/[^/.][^/]*\/[\w.-]+\.html$/.test(src)) throw httpError(400, 'Only HTML files in a run folder can be turned into PDFs.');
  try {
    return { pdf: await htmlToPdf(src, src.replace(/\.html$/, '.pdf')) };
  } catch (err) {
    throw httpError(500, err.message);
  }
}

// How many things a memory file holds, following each template's layout.
function countEntries(name, text) {
  const count = (re) => (text.match(re) || []).length;
  switch (name) {
    case 'profile': return { n: count(/^- [^:\n]+:[ \t]*\S/gm), unit: 'filled' };
    case 'skills': return { n: count(/^- \S/gm), unit: 'skills' };
    case 'certifications':
    case 'answers': return { n: count(/^### /gm), unit: 'entries' };
    case 'documents': return { n: count(/^### /gm), unit: 'files & links' };
    case 'applications': return { n: Math.max(0, count(/^\|/gm) - 2), unit: 'applications' };
    default: return { n: count(/^## /gm), unit: 'entries' };
  }
}

function memoryFiles() {
  const rank = (n) => { const i = MEMORY_ORDER.indexOf(n); return i < 0 ? 99 : i; };
  return listDir(MEMORY_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const content = readText(path.join(MEMORY_DIR, f));
      const name = f.replace(/\.md$/, '');
      return { name, content, ...countEntries(name, content.replace(/<!--[\s\S]*?-->/g, '')) };
    })
    .sort((a, b) => rank(a.name) - rank(b.name));
}

function runFiles(dir) {
  if (!dir || !/^[^/\\.][^/\\]*$/.test(dir) || !isDir(path.join(RUNS_DIR, dir))) throw httpError(400, 'Unknown run.');
  const root = path.join(RUNS_DIR, dir);
  const heads = (sub) => {
    const out = {};
    for (const f of listDir(path.join(root, sub))) {
      if (f.endsWith('.md')) out[f.replace(/\.md$/, '')] = readText(path.join(root, sub, f)).split('\n').find((l) => l.startsWith('# ')) || '';
    }
    return out;
  };
  const firstMatch = (f, re) => (readText(path.join(root, f)).match(re) || [])[0] || '';
  return {
    dir,
    feedback: heads('feedback'),
    round2: heads(path.join('round-2', 'feedback')),
    pick: firstMatch('pick.md', /\*\*Pick:\*\*.*$/m),
    debrief: firstMatch('debrief.md', /\*\*Average:\*\*.*$/m),
    files: listDir(root),
  };
}

function readProjectFile(rel) {
  const full = path.resolve(ROOT, String(rel || ''));
  if (!(inside(full, RUNS_DIR) || inside(full, MEMORY_DIR))) throw httpError(400, 'Only files in runs/ and memory/ can be read.');
  if (!/\.(md|txt|json)$/i.test(full)) throw httpError(400, 'Only text files can be read here.');
  if (!fs.existsSync(full)) throw httpError(404, 'Not written yet.');
  return { path: rel, content: readText(full) };
}

// ---------- HTTP ----------

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data), MIME['.json']);
}

function serveFile(res, full) {
  if (!full || !fs.existsSync(full) || isDir(full)) return send(res, 404, 'Not found');
  const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(full).pipe(res);
}

function safeJoin(dir, rel) {
  const full = path.resolve(dir, rel);
  return inside(full, dir) ? full : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 400000) { reject(httpError(413, 'Too much text.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(httpError(400, 'Bad JSON.')); }
    });
    req.on('error', reject);
  });
}

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  switch (route) {
    case 'GET /api/state':
      return json(res, 200, {
        version: VERSION,
        claude: claudeVersion,
        memory: setupDone(),
        resumes: listResumes(),
        runs: listRuns(),
        jobs: [...jobs.values()].map((j) => ({ id: j.id, kind: j.kind, running: j.running })),
      });
    case 'GET /api/usage': return json(res, 200, (await fetchUsage(url.searchParams.get('force') === '1')) || { windows: [] });
    case 'GET /api/memory': return json(res, 200, { files: memoryFiles(), documents: listDocuments() });
    case 'GET /api/memory-items': return json(res, 200, { items: memoryEditor.items(url.searchParams.get('file')) });
    case 'POST /api/forget': {
      const b = await readBody(req);
      if (b.doc) return json(res, 200, memoryEditor.forgetDoc(b.doc));
      if (b.link) return json(res, 200, memoryEditor.forgetLink(b.link));
      if (b.resume) return json(res, 200, memoryEditor.forgetResume(b.resume));
      return json(res, 200, memoryEditor.forgetItem(b.file, b.id));
    }
    case 'POST /api/undo': return json(res, 200, memoryEditor.undo((await readBody(req)).id));
    case 'POST /api/upload': return json(res, 200, await saveUpload(req, url));
    case 'POST /api/pdf': return json(res, 200, await makePdf((await readBody(req)).path));
    case 'GET /api/run-files': return json(res, 200, runFiles(url.searchParams.get('dir')));
    case 'GET /api/file': return json(res, 200, readProjectFile(url.searchParams.get('path')));
    case 'GET /api/events': return streamEvents(req, res, url.searchParams.get('job'));
    case 'POST /api/run': return json(res, 200, startJob(await readBody(req)));
    case 'POST /api/reply': return json(res, 200, replyJob(await readBody(req)));
    case 'POST /api/stop': {
      const job = jobs.get((await readBody(req)).jobId);
      if (job) stopJob(job);
      return json(res, 200, { ok: true });
    }
    default: return json(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    // Only answer requests addressed to this machine (blocks DNS-rebinding tricks).
    const h = req.headers.host || '';
    if (h !== `127.0.0.1:${PORT}` && h !== `localhost:${PORT}`) return send(res, 403, 'Forbidden');
    const url = new URL(req.url, `http://${h}`);
    const p = url.pathname;

    if (p.startsWith('/api/')) {
      const token = req.headers['x-shiro-token'] || url.searchParams.get('k');
      if (token !== TOKEN) return json(res, 401, { error: 'Session expired. Reload the page.' });
      const origin = req.headers.origin;
      if (req.method !== 'GET' && origin && origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) {
        return json(res, 403, { error: 'Bad origin.' });
      }
      return await api(req, res, url);
    }

    if (p.startsWith('/runs/')) {
      if (url.searchParams.get('k') !== TOKEN) return send(res, 401, 'Open this from the Shiro app.');
      return serveFile(res, safeJoin(RUNS_DIR, decodeURIComponent(p.slice('/runs/'.length))));
    }

    if (p.startsWith('/resume-file/')) {
      if (url.searchParams.get('k') !== TOKEN) return send(res, 401, 'Open this from the Shiro app.');
      const full = safeJoin(path.join(MEMORY_DIR, 'resume'), decodeURIComponent(p.slice('/resume-file/'.length)));
      const ext = full ? path.extname(full).toLowerCase() : '';
      if (!full || !UPLOAD_TYPES[ext] || !fs.existsSync(full) || isDir(full)) return send(res, 404, 'Not found');
      res.writeHead(200, {
        'Content-Type': UPLOAD_TYPES[ext],
        'Content-Disposition': `${INLINE_TYPES.has(ext) ? 'inline' : 'attachment'}; filename="${path.basename(full)}"`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        ...(ext !== '.pdf' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}),
      });
      return fs.createReadStream(full).pipe(res);
    }

    if (p.startsWith('/docs/')) {
      if (url.searchParams.get('k') !== TOKEN) return send(res, 401, 'Open this from the Shiro app.');
      const full = safeJoin(DOCS_DIR, decodeURIComponent(p.slice('/docs/'.length)));
      const ext = full ? path.extname(full).toLowerCase() : '';
      if (!full || !UPLOAD_TYPES[ext] || !fs.existsSync(full) || isDir(full)) return send(res, 404, 'Not found');
      const headers = {
        'Content-Type': UPLOAD_TYPES[ext],
        'Content-Disposition': `${INLINE_TYPES.has(ext) ? 'inline' : 'attachment'}; filename="${path.basename(full)}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      };
      // Lock down everything except PDFs (a strict policy breaks Chrome's PDF viewer).
      if (ext !== '.pdf') headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'";
      res.writeHead(200, headers);
      return fs.createReadStream(full).pipe(res);
    }

    if (p === '/' || p === '/index.html') {
      const html = readText(path.join(PUBLIC_DIR, 'index.html')).replace('__SHIRO_TOKEN__', TOKEN);
      return send(res, 200, html, MIME['.html']);
    }

    return serveFile(res, safeJoin(PUBLIC_DIR, decodeURIComponent(p.slice(1))));
  } catch (err) {
    if (!err.status) console.error('[shiro]', err);
    if (!res.headersSent) json(res, err.status || 500, { error: err.message });
  }
});

function detectClaude() {
  const child = IS_WIN
    ? spawn('claude', ['--version'], { shell: true, windowsHide: true })
    : spawn('claude', ['--version']);
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.on('error', () => {});
  child.on('close', (code) => {
    claudeVersion = code === 0 ? out.trim() : null;
    if (!claudeVersion) console.warn('[shiro] Claude Code was not found on PATH. Install it and run `claude` → /login first.');
  });
}

function openBrowser(u) {
  if (process.env.SHIRO_NO_OPEN) return;
  const [cmd, args] = IS_WIN ? ['explorer.exe', [u]] : process.platform === 'darwin' ? ['open', [u]] : ['xdg-open', [u]];
  execFile(cmd, args, () => {});
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`[shiro] Port ${PORT} is busy. Is Shiro already open? Or start with SHIRO_PORT=4848.`);
  else console.error('[shiro]', err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const u = `http://${HOST}:${PORT}/`;
  console.log(`\n  Shiro is running at ${u}\n  Runs use your Claude subscription. Animations are free.\n  Press Ctrl+C to stop.\n`);
  detectClaude();
  openBrowser(u);
});

function shutdown() {
  for (const job of jobs.values()) stopJob(job);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
