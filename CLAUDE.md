# Shiro

A job-application workspace for Claude Code. There are no API keys: everything runs on the user's own Claude subscription.

## Commands
- `/setup [resume]`: create the private career memory from the user's resume and collect standard form answers.
- `/review [JD path | URL] [resume]`: 10 reviewers (plus the design lead for design roles) try to reject the resume in parallel → debrief → the resume writer produces a tailored version.
- `/apply <URL> [resume]`: fill an application form in Chrome from memory. Never submits.
- `/remember <fact>`: save a new career fact to memory.

## Layout
- `.claude/agents/`: `resume-picker` (chooses the best base resume for a job), the panel reviewers (`ats`, `recruiter`, `hiring-manager`, `teammate`, `rival-applicant`, `ceo`, `technical-interviewer`, `skeptic`, `design-lead`, `skip-level-manager`, `hr-screener`; `design-lead` is off by default in the app and runs in `/review` only for design roles), plus `debrief` and `resume-writer`.
- `.claude/skills/`: the four commands.
- `ui/review-pipeline.mjs`: how the app runs a review: free local steps (JD, resume text via `tools/resume-text.mjs`, keyword pre-rank, files, `tools/resume-html.mjs` + PDF) plus one `claude -p --agent <name> --tools ""` call per agent with inputs inline. Agent files therefore support two modes: inline (reply with the output) and file paths (read/write files, used by the `/review` skill in the terminal).
- `ui/memory-edit.mjs`: free removals from the Memory tab (an item of a memory file, a document, a link, a resume). It saves the touched files to `memory/.trash/<id>/` first so Undo restores them exactly; the trash is emptied on server start and after an hour. Agents ignore `memory/.trash/`. Free-text "Forget" goes to Memo as `/remember FORGET: …`.
- `ui/`: the local web app (`npm run ui`). `server.mjs` runs `claude -p` with stream-json and turns its events into UI events; `public/` is plain HTML/CSS/JS with no build step. The app's agent names and the reviewer list in `ui/public/creatures.js` must match the agent files.
- `templates/memory/`: blank memory files. `templates/resume.html` and `templates/cover-letter.html`: printable templates.
- `tools/html-to-pdf.mjs`: turns a run's HTML into a PDF with the local Chrome/Edge (`node tools/html-to-pdf.mjs <in.html> <out.pdf>`, files must be in runs/ or memory/). Pages with `<meta name="shiro-fit">` (the resume template) are fitted: if the PDF spills onto an extra page it tightens size and spacing step by step (never below ~9pt) and writes the chosen step into the HTML too. `tools/resume-html.mjs` turns bare URLs, emails and the contact line's addresses into blue links. Skills call it as a single command with no `cd`, because the app only pre-approves that exact command prefix.
- `tools/file-doc.mjs`: moves a file inside `memory/` into its section (`node tools/file-doc.mjs <file> <section>/<clear-name> …`), never overwriting. Sections: certificates, academic, letters, portfolio, cover-letters, other, duplicates, resumes.
- `memory/documents/<section>/` + `memory/documents.md` (one heading per section, plus Links): files and links that forms may ask for; `/apply` uploads from here. Files directly in `memory/documents/` are new and unsorted. Never identity or bank documents.
- `ui/server.mjs` `VERSION` must equal `APP_VERSION` in `ui/public/app.js`; bump both when the server changes, so a stale running server shows a restart banner.
- `memory/`: the user's career memory (private, git-ignored). The source of truth for everything about the user.
- `runs/`: one folder per `/review` run (private, git-ignored).

## Rules that always apply
1. **Keep memory current.** Whenever the user mentions a new career fact in any conversation (started or finished an internship or job, completed a course or certificate, built a project, learned a skill, won something, changed phone, email, location or status), update `memory/` following `.claude/skills/remember/SKILL.md`, and tell them in one line what was saved.
2. **Truth.** Never invent or inflate experience, skills, numbers, dates or titles, whether in resumes, form answers or drafts. Ask for missing facts; don't guess them.
3. **Never submit applications.** Fill only; the user reviews and submits. Never create accounts, type passwords, solve CAPTCHAs or accept terms on the user's behalf.
4. **Privacy.** `memory/` and `runs/` hold personal data. Never commit them, and never send their contents anywhere except the application form the user asked to fill. Never store passwords, government ID numbers or bank details.
5. **Which source wins.** Memory is the source of truth. When a resume and memory disagree, memory wins, unless the resume has something newer than memory's `Last updated` date (in `memory/profile.md`) that memory doesn't have yet (for example a new internship that started after that date). Then the resume wins for that fact: use it, and save it to memory following the remember skill. Among resumes, the `Reference resume` in `profile.md` beats the others.
6. **Keep the repo generic.** Agents, skills and templates are shared with other users, so personal details stay out of them.
