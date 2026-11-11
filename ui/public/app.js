// Shiro front end. Everything visual happens here in the browser and costs no tokens.
// Claude is only involved when you press Start / Remember / Send, and the server streams its events back.

import {
  ROSTER, PANEL, critterSVG, createAgent, setAgentState, say, setVerdict, clearVerdict, setTokens,
} from './creatures.js';
import { renderMarkdown } from './markdown.js';
import { demoReview, demoApply, demoRemember } from './demo.js';

const TOKEN = document.querySelector('meta[name="shiro-token"]').content;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const basename = (p) => String(p || '').split(/[\\/]/).pop();
const shorten = (s, n = 60) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const VERDICT_RE = /\b(REJECT|MAYBE|ADVANCE)\b\D{0,4}(\d+(?:\.\d+)?)\s*\/\s*10/i;
const SCORE_RE = /(\d+(?:\.\d+)?)\s*\/\s*10/;

const store = {
  get(k, d) { try { const v = localStorage.getItem(`shiro.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`shiro.${k}`, JSON.stringify(v)); } catch { /* storage off: fine */ } },
};

// ---------- server ----------

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-shiro-token': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 404 && data.error === 'Not found') {
    showOutdated();
    throw new Error('The app server is out of date. Restart it: Ctrl+C, then npm run ui.');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Must match VERSION in ui/server.mjs. A mismatch means an old server is still running.
const APP_VERSION = '0.9.1';
let appState = { resumes: [], runs: [], memory: false, jobs: [] };

function showOutdated() {
  $('#versionBanner').hidden = false;
}

async function refreshState() {
  try { appState = await api('/api/state'); } catch (err) { toast(err.message); return appState; }
  if (appState.version !== APP_VERSION) showOutdated();
  fillResumeSelects();
  renderPastRuns();
  return appState;
}

// ---------- small UI helpers ----------

let toastTimer;
let toastRun = null;
// toast('Saved') or toast('Removed X.', { label: 'Undo', run: fn }): the action button stays up longer.
function toast(msg, action) {
  const t = $('#toast');
  $('#toastText').textContent = msg;
  const btn = $('#toastAction');
  toastRun = action ? action.run : null;
  btn.hidden = !action;
  if (action) btn.textContent = action.label;
  t.classList.toggle('has-action', Boolean(action));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); toastRun = null; }, action ? 9000 : 4500);
}
$('#toastAction').addEventListener('click', () => {
  const run = toastRun;
  toastRun = null;
  $('#toast').classList.remove('show');
  if (run) run();
});

function fly(from, to, cls = '') {
  if (!from || !to || reduceMotion.matches || document.hidden) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const el = document.createElement('div');
  el.className = `flyer ${cls}`;
  document.body.append(el);
  const x0 = a.left + a.width / 2; const y0 = a.top + a.height / 2;
  const x1 = b.left + b.width / 2; const y1 = b.top + b.height / 2;
  const mx = (x0 + x1) / 2 + (Math.random() * 40 - 20);
  const my = Math.min(y0, y1) - 50;
  const at = (x, y, s, r) => `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s}) rotate(${r}deg)`;
  const anim = el.animate([
    { transform: at(x0, y0, 0.5, -10), opacity: 0 },
    { transform: at(x0, y0 - 10, 0.9, -6), opacity: 1, offset: 0.12 },
    { transform: at(mx, my, 1, 8), opacity: 1, offset: 0.55 },
    { transform: at(x1, y1, 0.55, 0), opacity: 0.25 },
  ], { duration: 950 + Math.random() * 300, easing: 'cubic-bezier(.45,.05,.3,1)' });
  anim.onfinish = () => el.remove();
  anim.oncancel = () => el.remove();
}

function makeTicker(list) {
  const fn = (text, who, bad) => {
    const li = document.createElement('li');
    if (bad) li.className = 'bad';
    const time = document.createElement('time');
    time.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    const span = document.createElement('span');
    if (who) { const b = document.createElement('b'); b.textContent = `${who} `; span.append(b); }
    span.append(shorten(text, 160));
    li.append(time, span);
    list.prepend(li);
    while (list.children.length > 120) list.lastElementChild.remove();
  };
  fn.clear = () => { list.innerHTML = ''; };
  return fn;
}

function setFlow(name, on) {
  const el = $(`.flow[data-flow="${name}"]`);
  if (el) el.classList.toggle('active', on);
}

// ---------- drawer ----------

let lastFocus = null;
function openDrawer(key, title, sub, markdown) {
  lastFocus = document.activeElement;
  $('#drawerCritter').innerHTML = critterSVG(key);
  $('#drawerTitle').textContent = title;
  $('#drawerSub').textContent = sub || '';
  $('#drawerBody').innerHTML = renderMarkdown(markdown);
  $('#drawerBody').scrollTop = 0;
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#scrim').hidden = false;
  $('#drawerClose').focus();
}
function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#scrim').hidden = true;
  if (lastFocus) lastFocus.focus();
}
$('#drawerClose').addEventListener('click', closeDrawer);
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#drawer').classList.contains('open')) closeDrawer(); });

async function openFile(rel, key, title) {
  const r = ROSTER[key];
  try {
    const f = await api(`/api/file?path=${encodeURIComponent(rel)}`);
    openDrawer(key, title || r.name, rel, f.content);
  } catch (err) {
    openDrawer(key, title || r.name, rel, `*${err.message}*`);
  }
}

// ---------- tabs, effort, usage ----------

function showTab(name) {
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const v of $$('.view')) {
    const on = v.id === `view-${name}`;
    v.hidden = !on;
    v.classList.toggle('active', on);
  }
  if (currentTab !== name) window.scrollTo({ top: 0 });
  store.set('tab', name);
  currentTab = name;
  renderSettings();
  if (name === 'memory') memory.load();
}
$$('.tabs button').forEach((b, i, all) => {
  b.addEventListener('click', () => showTab(b.dataset.tab));
  b.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
    next.focus();
    showTab(next.dataset.tab);
  });
});

// Each tab has its own model and effort, so reviews can run on a big model while
// memory and form filling stay cheap. Change them anytime; they're remembered per tab.
const EFFORT_HINTS = {
  low: 'fastest, fewest tokens',
  medium: 'balanced',
  high: 'deeper, more tokens',
  xhigh: 'very thorough, uses a lot of your limit',
  max: 'everything it has; best on Max plans',
};
const MODEL_NAMES = { opus: 'Opus 5.5', sonnet: 'Sonnet 5.5', haiku: 'Haiku 5.5', fable: 'Fable 5.1', default: 'your default model' };
const TAB_NAMES = { review: 'Review', apply: 'Apply', memory: 'Memory' };
const DEFAULT_SETTINGS = {
  review: { model: 'opus', effort: 'medium' },
  apply: { model: 'sonnet', effort: 'low' },
  memory: { model: 'sonnet', effort: 'low' },
};
const savedSettings = store.get('settings', {});
const settings = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([tab, d]) => {
  const s = savedSettings[tab] || {};
  return [tab, { model: MODEL_NAMES[s.model] ? s.model : d.model, effort: EFFORT_HINTS[s.effort] ? s.effort : d.effort }];
}));
let currentTab = 'review';
const tabOf = (kind) => (kind === 'remember' ? 'memory' : kind);
const settingsFor = (kind) => ({ ...settings[tabOf(kind)] });

function renderSettings() {
  const s = settings[currentTab];
  $('#rsFor').textContent = `${TAB_NAMES[currentTab]} uses`;
  $('#modelSelect').value = s.model;
  // Reviews set model and effort per agent (Team list), so the single controls are hidden there.
  const perAgent = currentTab === 'review';
  $('.effort').hidden = perAgent;
  $('#modelSelect').hidden = perAgent;
  if (perAgent) $('#rsFor').textContent = 'Models and effort: set per agent under Team';
  for (const b of $$('.effort button')) {
    b.setAttribute('aria-checked', String(b.dataset.effort === s.effort));
    b.title = EFFORT_HINTS[b.dataset.effort];
  }
  $('#effortHint').textContent = '';
  $('.run-settings').title = perAgent ? '' : `${TAB_NAMES[currentTab]} runs on ${MODEL_NAMES[s.model]} · ${s.effort} effort: ${EFFORT_HINTS[s.effort]}`;
}

// ---------- Review team: on/off and effort per agent ----------
// Recommended efforts: High only where the output is the product (writer); Medium where judgment needs depth.
const TEAM_ORDER = ['resume-picker', ...PANEL, 'debrief', 'resume-writer'];
const RECOMMENDED = {
  'resume-picker': 'low', ats: 'low', recruiter: 'low', 'hiring-manager': 'medium', teammate: 'low',
  'rival-applicant': 'medium', ceo: 'low', 'technical-interviewer': 'medium', skeptic: 'medium',
  'skip-level-manager': 'low', 'hr-screener': 'low', 'design-lead': 'medium', debrief: 'medium', 'resume-writer': 'high',
};
// Recommended models: Sonnet where the job is reading and judging against a checklist (nearly as good,
// much cheaper); Opus where quality shows up directly in what you get (the fix plan and the new resume).
const RECOMMENDED_MODEL = Object.fromEntries(TEAM_ORDER.map((k) => [k, ['debrief', 'resume-writer'].includes(k) ? 'opus' : 'sonnet']));
const MODEL_SHORT = { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku', fable: 'Fable' };
const EFFORT_SHORT = { low: 'L', medium: 'M', high: 'H' };
const savedTeam = store.get('team', {});
const team = Object.fromEntries(TEAM_ORDER.map((k) => {
  const s = savedTeam[k] || {};
  return [k, {
    on: s.on !== false,
    effort: EFFORT_SHORT[s.effort] ? s.effort : RECOMMENDED[k],
    model: MODEL_SHORT[s.model] ? s.model : RECOMMENDED_MODEL[k],
  }];
}));

function saveTeam() {
  store.set('team', team);
  const n = TEAM_ORDER.filter((k) => team[k].on).length;
  $('#teamCount').textContent = `${n} of ${TEAM_ORDER.length} on`;
  applyTeamToCards();
}

function applyTeamToCards() {
  for (const k of TEAM_ORDER) {
    const el = review.agents?.[k];
    if (el) el.dataset.off = String(!team[k].on);
  }
}

function renderTeam() {
  const ul = $('#teamList');
  ul.innerHTML = '';
  for (const k of TEAM_ORDER) {
    const r = ROSTER[k];
    const li = document.createElement('li');
    li.className = team[k].on ? '' : 'off';
    li.innerHTML = `
      <label class="switch" title="Switch ${esc(r.name)} on or off"><input type="checkbox" ${team[k].on ? 'checked' : ''} aria-label="${esc(r.name)} (${esc(r.role)}) on"><span></span></label>
      <span class="tm-critter">${critterSVG(k)}</span>
      <span class="tm-name"><b>${esc(r.name)}</b><small>${esc(r.role)}</small></span>
      <select class="tm-model" aria-label="${esc(r.name)} model" title="Model for ${esc(r.name)}">
        ${Object.entries(MODEL_SHORT).map(([m, label]) => `<option value="${m}" ${team[k].model === m ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <span class="mini-seg" role="radiogroup" aria-label="${esc(r.name)} effort">
        ${['low', 'medium', 'high'].map((e) => `<button type="button" role="radio" data-e="${e}" class="${team[k].effort === e ? 'on' : ''}" aria-checked="${team[k].effort === e}" title="${e} effort">${EFFORT_SHORT[e]}</button>`).join('')}
      </span>`;
    $('input', li).addEventListener('change', (e) => {
      team[k].on = e.target.checked;
      li.className = team[k].on ? '' : 'off';
      saveTeam();
    });
    $('.tm-model', li).addEventListener('change', (e) => {
      team[k].model = e.target.value;
      saveTeam();
    });
    for (const b of $$('.mini-seg button', li)) {
      b.addEventListener('click', () => {
        team[k].effort = b.dataset.e;
        for (const x of $$('.mini-seg button', li)) { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }
        saveTeam();
      });
    }
    ul.append(li);
  }
  saveTeam();
}
$('#teamReset').addEventListener('click', () => {
  for (const k of TEAM_ORDER) team[k] = { on: true, effort: RECOMMENDED[k], model: RECOMMENDED_MODEL[k] };
  renderTeam();
  toast('Recommended: Sonnet for the picker and reviewers, Opus for the debrief and writer, all agents on.');
});
for (const [id, model] of [['#teamAllSonnet', 'sonnet'], ['#teamAllOpus', 'opus']]) {
  $(id).addEventListener('click', () => {
    for (const k of TEAM_ORDER) team[k].model = model;
    renderTeam();
    toast(`Every agent now uses ${MODEL_SHORT[model]}. Efforts and switches are unchanged.`);
  });
}

function changeSetting(key, value) {
  settings[currentTab][key] = value;
  store.set('settings', settings);
  renderSettings();
}
$$('.effort button').forEach((b) => b.addEventListener('click', () => changeSetting('effort', b.dataset.effort)));
$('#modelSelect').addEventListener('change', (e) => changeSetting('model', e.target.value));

// Usage bars show the same numbers as /usage in Claude Code. The server asks Claude Code for
// /usage, which is answered locally without a model call, so refreshing costs no tokens.
let usageState = store.get('usage2', null);

function renderUsage(u) {
  if (!u || !Array.isArray(u.windows) || !u.windows.length) return;
  usageState = u;
  store.set('usage2', u);
  const session = u.windows.find((w) => /session/i.test(w.label));
  const week = u.windows.find((w) => /week/i.test(w.label) && /all/i.test(w.label)) || u.windows.find((w) => /week/i.test(w.label));
  setMeter('#mSession', session);
  setMeter('#mWeek', week);
  const when = new Date(u.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const lines = u.windows.map((w) => `${w.label}: ${w.pct}% used${w.resets ? ` · resets ${w.resets}` : ''}`);
  $('#usage').title = `${lines.join('\n')}\nUpdated ${when}. Click to refresh (free).`;
}

function setMeter(sel, w) {
  const m = $(sel);
  if (!w) return;
  const pct = Math.round(w.pct);
  m.querySelector('b').style.width = `${Math.min(100, pct)}%`;
  m.querySelector('em').textContent = `${pct}%`;
  m.classList.toggle('warn', pct >= 60 && pct < 85);
  m.classList.toggle('hot', pct >= 85);
}

async function loadUsage(force) {
  const el = $('#usage');
  el.classList.add('loading');
  try {
    const u = await api(`/api/usage${force ? '?force=1' : ''}`);
    if (u.windows && u.windows.length) renderUsage(u);
    else if (force) toast('Usage isn’t available. Is Claude Code signed in with your Pro or Max account?');
  } catch (err) {
    if (force) toast(err.message);
  } finally {
    el.classList.remove('loading');
  }
}

// Live numbers from a running job, between /usage checks.
function showUsage(rl) {
  const w = rl && rl.unifiedWindows;
  if (!w) return;
  const windows = usageState?.windows ? usageState.windows.map((x) => ({ ...x })) : [];
  const put = (re, label, win) => {
    if (!win || win.utilization == null) return;
    const pct = Math.round(win.utilization * 100);
    const i = windows.findIndex((x) => re.test(x.label));
    if (i >= 0) windows[i].pct = pct;
    else windows.push({ label, pct, resets: '' });
  };
  put(/session/i, 'Current session', w.five_hour);
  put(/week.*all/i, 'Current week (all models)', w.seven_day);
  renderUsage({ windows, at: Date.now() });
}

// ---------- conversation box ----------

function makeConvo(root, onReply) {
  root.innerHTML = `
    <div class="convo-head"><span class="mini">${critterSVG(null)}</span><b>Claude</b><span class="status"></span></div>
    <div class="convo-body md"></div>
    <form>
      <textarea rows="2" placeholder="Reply to Claude…"></textarea>
      <div class="row"><small>Continues this run with this tab’s model and effort. Ctrl+Enter sends.</small><button class="btn small primary" type="submit">Send</button></div>
    </form>`;
  const body = $('.convo-body', root);
  const form = $('form', root);
  const ta = $('textarea', root);
  const status = $('.status', root);
  const btn = $('button', form);
  form.hidden = true;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    btn.disabled = true;
    try { await onReply(text); ta.value = ''; } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
  // Scroll so the start of the newest message is visible, not its end.
  const add = (node) => { root.hidden = false; body.append(node); body.scrollTop = Math.max(0, node.offsetTop - 8); };
  return {
    reset() { body.innerHTML = ''; root.hidden = true; form.hidden = true; status.textContent = ''; },
    you(text) { const d = document.createElement('div'); d.className = 'you'; d.textContent = text; add(d); },
    claude(md) { const d = document.createElement('div'); d.innerHTML = renderMarkdown(md); add(d); },
    status(s) { status.textContent = s; },
    canReply(on) { form.hidden = !on; },
  };
}

// ---------- a run: real (server events) or demo (local fake events) ----------

class Runner {
  constructor(kind, scene, ids, demoFn) {
    this.kind = kind;
    this.scene = scene;
    this.demoFn = demoFn;
    this.startBtn = $(ids.start);
    this.stopBtn = $(ids.stop);
    this.demoBtn = $(ids.demo);
    this.convo = makeConvo($(ids.convo), (text) => this.reply(text));
    this.stopBtn.addEventListener('click', () => this.stop());
    this.demoBtn.addEventListener('click', () => this.playDemo(ids.demoArg ? ids.demoArg() : undefined));
  }

  prepare(demo, keepScene = false) {
    this.closeStream();
    if (this.cancelDemo) this.cancelDemo();
    this.cancelDemo = null;
    this.demo = demo;
    this.sawUser = false;
    this.jobId = null;
    this.convo.reset();
    if (!keepScene) this.scene.reset();
  }

  async start(payload, { keepScene = false } = {}) {
    if (this.running) { toast('Wait for the current run to finish first.'); return false; }
    this.startBtn.disabled = true;
    try {
      const { jobId } = await api('/api/run', { kind: this.kind, ...settingsFor(this.kind), ...payload });
      this.prepare(false, keepScene);
      this.attach(jobId);
      return true;
    } catch (err) {
      toast(err.message);
      this.startBtn.disabled = false;
      return false;
    }
  }

  attach(jobId) {
    this.jobId = jobId;
    this.setRunning(true);
    this.es = new EventSource(`/api/events?job=${encodeURIComponent(jobId)}&k=${TOKEN}`);
    this.es.onmessage = (m) => this.dispatch(JSON.parse(m.data));
    this.es.onerror = () => {
      if (this.es && this.es.readyState === EventSource.CLOSED) { this.setRunning(false); toast('Lost the connection to the Shiro server.'); }
    };
  }

  closeStream() {
    if (this.es) this.es.close();
    this.es = null;
  }

  playDemo(arg) {
    if (this.running) return;
    this.prepare(true);
    this.setRunning(true);
    this.cancelDemo = this.demoFn((ev) => this.dispatch(ev), arg);
  }

  async reply(text) {
    if (this.demo) throw new Error('Replies are off in the demo.');
    await api('/api/reply', { jobId: this.jobId, text, ...settingsFor(this.kind) });
    this.setRunning(true);
  }

  async stop() {
    if (this.demo) {
      if (this.cancelDemo) this.cancelDemo();
      this.dispatch({ kind: 'exit', code: 0, stopped: true });
      return;
    }
    if (this.jobId) await api('/api/stop', { jobId: this.jobId }).catch((e) => toast(e.message));
  }

  dispatch(ev) {
    switch (ev.kind) {
      case 'user':
        if (this.sawUser) this.convo.you(ev.text);
        this.sawUser = true;
        break;
      case 'started':
        this.setRunning(true);
        this.convo.status(this.demo ? 'demo · no tokens' : `working · ${MODEL_NAMES[ev.model] || ev.model || ''} · ${ev.effort} effort`);
        break;
      case 'usage':
        showUsage(ev.usage);
        break;
      case 'error':
        toast(ev.text);
        break;
      case 'exit': {
        this.setRunning(false);
        let text = ev.result;
        if (!text) {
          if (ev.stopped) text = '*Stopped.*';
          else if (ev.stderr) text = `Claude Code stopped with an error:\n\n\`\`\`\n${ev.stderr}\n\`\`\``;
          else text = '*Done.*';
        }
        this.convo.claude(text);
        this.convo.status(this.demo ? 'demo finished' : ev.stopped ? 'stopped' : ev.isError ? 'ended with an error' : 'done · reply to continue');
        this.convo.canReply(!this.demo && !ev.stopped && !ev.noReply && Boolean(this.jobId));
        if (!this.demo) { refreshState(); loadUsage(true); }
        break;
      }
      default:
        break;
    }
    this.scene.handle(ev, this);
  }

  setRunning(on) {
    this.running = on;
    this.startBtn.disabled = on;
    this.demoBtn.disabled = on;
    this.stopBtn.hidden = !on;
    if (on) this.convo.canReply(false);
    // A pulsing dot on the tab shows which part is busy, from any tab.
    const tab = $(`#tab-${this.kind === 'remember' ? 'memory' : this.kind}`);
    if (tab) tab.classList.toggle('busy', on);
  }
}

// ---------- Review scene ----------

const review = {
  agents: {},
  idToKey: new Map(),
  summaries: {},
  tick: makeTicker($('#reviewTicker')),

  init() {
    $('#slot-picker').append(this.agents['resume-picker'] = createAgent('resume-picker'));
    for (const k of PANEL) $('#panelGrid').append(this.agents[k] = createAgent(k));
    $('#slot-debrief').append(this.agents.debrief = createAgent('debrief', { size: 'lg' }));
    $('#slot-writer').append(this.agents['resume-writer'] = createAgent('resume-writer', { size: 'lg' }));
    for (const [k, el] of Object.entries(this.agents)) el.addEventListener('click', () => this.openAgent(k));
    for (const b of $$('#outputActions [data-open]')) {
      b.addEventListener('click', () => {
        if (!this.runDir) return toast('That opens the real file after a real run.');
        openFile(`runs/${this.runDir}/${b.dataset.open}`, 'resume-writer', b.textContent);
      });
    }
    $('#openResume').addEventListener('click', (e) => {
      if (!this.runDir) { e.preventDefault(); toast('In a real run this opens your new resume.'); }
    });
    $('#makePdf').addEventListener('click', () => this.makePdf());
    $('#round2').addEventListener('click', () => {
      if (!this.runDir) { toast('After a real run, this re-scores the new resume with the same reviewers.'); return; }
      reviewRunner.start({ round2Dir: this.runDir, agents: team }, { keepScene: true });
    });
    this.reset();
  },

  async makePdf() {
    if (!this.runDir) { toast('After a real run, this turns the new resume into a PDF for free.'); return; }
    const btn = $('#makePdf');
    btn.disabled = true;
    btn.textContent = 'Making PDF…';
    try {
      const { pdf } = await api('/api/pdf', { path: `runs/${this.runDir}/resume.html` });
      toast(`Saved ${pdf}`);
      this.showPdf(true);
      refreshState();
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = $('#openPdf').hidden ? 'Make PDF' : 'Remake PDF';
    }
  },

  showPdf(on) {
    const a = $('#openPdf');
    a.hidden = !on;
    if (!on) return;
    a.href = `/runs/${encodeURIComponent(this.runDir)}/resume.pdf?k=${TOKEN}`;
    $('#makePdf').textContent = 'Remake PDF';
    $('#outputNote').textContent = 'resume.pdf is ready for Apply';
  },

  syncPdf() {
    const r = appState.runs.find((x) => x.dir === this.runDir);
    if (r && r.hasPdf) this.showPdf(true);
  },

  reset() {
    for (const el of Object.values(this.agents)) {
      setAgentState(el, 'idle');
      clearVerdict(el);
      setTokens(el, 0);
    }
    this.idToKey.clear();
    this.summaries = {};
    this.runDir = null;
    this.round2 = false;
    this.started = 0;
    this.reported = 0;
    for (const f of ['panel', 'debrief', 'writer', 'output']) setFlow(f, false);
    $('#outputCard').classList.remove('ready');
    $('#outputActions').hidden = true;
    $('#openPdf').hidden = true;
    $('#makePdf').textContent = 'Make PDF';
    $('#outputNote').textContent = 'Not written yet';
    $('#inboxJd').textContent = 'Waiting for a job…';
    $('#inboxResume').textContent = 'Best match';
    $('#panelCount').textContent = '';
    this.tick.clear();
    applyTeamToCards();
  },

  updateCount() {
    $('#panelCount').textContent = this.started ? `${this.reported}/${this.started} reported${this.round2 ? ' · round 2' : ''}` : '';
  },

  handle(ev, runner) {
    this.runner = runner;
    const key = ev.id ? this.idToKey.get(ev.id) || ev.agent : ev.agent;
    const el = this.agents[key];
    const name = ROSTER[key]?.name || key;

    switch (ev.kind) {
      case 'started':
        if (!ev.resumed) this.tick(runner.demo ? 'Demo started. No tokens are used.' : 'Claude is getting ready…');
        break;
      case 'init':
        if (!runner.demo) this.tick(`Connected (${ev.model})`);
        break;
      case 'run_dir':
        this.runDir = ev.dir;
        $('#inboxJd').textContent = ev.dir;
        break;
      case 'tool':
        if (/^Writing jd\.md/.test(ev.text)) $('#inboxJd').textContent = 'Saved for the panel';
        if (/^Fetching/.test(ev.text)) $('#inboxJd').textContent = ev.text;
        this.tick(ev.text, 'Claude');
        break;
      case 'text':
        this.tick(ev.text, 'Claude');
        break;
      case 'agent_start':
        this.idToKey.set(ev.id, ev.agent);
        this.agentStart(ev.agent, ev);
        break;
      case 'agent_activity':
        if (el && el.dataset.state === 'working') {
          if (ev.text) say(el, shorten(ev.text, 30));
          if (ev.tokens) setTokens(el, ev.tokens);
        }
        break;
      case 'agent_done':
        this.agentDone(key, el, name, ev);
        break;
      case 'exit':
        for (const f of ['panel', 'debrief', 'writer']) setFlow(f, false);
        for (const a of Object.values(this.agents)) if (a.dataset.state === 'working') setAgentState(a, ev.stopped ? 'idle' : 'error');
        if (ev.stopped) this.tick('Stopped.');
        if (!runner.demo && this.runDir) refreshState().then(() => this.syncPdf());
        break;
      default:
        break;
    }
  },

  agentStart(key, ev) {
    const el = this.agents[key];
    if (!el) { this.tick(`Started a ${key} helper`, 'Claude'); return; }
    const name = ROSTER[key].name;
    if (PANEL.includes(key)) {
      if (el.dataset.state === 'done' && !this.round2) {
        this.round2 = true;
        this.started = 0;
        this.reported = 0;
        this.tick('Round 2: the panel reads the new resume');
      }
      this.started++;
      this.updateCount();
      clearVerdict(el);
      setFlow('panel', true);
      fly(this.round2 ? $('#outputCard') : $('#inbox'), el);
    } else if (key === 'resume-picker') {
      fly($('#inbox'), el);
    } else if (key === 'debrief') {
      clearVerdict(el);
      setFlow('debrief', true);
      fly($('#panelZone'), el);
    } else if (key === 'resume-writer') {
      clearVerdict(el);
      setFlow('writer', true);
      fly(this.agents.debrief, el);
    }
    setAgentState(el, 'working');
    say(el, shorten(ev.text || 'On it', 30));
    this.tick(ev.text || 'Started', name);
  },

  agentDone(key, el, name, ev) {
    if (!el) return;
    setTokens(el, ev.tokens);
    const summary = ev.summary || '';
    this.summaries[key] = summary;
    if (ev.status && ev.status !== 'completed') {
      setAgentState(el, 'error');
      this.tick(`stopped (${ev.status})`, name, true);
      if (PANEL.includes(key)) { this.reported++; this.updateCount(); }
      return;
    }
    setAgentState(el, 'done');

    if (PANEL.includes(key)) {
      const m = summary.match(VERDICT_RE);
      const verdict = m ? m[1].toUpperCase() : 'DONE';
      setVerdict(el, verdict, m ? m[2] : '');
      fly(el, this.agents.debrief, `slip v-${verdict.toLowerCase()}`);
      this.reported++;
      this.updateCount();
      if (this.reported >= this.started) setFlow('panel', false);
      this.tick(shorten(summary.replace(VERDICT_RE, '').replace(/^[\s—–-]+/, ''), 140) || 'Report written', `${name} · ${verdict}${m ? ` ${m[2]}/10` : ''}`);
    } else if (key === 'resume-picker') {
      const m = summary.match(/PICK\s+`?([^\s`]+)`?/i);
      if (m) $('#inboxResume').textContent = basename(m[1]);
      setVerdict(el, 'PICKED');
      this.tick(shorten(summary.replace(/^PICK\s+/i, ''), 140), name);
    } else if (key === 'debrief') {
      const m = summary.match(SCORE_RE);
      setVerdict(el, 'AVG', m ? m[1] : '');
      setFlow('debrief', false);
      this.tick(shorten(summary, 140), name);
    } else if (key === 'resume-writer') {
      setVerdict(el, 'DONE');
      setFlow('writer', false);
      setFlow('output', true);
      setTimeout(() => setFlow('output', false), 1600);
      fly(el, $('#outputCard'), 'fresh');
      setTimeout(() => {
        $('#outputCard').classList.add('ready');
        $('#outputActions').hidden = false;
        $('#outputNote').textContent = this.runDir ? 'Written. The PDF comes next.' : 'Ready (demo)';
        $('#openResume').href = this.runDir ? `/runs/${encodeURIComponent(this.runDir)}/resume.html?k=${TOKEN}` : '#';
      }, 900);
      this.tick(shorten(summary, 140), name);
    }
  },

  async openAgent(key) {
    const r = ROSTER[key];
    let file = null;
    if (this.runDir) {
      if (PANEL.includes(key)) file = `runs/${this.runDir}/${this.round2 ? 'round-2/' : ''}feedback/${key}.md`;
      else if (key === 'resume-picker') file = `runs/${this.runDir}/pick.md`;
      else if (key === 'debrief') file = `runs/${this.runDir}/debrief.md`;
      else if (key === 'resume-writer') file = `runs/${this.runDir}/changes.md`;
    }
    if (file) return openFile(file, key, `${r.name} · ${r.role}`);
    let md = `**How ${r.name} works:** ${r.bio}`;
    if (this.summaries[key]) md += `\n\n**Latest reply:** ${this.summaries[key]}`;
    md += this.runner?.demo
      ? '\n\n*This is the demo, so there’s no real report. After a real run, the full report opens here.*'
      : '\n\n*Their full report opens here once a run has written it.*';
    openDrawer(key, r.name, r.role, md);
  },

  async loadRun(dir) {
    if (reviewRunner.running) { toast('Wait for the current run to finish first.'); return; }
    let data;
    try { data = await api(`/api/run-files?dir=${encodeURIComponent(dir)}`); } catch (err) { toast(err.message); return; }
    reviewRunner.prepare(false);
    this.runner = reviewRunner;
    this.runDir = dir;
    $('#inboxJd').textContent = dir;
    const r2 = Object.keys(data.round2).length > 0;
    this.round2 = r2;
    const heads = r2 ? data.round2 : data.feedback;
    for (const [k, line] of Object.entries(heads)) {
      const el = this.agents[k];
      if (!el || !PANEL.includes(k)) continue;
      setAgentState(el, 'done');
      const m = line.match(VERDICT_RE);
      setVerdict(el, m ? m[1].toUpperCase() : 'DONE', m ? m[2] : '');
      this.started++;
      this.reported++;
    }
    this.updateCount();
    if (data.pick) {
      setAgentState(this.agents['resume-picker'], 'done');
      setVerdict(this.agents['resume-picker'], 'PICKED');
      const m = data.pick.match(/`([^`]+)`/);
      if (m) $('#inboxResume').textContent = basename(m[1]);
    }
    if (data.files.includes('debrief.md')) {
      setAgentState(this.agents.debrief, 'done');
      const m = data.debrief.match(SCORE_RE);
      setVerdict(this.agents.debrief, 'AVG', m ? m[1] : '');
    }
    if (data.files.includes('resume.md')) {
      setAgentState(this.agents['resume-writer'], 'done');
      setVerdict(this.agents['resume-writer'], 'DONE');
      $('#outputCard').classList.add('ready');
      $('#outputActions').hidden = false;
      $('#outputNote').textContent = 'No PDF yet. Press Make PDF.';
      $('#openResume').href = `/runs/${encodeURIComponent(dir)}/resume.html?k=${TOKEN}`;
      if (data.files.includes('resume.pdf')) this.showPdf(true);
    }
    this.tick(`Loaded ${dir}. Click any reviewer to read their report.`);
  },
};

// ---------- Apply scene ----------

const apply = {
  tick: makeTicker($('#applyTicker')),

  init() {
    $('#slot-filler').append(this.agent = createAgent('filler', { size: 'lg' }));
    this.agent.addEventListener('click', () => {
      const r = ROSTER.filler;
      openDrawer('filler', r.name, r.role, `**How ${r.name} works:** ${r.bio}\n\n- Uploads your resume first, then fixes whatever the site’s parser got wrong.\n- Fills from your memory and reuses answers you’ve given before.\n- Drafts open answers and marks them as drafts.\n- Never creates accounts, types passwords, ticks consent boxes or presses Submit.`);
    });
    this.reset();
  },

  reset() {
    setAgentState(this.agent, 'idle');
    clearVerdict(this.agent);
    $('#formRows').innerHTML = '<li class="ghost">Fields appear here as Fillo fills them</li>';
    $('#browserUrl').textContent = 'Waiting for a link…';
    $('#applyStamp').classList.remove('show');
    this.filled = 0;
    this.uploaded = 0;
    this.updateStats();
    const chrome = $('#statChrome');
    chrome.textContent = 'Chrome: not checked';
    chrome.className = '';
    this.tick.clear();
  },

  updateStats() {
    $('#statFilled').textContent = `${this.filled} field${this.filled === 1 ? '' : 's'} filled`;
    $('#statUploaded').textContent = `${this.uploaded} file${this.uploaded === 1 ? '' : 's'} uploaded`;
  },

  addRow(text, cls = '') {
    const rows = $('#formRows');
    const ghost = $('.ghost', rows);
    if (ghost) ghost.remove();
    const li = document.createElement('li');
    li.className = cls;
    li.textContent = shorten(text, 90);
    rows.append(li);
    while (rows.children.length > 12) rows.firstElementChild.remove();
  },

  click() {
    const c = $('#cursor');
    c.style.left = `${15 + Math.random() * 65}%`;
    c.style.top = `${15 + Math.random() * 60}%`;
    c.classList.remove('click');
    void c.offsetWidth;
    c.classList.add('click');
  },

  handle(ev, runner) {
    switch (ev.kind) {
      case 'started':
        $('#applyStamp').classList.remove('show');
        clearVerdict(this.agent);
        setAgentState(this.agent, 'working');
        say(this.agent, 'Getting ready');
        if (!ev.resumed) this.tick(runner.demo ? 'Demo started. Nothing is filled for real.' : 'Starting Claude with Chrome…');
        break;
      case 'init': {
        const ok = ev.chrome === 'connected';
        const s = $('#statChrome');
        s.textContent = ok ? 'Chrome: connected' : `Chrome: ${ev.chrome}`;
        s.className = ok ? 'ok' : 'bad';
        if (!ok) this.tick('Chrome isn’t connected. Open Chrome with the Claude extension signed in, then try again.', null, true);
        break;
      }
      case 'tool':
        say(this.agent, shorten(ev.text, 30));
        if (ev.action === 'navigate') $('#browserUrl').textContent = ev.url || ev.text;
        else if (ev.action === 'fill') { this.addRow(ev.text); this.filled++; }
        else if (ev.action === 'upload') { this.addRow(ev.text, 'upload'); this.uploaded++; }
        else if (ev.action === 'type') this.addRow(ev.text, 'typed');
        else if (ev.action === 'click') this.click();
        this.updateStats();
        this.tick(ev.text, 'Fillo');
        break;
      case 'agent_start':
        if (ev.agent === 'resume-picker') { say(this.agent, 'Asking Picky'); this.tick('Choosing the best resume for this job', 'Picky'); }
        break;
      case 'agent_done': {
        const m = (ev.summary || '').match(/PICK\s+`?([^\s`]+)`?/i);
        if (m) this.tick(`Picked ${basename(m[1])}`, 'Picky');
        break;
      }
      case 'text':
        this.tick(ev.text, 'Fillo');
        break;
      case 'exit':
        if (ev.stopped) { setAgentState(this.agent, 'idle'); this.tick('Stopped.'); break; }
        setAgentState(this.agent, ev.isError ? 'error' : 'done');
        if (!ev.isError) { setVerdict(this.agent, 'YOUR TURN'); $('#applyStamp').classList.add('show'); }
        break;
      default:
        break;
    }
  },
};

// ---------- Memory scene ----------

const ICONS = {
  trash: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5.5h13M8 5.5V3.8h4v1.7M5.5 5.5l.8 10.8a1 1 0 0 0 1 .9h5.4a1 1 0 0 0 1-.9l.8-10.8M8.3 8.5v5.5M11.7 8.5v5.5"/></svg>',
  open: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11.5 3.5h5v5M16.5 3.5 9 11M14.5 11.5v4a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h4"/></svg>',
};
const FILE_LABELS = {
  profile: 'Profile', experience: 'Experience', education: 'Education', projects: 'Projects', certifications: 'Certifications',
  skills: 'Skills', achievements: 'Achievements', documents: 'Documents index', answers: 'Answer bank', applications: 'Applications',
};
const FILE_HINTS = {
  profile: 'Contact details, links, preferences and form defaults. Clearing a field keeps it empty for later.',
  experience: 'Jobs and internships. The writer picks what fits each job.',
  documents: 'The index of files and links. Removing an entry with a file also removes the file.',
  answers: 'Answers to form questions that /apply reuses.',
  applications: 'Every form Fillo filled, with its status.',
};
const fileLabel = (n) => FILE_LABELS[n] || n.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());

// Asks "Remove this?" inside the row itself, instead of a browser pop-up.
function confirmInline(li, { question, verb = 'Remove' }, onYes) {
  if ($('.confirm', li)) return;
  const bar = document.createElement('div');
  bar.className = 'confirm';
  bar.innerHTML = `<span>${esc(question)}</span><button type="button" class="btn small ghost">Cancel</button><button type="button" class="btn small danger-solid">${esc(verb)}</button>`;
  const [no, yes] = $$('button', bar);
  const close = () => { bar.remove(); li.classList.remove('confirming'); };
  no.addEventListener('click', close);
  bar.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); $('.trash', li)?.focus(); } });
  yes.addEventListener('click', async () => {
    yes.disabled = true;
    no.disabled = true;
    try { await onYes(); } catch (err) { toast(err.message); close(); }
  });
  li.classList.add('confirming');
  li.append(bar);
  no.focus();
}

function trashButton(label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn trash';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = ICONS.trash;
  return b;
}

const memory = {
  init() {
    $('#slot-memo').append(this.agent = createAgent('memo', { size: 'lg' }));
    this.agent.addEventListener('click', () => {
      const r = ROSTER.memo;
      openDrawer('memo', r.name, r.role, `**How ${r.name} works:** ${r.bio}\n\nYou can also just mention news while talking to Claude Code in this folder; it saves it the same way.`);
    });

    const wireDrop = (zone, input, handler) => {
      input.addEventListener('change', () => { handler([...input.files]); input.value = ''; });
      for (const t of ['dragenter', 'dragover']) zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add('over'); });
      for (const t of ['dragleave', 'drop']) zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove('over'); });
      zone.addEventListener('drop', (e) => handler([...(e.dataTransfer?.files || [])]));
    };
    wireDrop($('#dropzone'), $('#docInput'), (files) => this.upload(files));
    wireDrop($('#resumeDrop'), $('#resumeInput'), (files) => this.uploadResumes(files));
    $('#startSetup').addEventListener('click', () => this.startSetup());
    $('#fileDocs').addEventListener('click', () => this.fileNew());
    $('#linkForm').addEventListener('submit', (e) => { e.preventDefault(); this.addLink(); });
    const auto = $('#autoFile');
    auto.checked = store.get('autoFile', true);
    auto.addEventListener('change', () => store.set('autoFile', auto.checked));

    // Sections: Memory files · Resumes · Documents · Links.
    this.pane = store.get('memPane', 'files');
    for (const b of $$('[data-mem]')) b.addEventListener('click', () => this.showPane(b.dataset.mem));
    this.current = store.get('memFile', 'profile');
    $('#memSearch').addEventListener('input', () => {
      if (this.pane !== 'files') this.showPane('files');
      this.renderItems();
    });
    $('#viewRaw').addEventListener('click', () => {
      const f = this.files.find((x) => x.name === this.current);
      if (f) openDrawer('memo', fileLabel(f.name), `memory/${f.name}.md`, f.content);
    });
    this.showPane(this.pane);

    this.queue = [];
    this.groups = [];
    this.files = [];
    this.items = {};
    this.pendingFiling = false;
  },

  showPane(name) {
    this.pane = ['files', 'resumes', 'documents', 'links'].includes(name) ? name : 'files';
    store.set('memPane', this.pane);
    for (const b of $$('[data-mem]')) b.setAttribute('aria-selected', String(b.dataset.mem === this.pane));
    for (const p of $$('.mem-pane')) p.hidden = p.dataset.pane !== this.pane;
  },

  newFiles() {
    return this.groups.find((g) => g.id === 'new')?.files || [];
  },

  // Runs one memory job at a time. Anything asked for while Memo is busy waits its turn.
  run(label, text, extra = {}) {
    if (memoryRunner.running) {
      this.queue.push({ label, text, extra });
      toast(`Queued: ${label} Memo starts it when the current run ends.`);
      return Promise.resolve(false);
    }
    this.runLabel = label;
    return memoryRunner.start({ text, ...extra });
  },

  // Setup from the app: Claude reads the resumes in memory/resume/ and asks its questions in the Claude box.
  startSetup() {
    if (!appState.resumes.some((r) => r.kind === 'base')) { this.showPane('resumes'); toast('Add your resume under Resumes first.'); return; }
    this.run('Setting up your profile…', '', { kind: 'setup' });
  },

  async sendFile(f, to) {
    const res = await fetch(`/api/upload?name=${encodeURIComponent(f.name)}${to ? `&to=${to}` : ''}`, { method: 'POST', headers: { 'x-shiro-token': TOKEN }, body: f });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404 && data.error === 'Not found') showOutdated();
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return data;
  },

  // Saving resumes is free. After setup, a new resume is registered with its role automatically.
  async uploadResumes(files) {
    const names = [];
    for (const f of files) {
      if (f.size > 20 * 1024 * 1024) { toast(`${f.name} is over 20 MB.`); continue; }
      try { names.push((await this.sendFile(f, 'resume')).name); } catch (err) { toast(`${f.name}: ${err.message}`); }
    }
    await this.load();
    if (!names.length) return;
    if (!appState.memory) { toast(`Added ${names.length} resume${names.length === 1 ? '' : 's'}. Press “Set up my profile” when you’ve added them all.`); return; }
    if (!$('#autoFile').checked) { toast('Resume added. Tell Memo about it in “What’s new?” when you’re ready.'); return; }
    this.run(`Adding ${names.length} resume${names.length === 1 ? '' : 's'}…`,
      `New resume file(s) in memory/resume/: ${names.join(', ')}. Add each under ## Resumes in memory/profile.md as a short role label of a few words, e.g. "- AI Engineer Intern: memory/resume/<file>" (rename it to the role with node tools/file-doc.mjs if its name doesn't say), and save any facts that are newer than memory, following the source-of-truth rule.`);
  },

  // Saving a link is a small job: Memo works out what it is and files it.
  addLink() {
    const url = $('#linkUrl').value.trim();
    const note = $('#linkNote').value.trim();
    try { if (!/^https?:$/.test(new URL(url).protocol)) throw new Error(); } catch { toast('Paste a full link starting with https://'); return; }
    this.run('Saving your link…', `Link: ${url}${note ? ` (${note})` : ''}. Work out what it is and save it following the "Files and links" rules.`);
    $('#linkUrl').value = '';
    $('#linkNote').value = '';
  },

  // Saving files is plain disk work on the server: no Claude, no tokens.
  async upload(files) {
    if (!files.length) return;
    let added = 0;
    for (const f of files) {
      if (f.size > 20 * 1024 * 1024) { toast(`${f.name} is over 20 MB.`); continue; }
      try {
        await this.sendFile(f);
        added++;
      } catch (err) {
        toast(`${f.name}: ${err.message}`);
      }
    }
    await this.load();
    if (!added) return;
    const n = `${added} file${added === 1 ? '' : 's'}`;
    if (!$('#autoFile').checked) { toast(`Added ${n}. Press “Sort them into memory” when you’re ready.`); return; }
    if (memoryRunner.running) {
      this.pendingFiling = true;
      toast(`Added ${n}. Memo will sort ${added === 1 ? 'it' : 'them'} as soon as the current run ends.`);
    } else {
      toast(`Added ${n}. Memo is sorting ${added === 1 ? 'it' : 'them'} into your memory…`);
      this.fileNew();
    }
  },

  // Asks Memo (/remember) to identify each new file, move it into its section and record it.
  fileNew() {
    const fresh = this.newFiles();
    if (!fresh.length) return;
    if (memoryRunner.running) { this.pendingFiling = true; toast('Queued. Memo sorts these when the current run ends.'); return; }
    this.pendingFiling = false;
    const text = `New files in memory/documents/: ${fresh.map((d) => d.name).join(', ')}. Identify each one, then sort and record it following the "Files and links" rules.`;
    this.run(`Sorting ${fresh.length} new file${fresh.length === 1 ? '' : 's'}…`, text);
  },

  // Free removal with Undo: the server keeps a copy for an hour.
  async forget(body, what, li) {
    const r = await api('/api/forget', body);
    li.classList.add('leaving');
    await new Promise((ok) => setTimeout(ok, 180));
    await this.load();
    toast(`Removed ${what}.`, {
      label: 'Undo',
      run: async () => {
        try { await api('/api/undo', { id: r.undo }); toast(`Put back ${what}.`); } catch (err) { toast(err.message); }
        this.load();
      },
    });
  },

  // ----- Memory files: file list on the left, removable items on the right -----

  renderFileNav() {
    const nav = $('#fileNav');
    nav.innerHTML = '';
    if (!this.files.some((f) => f.name === this.current)) this.current = this.files[0]?.name || 'profile';
    for (const f of this.files) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const n = this.items[f.name]?.length ?? f.n;
      b.innerHTML = `<span>${esc(fileLabel(f.name))}</span><span class="count">${n}</span>`;
      if (f.name === this.current) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => {
        this.current = f.name;
        store.set('memFile', f.name);
        $('#memSearch').value = '';
        this.renderFileNav();
        this.renderItems();
      });
      li.append(b);
      nav.append(li);
    }
    const total = Object.values(this.items).reduce((s, list) => s + list.length, 0);
    $('#cntFiles').textContent = total || '';
  },

  itemRow(file, it) {
    const li = document.createElement('li');
    const kv = file === 'profile' || file === 'skills' || file === 'applications';
    li.className = `item${kv ? ' kv' : ''}`;
    const main = document.createElement('div');
    main.className = 'item-main';
    if (kv) {
      main.innerHTML = `<b>${esc(it.title)}</b><span class="item-val">${esc(it.body)}</span>`;
    } else {
      main.innerHTML = `<b class="item-title">${esc(it.title)}</b>${it.body ? `<div class="item-body md">${renderMarkdown(it.body)}</div>` : ''}`;
    }
    const clear = it.action === 'clear';
    const label = clear ? `Clear “${it.title}”` : `Remove “${shorten(it.title, 40)}”`;
    const del = trashButton(label);
    const name = `“${shorten(it.title, 48)}”`;
    del.addEventListener('click', () => confirmInline(li, {
      question: clear ? `Clear ${name}?` : it.action === 'resume' ? `Remove ${name} and its resume file?` : it.file ? `Remove ${name} and its file?` : `Remove ${name} from memory?`,
      verb: clear ? 'Clear' : 'Remove',
    }, () => this.forget({ file, id: it.id }, `“${shorten(it.title, 50)}”`, li)));
    li.append(main, del);
    return li;
  },

  renderItems() {
    const ul = $('#itemList');
    ul.innerHTML = '';
    const q = $('#memSearch').value.trim().toLowerCase();
    if (q) {
      let hits = 0;
      for (const f of this.files) {
        const found = (this.items[f.name] || []).filter((it) => `${it.title} ${it.body} ${it.section}`.toLowerCase().includes(q));
        if (!found.length) continue;
        hits += found.length;
        const h = document.createElement('li');
        h.className = 'item-group';
        h.textContent = fileLabel(f.name);
        ul.append(h, ...found.map((it) => this.itemRow(f.name, it)));
      }
      $('#itemTitle').textContent = `Search: “${shorten(q, 30)}”`;
      $('#itemSub').textContent = `${hits} match${hits === 1 ? '' : 'es'} across your memory`;
      $('#viewRaw').hidden = true;
      if (!hits) ul.innerHTML = '<li class="empty">Nothing in memory matches that.</li>';
    } else {
      const name = this.current;
      const list = this.items[name] || [];
      $('#itemTitle').textContent = fileLabel(name);
      $('#itemSub').textContent = FILE_HINTS[name] || `${list.length} item${list.length === 1 ? '' : 's'} · memory/${name}.md`;
      $('#viewRaw').hidden = !this.files.some((f) => f.name === name);
      let section = null;
      for (const it of list) {
        if (it.section && it.section !== section) {
          section = it.section;
          const h = document.createElement('li');
          h.className = 'item-group';
          h.textContent = section;
          ul.append(h);
        }
        ul.append(this.itemRow(name, it));
      }
      if (!list.length) ul.innerHTML = '<li class="empty">Nothing saved here yet. Add it with <b>Add</b> on the left, or just tell Claude Code.</li>';
    }
    // Long entries start folded; a click on "Show more" opens them.
    requestAnimationFrame(() => {
      for (const body of $$('.item-body', ul)) {
        if (body.scrollHeight <= 130) continue;
        body.classList.add('clamp');
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'more';
        more.textContent = 'Show more';
        more.addEventListener('click', () => {
          const open = body.classList.toggle('clamp');
          more.textContent = open ? 'Show more' : 'Show less';
        });
        body.after(more);
      }
    });
  },

  // ----- Resumes, documents, links -----

  renderResumes() {
    const shelf = $('#resumeShelf');
    shelf.innerHTML = '';
    const base = appState.resumes.filter((r) => r.kind === 'base');
    $('#cntResumes').textContent = base.length || '';
    if (!appState.resumes.length) { shelf.innerHTML = '<li class="empty">No resumes yet. Drop one above.</li>'; return; }
    for (const r of appState.resumes) {
      const li = document.createElement('li');
      const inMemory = r.path.startsWith('memory/resume/');
      const href = inMemory
        ? `/resume-file/${encodeURIComponent(basename(r.path))}?k=${TOKEN}`
        : `/${r.path.split('/').map(encodeURIComponent).join('/')}?k=${TOKEN}`;
      li.innerHTML = `<span class="doc-icon cv${r.kind === 'tailored' ? ' new' : ''}"></span>
        <div class="meta"><b title="${esc(r.role)}">${esc(r.label || r.role)}</b><small title="${esc(r.path)}">${esc(basename(r.path))}${r.kind === 'tailored' ? ' · from a review' : ''}</small></div>
        <a class="icon-btn" href="${href}" target="_blank" rel="noopener" title="Open" aria-label="Open ${esc(r.role)}">${ICONS.open}</a>`;
      if (inMemory) {
        const del = trashButton(`Remove ${r.role}`);
        del.addEventListener('click', () => confirmInline(li, { question: 'Remove this resume?' }, () => this.forget({ resume: r.path }, `the ${r.role} resume`, li)));
        li.append(del);
      }
      shelf.append(li);
    }
  },

  renderDocuments(docs) {
    this.groups = docs.groups || [];
    const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
    const wrap = $('#docGroups');
    wrap.innerHTML = '';
    let count = 0;
    for (const g of this.groups) {
      if (!g.files.length) continue;
      count += g.files.length;
      const sec = document.createElement('section');
      sec.className = `doc-group g-${g.id}`;
      sec.innerHTML = `<h3>${esc(g.label)} <span>${g.files.length}</span></h3><ul class="doc-list"></ul>`;
      const ul = $('ul', sec);
      for (const d of g.files) {
        const li = document.createElement('li');
        li.dataset.name = d.name;
        const ext = (d.name.split('.').pop() || '').slice(0, 4);
        const href = `/docs/${d.href.split('/').map(encodeURIComponent).join('/')}?k=${TOKEN}`;
        const label = d.title || d.name;
        li.innerHTML = `<span class="ext">${esc(ext)}</span>
          <span class="meta"><a href="${href}" target="_blank" rel="noopener" title="${esc(label)}">${esc(label)}</a><small title="${esc(d.name)}">${d.title ? `${esc(d.name)} · ` : ''}${size(d.size)}</small></span>
          ${g.id === 'new' ? '<span class="badge new">new</span>' : ''}`;
        const del = trashButton(`Remove ${label}`);
        del.addEventListener('click', () => confirmInline(li, { question: 'Remove this file?' }, () => this.forget({ doc: d.path }, `“${shorten(label, 50)}”`, li)));
        li.append(del);
        ul.append(li);
      }
      wrap.append(sec);
    }
    $('#cntDocs').textContent = count || '';
    if (!count) wrap.innerHTML = '<p class="empty-note">No documents yet. Certificates, transcripts and letters you add here can be uploaded to forms.</p>';

    const links = docs.links || [];
    $('#cntLinks').textContent = links.length || '';
    const ll = $('#linkList');
    ll.innerHTML = '';
    if (!links.length) ll.innerHTML = '<li class="empty">No links yet. Paste one above.</li>';
    for (const l of links) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="ltype">${esc(l.type || 'link')}</span>
        <span class="meta"><b title="${esc(l.title)}">${esc(l.title)}</b><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.url.replace(/^https?:\/\/(www\.)?/, ''))}</a></span>`;
      const del = trashButton(`Remove ${l.title}`);
      del.addEventListener('click', () => confirmInline(li, { question: 'Remove this link?' }, () => this.forget({ link: l.url }, `“${shorten(l.title, 50)}”`, li)));
      li.append(del);
      ll.append(li);
    }
    this.updateActions();
  },

  updateActions() {
    const fresh = this.newFiles();
    $('#docActions').hidden = !fresh.length || memoryRunner.running;
    $('#docNewCount').textContent = `${fresh.length} new file${fresh.length === 1 ? '' : 's'} not sorted yet`;
  },

  showFiling(on) {
    clearInterval(this.timer);
    $('#filingStatus').hidden = !on;
    if (!on) { this.updateActions(); return; }
    $('#docActions').hidden = true;
    $('#filingTitle').textContent = this.runLabel || 'Updating your memory…';
    $('#filingStep').textContent = this.queue.length ? `Then ${this.queue.length} more queued` : 'Starting…';
    const t0 = Date.now();
    const tick = () => {
      const s = Math.round((Date.now() - t0) / 1000);
      $('#filingTime').textContent = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
    };
    tick();
    this.timer = setInterval(tick, 1000);
  },

  filingStep(text) {
    if (!text) return;
    $('#filingStep').textContent = shorten(text, 90);
    const m = text.match(/^Reading (.+)$/);
    if (!m) return;
    const li = $(`.g-new li[data-name="${CSS.escape(m[1])}"]`);
    const badge = li && $('.badge', li);
    if (badge) { badge.className = 'badge reading'; badge.textContent = 'reading'; }
  },

  afterRun(ev) {
    this.runLabel = '';
    if (ev.stopped) { this.queue = []; this.pendingFiling = false; return; }
    const next = this.queue.shift();
    if (next) { this.run(next.label, next.text, next.extra); return; }
    if (this.pendingFiling && $('#autoFile').checked && this.newFiles().length) this.fileNew();
  },

  reset() {
    setAgentState(this.agent, 'idle');
    clearVerdict(this.agent);
  },

  async load() {
    let data;
    try { [data] = await Promise.all([api('/api/memory'), refreshState()]); } catch (err) { toast(err.message); return; }
    $('#setupCallout').hidden = appState.memory;
    // First run: open where the setup banner points, so the resume drop box is right there.
    if (!appState.memory && !appState.resumes.length && !this.firstRunShown) {
      this.firstRunShown = true;
      this.showPane('resumes');
    }
    this.files = data.files || [];
    const lists = await Promise.all(this.files.map((f) => api(`/api/memory-items?file=${encodeURIComponent(f.name)}`)
      .then((r) => [f.name, r.items]).catch(() => [f.name, []])));
    this.items = Object.fromEntries(lists);
    this.renderFileNav();
    this.renderItems();
    this.renderResumes();
    this.renderDocuments(data.documents || {});
  },

  handle(ev, runner) {
    switch (ev.kind) {
      case 'started':
        clearVerdict(this.agent);
        setAgentState(this.agent, 'working');
        say(this.agent, 'Opening your memory');
        if (!runner.demo) this.showFiling(true);
        break;
      case 'tool':
        say(this.agent, shorten(ev.text, 30));
        if (!runner.demo) this.filingStep(ev.text);
        break;
      case 'text':
        if (!runner.demo) this.filingStep(ev.text);
        break;
      case 'exit':
        setAgentState(this.agent, ev.isError && !ev.stopped ? 'error' : 'done');
        if (!ev.stopped && !ev.isError) setVerdict(this.agent, 'SAVED');
        this.showFiling(false);
        if (runner.demo) break;
        this.load().then(() => this.afterRun(ev));
        break;
      default: break;
    }
  },
};

// ---------- resume pickers and past runs ----------

function fillResumeSelects() {
  const base = appState.resumes.filter((r) => r.kind === 'base');
  const tailored = appState.resumes.filter((r) => r.kind === 'tailored');
  const opt = (r) => `<option value="${esc(r.path)}" title="${esc(r.role)}">${esc(r.label || r.role)} · ${esc(basename(r.path))}</option>`;
  const groups = (base.length ? `<optgroup label="Base resumes">${base.map(opt).join('')}</optgroup>` : '')
    + (tailored.length ? `<optgroup label="Tailored by a review">${tailored.map(opt).join('')}</optgroup>` : '');
  const reviewAuto = base.length > 1 ? `Best match (Picky chooses from ${base.length})` : base.length === 1 ? 'My base resume' : 'Auto (Claude asks if none is found)';
  for (const [sel, auto] of [['#reviewResume', reviewAuto], ['#applyResume', 'Auto (best for this job)']]) {
    const s = $(sel);
    const keep = s.value;
    s.innerHTML = `<option value="auto">${esc(auto)}</option>${groups}`;
    if ([...s.options].some((o) => o.value === keep)) s.value = keep;
  }
}

function renderPastRuns() {
  const ul = $('#pastRuns');
  ul.innerHTML = '';
  const runs = appState.runs.filter((r) => r.hasFeedback);
  if (!runs.length) { ul.innerHTML = '<li><small>No finished reviews yet.</small></li>'; return; }
  for (const r of runs.slice(0, 30)) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const m = r.dir.match(/^(\d{4})-(\d{2})-(\d{2})-(.*)$/);
    const when = m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';
    const title = (m ? m[4] : r.dir).replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
    const tags = [r.hasDebrief && 'debrief', r.hasResume && 'new resume', r.hasPdf && 'PDF'].filter(Boolean).join(' · ') || 'panel only';
    b.innerHTML = `<span class="run-title">${esc(title)}</span><small>${when ? `${esc(when)} · ` : ''}${esc(tags)}</small>`;
    b.title = r.dir;
    b.addEventListener('click', () => review.loadRun(r.dir));
    li.append(b);
    ul.append(li);
  }
}

// ---------- wire up ----------

const reviewRunner = new Runner('review', review, {
  start: '#startReview', stop: '#stopReview', demo: '#demoReview', convo: '#reviewConvo',
  demoArg: () => team,
}, demoReview);
const applyRunner = new Runner('apply', apply, { start: '#startApply', stop: '#stopApply', demo: '#demoApply', convo: '#applyConvo' }, demoApply);
const memoryRunner = new Runner('remember', memory, {
  start: '#startRemember', stop: '#stopRemember', demo: '#demoRemember', convo: '#memoryConvo',
  demoArg: () => $('#rememberText').value.trim(),
}, demoRemember);

let jdMode = 'paste';
$$('[data-jd]').forEach((b) => b.addEventListener('click', () => {
  jdMode = b.dataset.jd;
  $$('[data-jd]').forEach((x) => x.classList.toggle('on', x === b));
  $('#jdText').hidden = jdMode !== 'paste';
  $('#jdUrl').hidden = jdMode !== 'link';
  (jdMode === 'paste' ? $('#jdText') : $('#jdUrl')).focus();
}));

$('#startReview').addEventListener('click', async () => {
  const payload = { resume: $('#reviewResume').value };
  let label;
  if (jdMode === 'link') {
    const u = $('#jdUrl').value.trim();
    if (!u) return toast('Add the job link first.');
    payload.jdUrl = u;
    try { label = new URL(u).host; } catch { label = u; }
  } else {
    const t = $('#jdText').value.trim();
    if (t.length < 40) return toast('Paste the full job description first.');
    payload.jdText = t;
    label = shorten(t.split('\n').find((l) => l.trim()) || 'Pasted JD', 40);
  }
  payload.agents = team;
  if (!PANEL.some((k) => team[k].on)) return toast('Switch on at least one reviewer in the Team list.');
  if (await reviewRunner.start(payload)) {
    $('#inboxJd').textContent = label;
    const sel = $('#reviewResume');
    $('#inboxResume').textContent = sel.value === 'auto' ? sel.selectedOptions[0].textContent : basename(sel.value);
  }
});

$('#startApply').addEventListener('click', async () => {
  const url = $('#applyUrl').value.trim();
  if (!url) return toast('Add the application link first.');
  if (await applyRunner.start({ url, resume: $('#applyResume').value })) $('#browserUrl').textContent = url;
});

let memMode = 'add';
$$('[data-memmode]').forEach((b) => b.addEventListener('click', () => {
  memMode = b.dataset.memmode;
  const forget = memMode === 'forget';
  $$('[data-memmode]').forEach((x) => x.classList.toggle('on', x === b));
  $('#rememberLabel').textContent = forget ? 'What should Memo forget?' : 'What’s new?';
  $('#rememberText').placeholder = forget ? 'e.g. Remove the Domain Trail project, and C from my skills' : 'e.g. Finished the AWS Cloud Practitioner certificate in Nov 2026';
  $('#startRemember').textContent = forget ? 'Forget this' : 'Remember this';
  $('#startRemember').classList.toggle('danger-solid', forget);
  $('#startRemember').classList.toggle('primary', !forget);
  $('#forgetNote').hidden = !forget;
  $('#rememberText').focus();
}));

$('#startRemember').addEventListener('click', () => {
  const text = $('#rememberText').value.trim();
  if (memMode === 'forget') {
    if (!text) return toast('Write what Memo should forget first.');
    memory.run('Forgetting…', text, { mode: 'forget' });
  } else {
    if (!text) return toast('Write what’s new first.');
    memory.run('Saving what’s new…', text);
  }
  $('#rememberText').value = '';
});

// ---------- start ----------

$('#brandCritter').innerHTML = critterSVG(null);
renderSettings();
renderUsage(usageState);
loadUsage(false);
$('#usage').addEventListener('click', () => loadUsage(true));
setInterval(() => { if (document.visibilityState === 'visible') loadUsage(false); }, 120000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadUsage(false); });
review.init();
renderTeam();
$('#teamPanel').open = store.get('teamOpen', false);
$('#teamPanel').addEventListener('toggle', () => store.set('teamOpen', $('#teamPanel').open));
apply.init();
memory.init();
// ?demo=review | apply | memory opens that tab and plays its free demo.
const demoParam = new URLSearchParams(location.search).get('demo');
const demoRunners = { review: reviewRunner, apply: applyRunner, memory: memoryRunner };
if (demoRunners[demoParam]) {
  showTab(demoParam);
  demoRunners[demoParam].playDemo(demoParam === 'memory' ? 'Finished the AWS Cloud Practitioner certificate, Nov 2026' : undefined);
} else {
  showTab(['review', 'apply', 'memory'].includes(store.get('tab')) ? store.get('tab') : 'review');
}

refreshState().then((s) => {
  // Reconnect to runs that were still going when the page was reloaded.
  for (const j of s.jobs || []) {
    if (!j.running) continue;
    const runner = { review: reviewRunner, apply: applyRunner, remember: memoryRunner }[j.kind];
    if (runner && !runner.running) { runner.prepare(false); runner.attach(j.id); }
  }
});
