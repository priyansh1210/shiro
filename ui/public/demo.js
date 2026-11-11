// Demo runs: fake events that drive the same animations as a real run.
// They never contact Claude, so they cost no tokens.

import { PANEL } from './creatures.js';

const VERDICTS = {
  ats: ['REJECT', 3, 'Keyword match 41%: “Kubernetes” and “Terraform” are missing'],
  recruiter: ['MAYBE', 5, 'The top third doesn’t say “backend engineer” anywhere'],
  'hiring-manager': ['MAYBE', 6, 'Good API work, but no proof of on-call or production ownership'],
  teammate: ['ADVANCE', 7, 'Real code reviews and tests, same stack as the team'],
  'rival-applicant': ['REJECT', 4, 'My bullets show results; most of yours list tasks'],
  ceo: ['MAYBE', 5, 'One real result (checkout latency −38%), the rest is activity'],
  'technical-interviewer': ['MAYBE', 5, '“Expert in distributed systems” would not survive question 2'],
  skeptic: ['REJECT', 3, 'An intern who “spearheaded the architecture” reads as inflated'],
  'design-lead': ['MAYBE', 6, 'Good product thinking, but limited evidence of accessibility outcomes'],
  'skip-level-manager': ['ADVANCE', 7, 'Reads as a solid new grad, which is the level we’re hiring'],
  'hr-screener': ['MAYBE', 6, 'Six-month gap in 2025 isn’t explained; two date formats'],
};

const ACTIVITY = ['Reading jd.md', 'Reading resume-original.md', 'Checking the must-haves', 'Writing my report'];

function scheduler(emit) {
  const timers = [];
  const at = (ms, ev) => timers.push(setTimeout(() => emit({ ...ev, t: Date.now(), demo: true }), ms));
  return { at, cancel: () => timers.forEach(clearTimeout) };
}

const jitter = (n) => Math.round(Math.random() * n);

export function demoReview(emit, team) {
  const { at, cancel } = scheduler(emit);
  const isOn = (a) => !team || team[a]?.on !== false;
  at(0, { kind: 'started', effort: 'demo' });
  at(400, { kind: 'init', model: 'demo' });
  at(900, { kind: 'tool', action: 'other', text: 'Writing jd.md' });
  if (isOn('resume-picker')) {
    at(1300, { kind: 'agent_start', id: 'picker', agent: 'resume-picker', text: 'Picking the best resume' });
    at(2100, { kind: 'agent_activity', id: 'picker', text: 'Comparing 3 resumes' });
    at(3400, { kind: 'agent_done', id: 'picker', agent: 'resume-picker', status: 'completed', tokens: 8400, summary: 'PICK memory/resume/backend-engineer.pdf — closest to a backend role, covers 7 of 9 must-haves' });
  }

  let latest = 0;
  PANEL.filter(isOn).forEach((a, n) => {
    const start = 4200 + n * 260;
    at(start, { kind: 'agent_start', id: a, agent: a, text: 'Reviewing the resume' });
    ACTIVITY.forEach((text, k) => at(start + 900 + k * (1400 + jitter(700)), { kind: 'agent_activity', id: a, text }));
    const done = start + 7600 + jitter(4200);
    latest = Math.max(latest, done);
    const [v, s, why] = VERDICTS[a];
    at(done, { kind: 'agent_done', id: a, agent: a, status: 'completed', tokens: 14000 + jitter(9000), summary: `${v} ${s}/10 — ${why}` });
  });

  const d = latest + 900;
  if (isOn('debrief')) {
    at(d, { kind: 'agent_start', id: 'debrief', agent: 'debrief', text: 'Chairing the debrief' });
    at(d + 1200, { kind: 'agent_activity', id: 'debrief', text: 'Thinking… 1.2k' });
    at(d + 2800, { kind: 'agent_activity', id: 'debrief', text: 'Writing the report' });
    at(d + 4200, { kind: 'agent_done', id: 'debrief', agent: 'debrief', status: 'completed', tokens: 21000, summary: 'Average 5.2/10 · ADVANCE 2 · MAYBE 6 · REJECT 3' });
  }

  const w = d + 4900;
  if (isOn('resume-writer')) {
    at(w, { kind: 'agent_start', id: 'writer', agent: 'resume-writer', text: 'Rewriting the resume' });
    at(w + 1300, { kind: 'agent_activity', id: 'writer', text: 'Thinking… 2.4k' });
    at(w + 2600, { kind: 'agent_activity', id: 'writer', text: 'Writing the report' });
    at(w + 5200, { kind: 'agent_done', id: 'writer', agent: 'resume-writer', status: 'completed', tokens: 26000, summary: 'Wrote the new resume (~588 words) and 3 questions' });
  }

  const result = [
    '**Demo run: nothing was sent to Claude.**',
    '',
    'Started from **backend-engineer.pdf** (Picky’s choice).',
    '',
    '| | |',
    '|---|---|',
    '| Average | 5.1 / 10 |',
    '| Verdicts | 2 advance · 6 maybe · 3 reject |',
    '',
    'Top fixes made:',
    '- Headline now says *Backend Engineer*',
    '- Added the Kubernetes deployment work from your internship',
    '- “Spearheaded the architecture” → “Designed the order-service API”',
    '',
    'In a real run, the new resume, the change list and the writer’s questions show up here.',
  ].join('\n');
  at(w + 5800, { kind: 'result', text: result });
  at(w + 6000, { kind: 'exit', code: 0, result });
  return cancel;
}

export function demoApply(emit) {
  const { at, cancel } = scheduler(emit);
  const fills = [
    'Sets First name to Alex', 'Sets Last name to Rivera', 'Sets Email to alex@example.com',
    'Sets Phone to +1 555 010 2030', 'Sets Location to Austin, TX', 'Sets LinkedIn to linkedin.com/in/alex',
    'Sets Work authorization to Yes', 'Sets Sponsorship needed to No', 'Sets Earliest start date to Jan 2027',
    'Sets How did you hear about us to Company website',
  ];
  at(0, { kind: 'started', effort: 'demo' });
  at(400, { kind: 'init', model: 'demo', chrome: 'connected' });
  at(900, { kind: 'tool', action: 'tabs', text: 'Opening a new tab' });
  at(1600, { kind: 'tool', action: 'navigate', text: 'Opening jobs.example.com', url: 'https://jobs.example.com/acme/backend-engineer' });
  at(2600, { kind: 'tool', action: 'look', text: 'Reading the page' });
  at(3600, { kind: 'tool', action: 'click', text: 'Clicking' });
  at(4300, { kind: 'tool', action: 'look', text: 'Reading the page' });
  at(5300, { kind: 'tool', action: 'upload', text: 'Uploading backend-engineer.pdf' });
  fills.forEach((text, n) => at(6400 + n * 850, { kind: 'tool', action: 'fill', text }));
  const t = 6400 + fills.length * 850;
  at(t + 300, { kind: 'tool', action: 'type', text: 'Typing “I’ve spent the last year building order APIs…”' });
  at(t + 1500, { kind: 'tool', action: 'look', text: 'Looking at the page' });
  const result = [
    '**Demo run: nothing was filled in for real.**',
    '',
    'Uploaded **backend-engineer.pdf** and filled 10 fields.',
    '',
    '**Drafted answer** (please edit): *Why Acme?* “I’ve spent the last year building order APIs…”',
    '',
    '**Left blank:** expected salary (not in your memory yet).',
    '',
    '**For you to do:** tick the privacy-policy box, check everything, then press Submit yourself.',
  ].join('\n');
  at(t + 2400, { kind: 'result', text: result });
  at(t + 2600, { kind: 'exit', code: 0, result });
  return cancel;
}

export function demoRemember(emit, text) {
  const { at, cancel } = scheduler(emit);
  at(0, { kind: 'started', effort: 'demo' });
  at(500, { kind: 'tool', action: 'other', text: 'Reading certifications.md' });
  at(1500, { kind: 'tool', action: 'other', text: 'Reading skills.md' });
  at(2500, { kind: 'tool', action: 'other', text: 'Editing certifications.md' });
  const result = `**Demo: nothing was saved.**\n\nIn a real run, Memo would file “${(text || 'your news').slice(0, 80)}” into the right memory file and tell you where it went.`;
  at(3400, { kind: 'result', text: result });
  at(3600, { kind: 'exit', code: 0, result });
  return cancel;
}
