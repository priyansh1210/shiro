// The Shiro crew: one small orange critter, with an accessory and a prop for each agent.
// Pure SVG + CSS. Nothing here talks to Claude, so animating them costs no tokens.

export const ROSTER = {
  'resume-picker': {
    name: 'Picky', role: 'Resume Picker', acc: 'propeller', prop: 'cards',
    bio: 'Compares all your base resumes with the job and picks the best one to start from.',
  },
  ats: {
    name: 'Parsy', role: 'ATS', acc: 'antenna', prop: 'magnifier',
    bio: 'Software, not a person. Rejects files it can’t parse, missing knockout requirements and a low keyword match.',
  },
  recruiter: {
    name: 'Skimmy', role: 'Recruiter', acc: 'headset', prop: 'magnifier',
    bio: 'Gives your resume 7 seconds and a must-have checklist. Rejects you if they can’t pitch you in two lines.',
  },
  'hiring-manager': {
    name: 'Manny', role: 'Hiring Manager', acc: 'tie', prop: 'magnifier',
    bio: 'Your future boss. Rejects you if there’s no proof you’ve done the work this team needs.',
  },
  teammate: {
    name: 'Buddy', role: 'Teammate', acc: 'cap', prop: 'magnifier',
    bio: 'Your future peer. Rejects people who talk more than they build, or who would need carrying.',
  },
  'rival-applicant': {
    name: 'Rivo', role: 'Rival Applicant', acc: 'sweatband', prop: 'magnifier',
    bio: 'A realistic top-10% competitor for the same job, showing every place they’d beat you.',
  },
  ceo: {
    name: 'Chief', role: 'CEO', acc: 'tophat', prop: 'magnifier',
    bio: 'Gives you 30 seconds. Rejects anything without impact, ownership or drive.',
  },
  'technical-interviewer': {
    name: 'Grill', role: 'Tech Interviewer', acc: 'glasses', prop: 'magnifier',
    bio: 'Plans the deep-dive questions. Rejects claims you couldn’t defend in an interview.',
  },
  skeptic: {
    name: 'Squint', role: 'Skeptic', acc: 'detective', prop: 'magnifier',
    bio: 'The BS detector. Flags inflated verbs, suspicious numbers and dates that don’t add up.',
  },
  'design-lead': {
    name: 'Dottie', role: 'Design Lead', acc: 'designer-pencil', prop: 'magnifier',
    bio: 'Reviews design craft, user experience, accessibility, design decisions and product impact.',
  },
  'skip-level-manager': {
    name: 'Skip', role: 'Skip-level Manager', acc: 'bowtie', prop: 'magnifier',
    bio: 'Your boss’s boss. Rejects resumes that read at the wrong level for the role.',
  },
  'hr-screener': {
    name: 'Rulo', role: 'HR Screener', acc: 'badge', prop: 'magnifier',
    bio: 'Checks eligibility, gaps, missing basics and things that shouldn’t be on a resume.',
  },
  debrief: {
    name: 'Gavvy', role: 'Debrief Chair', acc: 'wig', prop: 'gavel',
    bio: 'Chairs the hiring committee: merges the eleven reports, settles conflicts and ranks the fixes.',
  },
  'resume-writer': {
    name: 'Quill', role: 'Resume Writer', acc: 'beret', prop: 'pen',
    bio: 'Rewrites the resume for this job using only true facts from your resume and memory.',
  },
  filler: {
    name: 'Fillo', role: 'Form Filler', acc: 'hardhat', prop: 'clipboard',
    bio: 'Fills the application in Chrome from your memory. Never presses Submit.',
  },
  memo: {
    name: 'Memo', role: 'Memory Keeper', acc: 'scarf', prop: 'notebook',
    bio: 'Files every new internship, course, certificate and skill into your career memory.',
  },
};

export const PANEL = [
  'ats', 'recruiter', 'hiring-manager', 'teammate', 'rival-applicant',
  'ceo', 'technical-interviewer', 'skeptic', 'design-lead', 'skip-level-manager', 'hr-screener',
];

const INK = '#221C18';

const ACCESSORIES = {
  antenna: `
    <line x1="60" y1="38" x2="60" y2="21" stroke="#3a3330" stroke-width="3" stroke-linecap="round"/>
    <circle class="antenna-light" cx="60" cy="17" r="5" fill="#5BC0EB"/>
    <g stroke="#8a4a33" stroke-linecap="butt">
      <path d="M51 79v8M54 79v8M58 79v8M61 79v8M65 79v8M69 79v8" stroke-width="1.6"/>
      <path d="M52.5 79v8M63 79v8" stroke-width="2.6"/>
    </g>`,
  headset: `
    <path d="M28 56 Q60 8 92 56" fill="none" stroke="#2f2a27" stroke-width="5" stroke-linecap="round"/>
    <rect x="21" y="49" width="11" height="17" rx="4" fill="#2f2a27"/>
    <rect x="88" y="49" width="11" height="17" rx="4" fill="#2f2a27"/>
    <path d="M28 65 Q30 80 44 80" fill="none" stroke="#2f2a27" stroke-width="3" stroke-linecap="round"/>
    <circle cx="45.5" cy="80" r="3.6" fill="#2f2a27"/>`,
  tie: `
    <path d="M50 72 L60 77 L70 72 L68 70 L60 74 L52 70 Z" fill="#fff"/>
    <path d="M57 76 h6 l-1 4 l4 9 l-6 5 l-6 -5 l4 -9 z" fill="#3B6EA8"/>`,
  cap: `
    <path d="M31 44 Q60 14 89 44 Z" fill="#4C8C6B"/>
    <path d="M32 40 L13 37 Q11 44 31 46 Z" fill="#3d7357"/>
    <circle cx="60" cy="29.5" r="2.6" fill="#3d7357"/>`,
  sweatband: `
    <rect x="32" y="40" width="56" height="7" rx="1" fill="#D64545"/>
    <rect x="32" y="42.6" width="56" height="1.8" fill="#fff" opacity=".65"/>
    <path d="M41 49 L53 53 M79 49 L67 53" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
  tophat: `
    <rect x="42" y="11" width="36" height="26" rx="2" fill="#2A2522"/>
    <rect x="42" y="28" width="36" height="5" fill="#B5473A"/>
    <rect x="31" y="34" width="58" height="6" rx="3" fill="#2A2522"/>
    <path d="M60 75 Q53 70 46 74 Q50 80 60 77 Q70 80 74 74 Q67 70 60 75 Z" fill="#3a2a22"/>`,
  glasses: `
    <g fill="rgba(255,255,255,.18)" stroke="${INK}" stroke-width="2.6">
      <circle cx="48" cy="62" r="9.5"/><circle cx="72" cy="62" r="9.5"/>
    </g>
    <path d="M57.5 61 Q60 59 62.5 61" fill="none" stroke="${INK}" stroke-width="2.4"/>`,
  detective: `
    <path d="M30 40 Q34 17 60 17 Q86 17 90 40 Z" fill="#8A6A45"/>
    <path d="M32 35 h56" stroke="#4a3826" stroke-width="3.5"/>
    <rect x="21" y="37" width="78" height="6" rx="3" fill="#6E5236"/>
    <path d="M42 51.5 L54 51.5" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M66 49 Q72 43 79 48" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`,
  bowtie: `
    <path d="M60 80 L48 74 L48 86 Z M60 80 L72 74 L72 86 Z" fill="#7D5BA6"/>
    <circle cx="60" cy="80" r="3.2" fill="#5E4383"/>
    <g>
      <rect x="3" y="60" width="12" height="14" rx="2" fill="#F2EDE4" stroke="#2f2a27" stroke-width="1.5"/>
      <path d="M15 63 Q20 67 15 71" fill="none" stroke="#2f2a27" stroke-width="1.5"/>
      <path class="steam" d="M7 56 q2 -3 0 -6 M11 56 q2 -3 0 -6" stroke="#b3a89d" stroke-width="1.3" fill="none"/>
    </g>`,
  'designer-pencil': `
    <g transform="rotate(35 84 38)">
      <rect x="82" y="20" width="5" height="25" rx="1.5" fill="#D96C4A" stroke="#8A4A33" stroke-width="1"/>
      <rect x="82" y="20" width="5" height="4" fill="#E8B43A"/>
      <path d="M82 45 L87 45 L84.5 51 Z" fill="#E7C9A3" stroke="#8A4A33" stroke-width="0.8"/>
    </g>`,
  badge: `
    <circle cx="60" cy="33" r="9" fill="#5A3B2E"/>
    <path d="M50 40 Q60 34 70 40" fill="#5A3B2E"/>
    <rect x="75" y="70" width="5" height="5" rx="1" fill="#3E7CB1"/>
    <rect x="70" y="74" width="15" height="13" rx="2" fill="#fff" stroke="#3E7CB1" stroke-width="1.5"/>
    <rect x="72.5" y="77" width="10" height="2.6" fill="#3E7CB1"/>
    <rect x="72.5" y="81" width="7" height="2" fill="#9db7cf"/>`,
  wig: `
    <g fill="#F4F1EA" stroke="#d6cfc2" stroke-width="1.5">
      <circle cx="36" cy="40" r="8.5"/><circle cx="84" cy="40" r="8.5"/>
      <circle cx="47" cy="34" r="8.5"/><circle cx="73" cy="34" r="8.5"/>
      <circle cx="60" cy="31" r="8.5"/>
      <circle cx="25" cy="50" r="6.5"/><circle cx="95" cy="50" r="6.5"/>
    </g>`,
  beret: `
    <ellipse cx="53" cy="38" rx="27" ry="8.5" fill="#9E2F3E"/>
    <ellipse cx="50" cy="35" rx="19" ry="6" fill="#B23A4B"/>
    <rect x="51" y="25" width="3" height="7" rx="1.5" fill="#9E2F3E"/>`,
  propeller: `
    <path d="M33 44 Q60 18 87 44 Z" fill="#3E7CB1"/>
    <path d="M40 38 Q60 26 80 38" stroke="#E8B43A" stroke-width="3" fill="none"/>
    <rect x="59" y="21" width="2.6" height="10" fill="#333"/>
    <g class="propeller">
      <ellipse cx="52" cy="20.5" rx="8.5" ry="2.6" fill="#D64545"/>
      <ellipse cx="69" cy="20.5" rx="8.5" ry="2.6" fill="#E8B43A"/>
    </g>`,
  hardhat: `
    <path d="M30 43 Q30 18 60 18 Q90 18 90 43 Z" fill="#F2B632"/>
    <rect x="57" y="18" width="6" height="24" fill="#E0A526"/>
    <rect x="22" y="40" width="76" height="6" rx="3" fill="#D99B1C"/>`,
  scarf: `
    <path d="M27 74 h66 v8 h-66 z" fill="#4C8C6B"/>
    <path d="M27 76.5 h66" stroke="#6fae8c" stroke-width="1.5"/>
    <path d="M70 80 h9 l-1 15 h-8 z" fill="#4C8C6B"/>`,
};

const WORKSHEET = `
  <g class="worksheet">
    <rect x="82" y="80" width="28" height="24" rx="2" fill="#fff" stroke="#cfc6b8"/>
    <path d="M86 87h20M86 92h20M86 97h13" stroke="#cfc6b8" stroke-width="2"/>
  </g>`;

const PROPS = {
  magnifier: `${WORKSHEET}
    <g class="prop prop-magnifier">
      <line x1="102" y1="76" x2="108" y2="68" stroke="#6b5444" stroke-width="4" stroke-linecap="round"/>
      <circle cx="96" cy="82" r="8" fill="rgba(190,225,255,.6)" stroke="#6b5444" stroke-width="3"/>
    </g>`,
  pen: `${WORKSHEET}
    <g class="prop prop-pen">
      <g transform="rotate(30 104 64)">
        <rect x="101" y="40" width="7" height="26" rx="2" fill="#2D5DA8"/>
        <rect x="101" y="40" width="7" height="5" rx="1" fill="#E8B43A"/>
        <path d="M101 66 L108 66 L104.5 74 Z" fill="#F2E3C6"/>
        <path d="M103.3 71 L105.7 71 L104.5 74 Z" fill="${INK}"/>
      </g>
    </g>`,
  gavel: `
    <rect x="90" y="98" width="24" height="5" rx="2" fill="#5c3b22"/>
    <g class="prop prop-gavel">
      <rect x="101" y="46" width="4" height="26" rx="1.5" fill="#7a5233"/>
      <rect x="93" y="40" width="20" height="10" rx="2.5" fill="#5c3b22"/>
    </g>`,
  cards: `
    <g class="prop prop-cards">
      <rect x="96" y="50" width="15" height="20" rx="2" fill="#fff" stroke="#cfc6b8" transform="rotate(-16 103 70)"/>
      <rect x="96" y="50" width="15" height="20" rx="2" fill="#FFF6E5" stroke="#cfc6b8"/>
      <rect x="96" y="50" width="15" height="20" rx="2" fill="#fff" stroke="#cfc6b8" transform="rotate(16 103 70)"/>
      <path d="M99 56h9M99 60h9M99 64h6" stroke="#cfc6b8" stroke-width="1.5" transform="rotate(16 103 70)"/>
    </g>`,
  clipboard: `
    <g class="prop prop-clip">
      <rect x="95" y="52" width="19" height="25" rx="2" fill="#B88A55"/>
      <rect x="98" y="57" width="13" height="17" fill="#fff"/>
      <path class="clip-lines" d="M100 61h9M100 65h9M100 69h6" stroke="#9fb6cc" stroke-width="1.6"/>
      <rect x="100.5" y="50" width="8" height="4" rx="1" fill="#6f6f6f"/>
    </g>`,
  notebook: `
    <g class="prop prop-note">
      <rect x="94" y="54" width="20" height="24" rx="2" fill="#3E7CB1"/>
      <rect x="97" y="57" width="15" height="18" fill="#fff"/>
      <path class="clip-lines" d="M99 61h10M99 65h10M99 69h7" stroke="#cfc6b8" stroke-width="1.5"/>
    </g>`,
};

/** SVG markup for one critter. Pass null for a plain one. */
export function critterSVG(key) {
  const r = key ? ROSTER[key] : null;
  const acc = r ? ACCESSORIES[r.acc] || '' : '';
  const prop = r ? PROPS[r.prop] || '' : '';
  return `
  <svg class="critter" viewBox="0 4 124 108" aria-hidden="true" focusable="false">
    <ellipse class="shadow" cx="60" cy="105" rx="30" ry="4.5"/>
    <g class="bob">
      <rect class="leg" x="38" y="86" width="11" height="15" rx="3.5"/>
      <rect class="leg" x="71" y="86" width="11" height="15" rx="3.5"/>
      <rect class="arm" x="14" y="61" width="17" height="11" rx="4.5"/>
      <rect class="arm" x="89" y="61" width="17" height="11" rx="4.5"/>
      <rect class="body" x="26" y="38" width="68" height="54" rx="14"/>
      <ellipse class="cheek" cx="39" cy="74" rx="5" ry="3"/>
      <ellipse class="cheek" cx="81" cy="74" rx="5" ry="3"/>
      <g class="eyes">
        <rect x="44" y="55" width="8" height="14" rx="4"/>
        <rect x="68" y="55" width="8" height="14" rx="4"/>
      </g>
      ${acc}
      ${prop}
    </g>
  </svg>`;
}

/** A clickable agent: speech bubble, critter, verdict stamp, name tag, token count. */
export function createAgent(key, { size = 'md' } = {}) {
  const r = ROSTER[key];
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `agent size-${size}`;
  el.dataset.agent = key;
  el.dataset.state = 'idle';
  el.setAttribute('aria-label', `${r.name}, ${r.role}. Idle.`);
  el.style.setProperty('--delay', `${(-Math.random() * 5).toFixed(2)}s`);
  el.innerHTML = `
    <span class="bubble"></span>
    <span class="critter-wrap">${critterSVG(key)}</span>
    <span class="verdict"><span class="stamp"></span><span class="score"></span></span>
    <span class="tag"><b>${r.name}</b><small>${r.role}</small></span>
    <span class="tokens"></span>`;
  return el;
}

const STATE_WORDS = { idle: 'Idle', working: 'Working', done: 'Done', error: 'Had a problem' };

export function setAgentState(el, state) {
  if (!el) return;
  el.dataset.state = state;
  const r = ROSTER[el.dataset.agent];
  el.setAttribute('aria-label', `${r.name}, ${r.role}. ${STATE_WORDS[state] || state}.`);
  if (state !== 'working') say(el, '');
}

export function say(el, text) {
  if (!el) return;
  const b = el.querySelector('.bubble');
  b.textContent = text || '';
  b.classList.toggle('show', Boolean(text));
}

export function setVerdict(el, verdict, score) {
  if (!el) return;
  const v = el.querySelector('.verdict');
  v.className = `verdict show v-${(verdict || 'note').toLowerCase()}`;
  v.querySelector('.stamp').textContent = verdict || '';
  v.querySelector('.score').textContent = score != null && score !== '' ? `${score}/10` : '';
}

export function clearVerdict(el) {
  if (!el) return;
  el.querySelector('.verdict').className = 'verdict';
}

export function setTokens(el, tokens) {
  if (!el) return;
  el.querySelector('.tokens').textContent = tokens ? `${formatTokens(tokens)} tokens` : '';
}

export function formatTokens(n) {
  if (!n) return '0';
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n);
}
