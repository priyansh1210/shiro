# Contributing to Shiro

Thanks for helping make job hunting less painful. Bug reports, ideas and pull requests are all welcome.

## Ground rules

Every change has to keep these:

1. **Truth.** The writer and the form filler never invent or inflate facts: no new numbers, titles, dates or skills.
2. **The user submits.** Shiro fills forms but never submits them, creates accounts, types passwords, solves CAPTCHAs or accepts terms.
3. **Privacy.** Personal data lives only in `memory/` and `runs/`, which are git-ignored. Never commit real resumes, names, emails or employers, including in screenshots and test fixtures. Use placeholders like Jane Doe and Acme.
4. **Generic.** Agents, skills and templates are shared by everyone, so they must work for any candidate, any field and any country.

## Getting set up

```bash
git clone https://github.com/<you>/shiro.git
cd shiro
npm run ui
```

You need Node.js 18+ and Claude Code signed in to a Pro or Max plan. There are no dependencies to install and no build step.

**Testing without spending tokens:** press **Play demo** on any tab (or open `http://127.0.0.1:4747/?demo=review`) to drive the whole UI with fake events. The free local tools can be run directly:

```bash
node tools/resume-html.mjs runs/<run>/resume.md runs/<run>/resume.html
node tools/html-to-pdf.mjs runs/<run>/resume.html runs/<run>/resume.pdf
```

Only run real reviews when you need to test agent behavior, because each one uses part of your plan.

## How the code is organized

| Path | What it is |
|---|---|
| `.claude/agents/` | The agents. Each works in two modes: inline (the app pastes inputs into the prompt) and file paths (the `/review` skill in the terminal). |
| `.claude/skills/` | `/setup`, `/review`, `/apply`, `/remember`. |
| `ui/server.mjs` | Local server: runs `claude -p` with stream-json and turns its events into UI events. |
| `ui/review-pipeline.mjs` | The app's review: free local steps plus one Claude call per agent. |
| `ui/memory-edit.mjs` | Free removals from memory, with Undo. |
| `ui/public/` | Plain HTML/CSS/JS front end. |
| `tools/` | Free local helpers: resume text extraction, Markdown → HTML → PDF, document filing. |
| `templates/` | Blank memory files and the resume / cover-letter templates. |

`CLAUDE.md` has more detail, and Claude Code reads it too, so you can ask Claude to explain any part.

## Adding a reviewer

1. Copy a reviewer in `.claude/agents/` (e.g. `skeptic.md`) to `<your-reviewer>.md`.
2. Change the persona and the "How you reject" section. Keep the rules, the inline/file modes and the output format (the verdict line `REJECT | MAYBE | ADVANCE x/10` is parsed by the app).
3. Add the name to `PANEL` and `RECOMMENDED` in `ui/review-pipeline.mjs`, `RECOMMENDED` in `ui/public/app.js`, `VERDICTS` in `ui/public/demo.js`, the reviewer list in `.claude/skills/review/SKILL.md` and `.claude/agents/debrief.md`, and give it a character in `ui/public/creatures.js` (with its own accessory). If the reviewer only fits some jobs, add it to `DEFAULT_OFF` in `ui/public/app.js` and say in the skill when to run it.
4. Update the reviewer counts in `README.md`, `CLAUDE.md` and the lede in `ui/public/index.html`.
5. Run the free demo to check the panel layout, then one real review.

## Pull requests

- Keep each PR focused on one thing, and describe how you tested it.
- If you change `ui/server.mjs`, bump `VERSION` there and `APP_VERSION` in `ui/public/app.js` together.
- For bigger changes, open an issue first so we can agree on the approach.

## Reporting bugs

Use the **Bug report** template. Please remove personal details from logs and screenshots before posting.
