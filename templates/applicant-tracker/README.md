Every application your Google Form drops into a Google Sheet becomes a candidate in a real applicant tracking system: an AI step scores the profile from 1 to 5, Gmail sends the applicant a "we received your application" email, and a screening note lands in a Google Drive folder, ready for interview notes.

It replaces the hiring spreadsheet where stages are cell colours, nobody knows who got a reply, and screening notes live in someone's head.

## Key benefits

- **No applicant left without a reply**: each new candidate gets an acknowledgement from your Gmail address within 30 minutes of applying, and the record is flagged `acknowledged`.
- **Shortlist in minutes, not evenings**: the "To review" view sorts new applicants by AI fit score, with a three-sentence summary next to the resume link.
- **One record per person**: candidates are matched on email, so someone who applies twice, or a sheet that gets re-read, never creates a duplicate.

## How it works

The template ships two workflows.

**Import applicants from the sheet every 30 minutes**

1. A schedule trigger runs every 30 minutes (`*/30 * * * *`).
2. Google Sheets reads `Applications!A1:G1000` from the sheet in `APPLICANTS_SHEET_ID`, using row 1 as headers.
3. For each row (up to 1,000), Runbase upserts a job matched on `title` from the `position` column.
4. It then upserts the candidate matched on `email`, filling `name`, `job`, `linkedin`, `resume_url`, `motivation` and `applied_at` (from `timestamp`).

**Screen, acknowledge and archive each new candidate**

1. Triggered when a candidate is created.
2. An AI step reads the record and returns `skills`, `seniority` (junior, mid, senior, lead or unknown), `fit_score` (1 to 5) and a three-sentence `summary`.
3. Gmail sends "We received your application" to the candidate's email.
4. Google Drive creates `Screening - <name>.md` in the folder `SCREENING_FOLDER_ID`, with links, the AI screening, the motivation and an empty "Interview notes" section.
5. The record is updated with the AI results, the Drive link in `notes_url`, `acknowledged` set to true and `stage` moved to `screening`.

## Who it's for

- **Founders and ops leads** — run hiring for a handful of roles a year without paying for a seat-based ATS.
- **HR and people teams** — keep a clear stage for every candidate, from new to hired or rejected.
- **Hiring managers** — read a 20-second summary before opening a resume.

## The problem

You open a Product Manager role and an SDR role the same week. Forty answers arrive in the form's sheet. By Friday, three people have emailed to ask whether anyone read their application, two candidates appear twice because they reapplied, and the notes from the first calls sit in a private doc nobody else can open.

The sheet collects answers well but tracks nobody. A hosted ATS fixes that, at a per-seat price for features a small team never uses.

## What it does

A **Hiring** database with two linked objects:

- **Jobs**: unique `title`, `team`, `location`, `requirements`, `status` (open, paused, filled).
- **Candidates**: `name`, unique `email`, `job` (link to Jobs), `linkedin`, `resume_url`, `motivation`, `applied_at`, `stage` (new, screening, interview, offer, hired, rejected), plus the screening fields `skills`, `seniority`, `fit_score`, `screening_summary`, `notes_url` and `acknowledged`.

Saved views:

- **Active pipeline**: everyone not hired or rejected, sorted by fit score.
- **To review**: stage `new`, sorted by fit score, with the summary and resume link.
- **Interviews**: candidates in interview or offer, with email and notes link.
- **Open jobs**: jobs with status `open`.

Sample data: two jobs (Product Manager, Sales Development Rep) and four candidates at different stages.

## Setup

1. Import the template to create the **Hiring** database (Databases page › **Import template**, or the MCP tool `template.import`).
2. In the sheet behind your form, name the answers tab `Applications` and set row 1 (columns A to G) to `timestamp`, `name`, `email`, `position`, `linkedin`, `resume_url`, `motivation`.
3. Open **Settings › Connections** and link the Google account your hiring team uses. It covers Sheets, Gmail and Drive.
4. In **Settings › Secrets**, add `APPLICANTS_SHEET_ID` (the id in the sheet URL) and `SCREENING_FOLDER_ID` (the id in the Drive folder URL).
5. Pick an AI provider and model on the **extract** step. Runbase has no default provider.
6. Replace `[Your name]` and `[Company]` in the acknowledgement email.
7. Run the import once in test mode, check a candidate and its Drive note, then activate both workflows.

## Customize it

- Run the import every 10 minutes instead of 30 by changing the cron to `*/10 * * * *`.
- Add a Slack step after **extract** that posts to #hiring when `fit_score` is 4 or more.
- Add a `salary_expectation` column to the sheet and map it to a new candidate field.
- Rewrite the AI prompt to score against the job's `requirements` text.

## FAQ

### How do I build an applicant tracking system in Google Sheets?

Keep the form and sheet as intake and let Runbase hold the pipeline. This template reads the sheet every 30 minutes and turns each row into a candidate with a stage, a score and a notes link.

### Can I send automatic emails to job applicants from Gmail?

Yes. Each new candidate gets one acknowledgement email sent from your connected Gmail account. The template does not send rejection or interview emails on its own; add a workflow on stage change if you want them. Runbase cannot read your inbox, so replies from candidates stay in Gmail.

### Can AI screen resumes automatically?

Partly. The AI step reads the form answers, the motivation text and the LinkedIn and resume links as text. It does not open the resume file itself, so ask for key experience in the form. The score helps you sort; a person should make every hiring decision.

## Related templates

- [Interview Scheduler](https://getrunbase.com/templates/interview-scheduler) — book the first call once a candidate reaches the interview stage.
- [Employee Onboarding](https://getrunbase.com/templates/employee-onboarding) — turns a signed offer into a first-week checklist.
- [Lead Capture to Sheets](https://getrunbase.com/templates/lead-capture-to-sheets) — the same form-to-sheet intake, applied to sales leads.
