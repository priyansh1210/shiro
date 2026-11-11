---
name: review
description: Run the rejection panel on a resume for one job. Picks the best base resume to start from, eleven reviewers try to reject it in parallel, a debrief merges their feedback into a fix plan, and the resume writer produces a tailored, truthful new version.
argument-hint: "[JD file path | JD URL] [resume path]"
disable-model-invocation: true
---

# /review: the rejection panel

Arguments: $ARGUMENTS

Each agent's effort comes from its definition (`effort:` in `.claude/agents/*.md`): Low for quick reviewers, Medium where judgment needs depth, High for the writer. Don't override it unless the user asks. (The Shiro app doesn't use this skill: it runs its own cheaper pipeline, see `ui/review-pipeline.mjs`.)

**Save tokens:** never read a resume PDF if a text copy exists at `memory/resume/.text/<file>.txt`; otherwise run `node tools/resume-text.mjs <file>` once (it caches the text). Agents only ever read text files.

## 1. Get the job description
- **File path:** read it.
- **URL:** fetch it with WebFetch. Career pages are often rendered by JavaScript, so if the text comes back empty or without the actual job, and the Claude in Chrome tools are available, open it in a new tab and use `get_page_text`. Otherwise ask the user to paste the JD.
- **Nothing given:** ask the user to paste the JD and wait.

Extract the company name and the role title. If the company isn't clear, ask.

## 2. Create the run folder
`runs/<YYYY-MM-DD>-<company>-<role>/`: lowercase, hyphens, short. If it already exists, add `-2`, `-3`, and so on.

Write `jd.md`: the full job description text with page clutter removed (navigation, cookie banners, footers). Change nothing else. First line: `Source: <URL or path>`.

## 3. Pick the resume to start from
- **A resume path was given in the arguments:** use it. Skip the rest of this step.
- Otherwise, collect the base resumes: every file listed under `## Resumes` in `memory/profile.md`, plus any other resume file in `memory/resume/`.
  - **None:** ask the user for a resume path.
  - **One:** use it.
  - **Several:** run the `resume-picker` agent and wait for it:
    > Job description: <run>/jd.md
    > Resumes: <path 1>, <path 2>, …
    > Write your pick to: <run>/pick.md

    Use the resume it picked, and tell the user in one line which one and why.

If `memory/` doesn't exist, tell the user that `/setup` gives much better results (the writer can use their whole history, not just one resume), and continue if they want to.

## 4. Copy the resume as text
Write `resume-original.md`: a faithful text copy of the chosen resume, with the same sections, wording and order. Don't fix or improve anything. First line: `Source file: <path>`. Use the cached text (`memory/resume/.text/<file>.txt`, or run `node tools/resume-text.mjs <file>`) rather than reading the PDF.

## 5. Run the panel: all 11 at once
Send **one message containing 11 Agent calls** so they run in parallel and none of them sees another's opinion. Subagent types:

`ats`, `recruiter`, `hiring-manager`, `teammate`, `rival-applicant`, `ceo`, `technical-interviewer`, `skeptic`, `design-lead`, `skip-level-manager`, `hr-screener`

Prompt for each (fill in the paths; don't paste the resume or JD text into the prompt, the agents read the files):

> Review this resume for <Role> at <Company>.
> Job description: <run>/jd.md
> Resume text: <run>/resume-original.md
> Write your report to: <run>/feedback/<agent-name>.md

**Wait until all 11 have reported back before going on.** If an agent fails, retry it once. If it fails again, continue without it and tell the user.

Show the user the scoreboard built from the one-line replies: a table of reviewer, verdict, score, reason.

## 6. Debrief
Run the `debrief` agent and wait for it:

> Feedback folder: <run>/feedback/
> Job description: <run>/jd.md
> Resume text: <run>/resume-original.md
> Write the debrief to: <run>/debrief.md

## 7. Rewrite
Run the `resume-writer` agent and wait for it:

> Run folder: <run>/
> Debrief: <run>/debrief.md
> Job description: <run>/jd.md
> Resume text: <run>/resume-original.md
> Resume pick notes (if any): <run>/pick.md
> Career memory: memory/

## 8. Make the HTML and PDF
Run these two commands, each on its own, with nothing else on the line (no `cd`):

`node tools/resume-html.mjs <run>/resume.md <run>/resume.html`
`node tools/html-to-pdf.mjs <run>/resume.html <run>/resume.pdf`

They turn the writer's `resume.md` into the printable page and the PDF, using the Chrome or Edge on this computer. Both cost nothing. If it fails, say so in the report; the user can open `resume.html` and press Ctrl+P → Save as PDF instead.

## 9. Report to the user
Keep it short:
- Which resume it started from (and why, if the picker chose).
- Average score and the ADVANCE / MAYBE / REJECT counts.
- The 3–5 most important fixes that were made.
- Full paths to `resume.pdf`, `resume.md`, `changes.md`, `questions.md` and `debrief.md`. `/apply` uploads `resume.pdf` from here for this job.
- The questions from `questions.md`, and that they can answer them with `/remember`.
- Offer **round 2**: run the same 11 reviewers on the new `resume.md` to see whether the score went up. If they say yes, repeat step 5 with `<run>/resume.md` as the resume text (and no original file), writing to `<run>/round-2/feedback/`, then show the before/after scoreboard side by side. Don't rewrite again unless they ask.
- Offer to **save it as a base resume** for this kind of role: copy `resume.pdf` into `memory/resume/<role>.pdf` (or, if you can't run shell commands, use the run's path) and add a line `- <Role>: <path>` under `## Resumes` in `memory/profile.md`, with `<Role>` kept to a few words (e.g. `AI Engineer Intern (Acme)`), never a list of what changed. Future jobs of this kind will start from it.
