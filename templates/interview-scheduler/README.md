Move a candidate to the **interview** stage and the call books itself: a Google Calendar event with a Meet link for the candidate, the interviewer and the hiring manager, a confirmation email from Gmail, and a post in your hiring channel on Slack. Interview scheduling becomes one field change.

It replaces the copy-paste routine between your candidate spreadsheet, your calendar, your inbox and Slack.

## Key benefits

- **One click instead of five tasks**: changing `stage` to `interview` creates the event, the Meet link, the interview log, the email and the Slack post in one run.
- **Nobody missing from the invite**: the candidate, the interviewer and the hiring manager are always the three attendees, taken from the candidate record, so the manager is never left off.
- **Reschedules reach a person**: the Gmail confirmation uses the hiring manager as reply-to, so "can we move it?" goes to someone who can act on it.

## How it works

The template ships one workflow, **Book the interview when a candidate reaches the interview stage**.

1. **Trigger, record updated**: runs when the `stage` field of a **Candidates** record changes.
2. **Condition**: continues only if `stage` is `interview` and both `interview_start` and `interview_end` are filled. Otherwise the run stops and nothing is sent.
3. **Google Calendar, create event**: on the `primary` calendar, titled "Interview: {name} for {role}", with `interview_start`, `interview_end` and `time_zone`. Attendees are `email`, `interviewer` and `hiring_manager`. A Google Meet link is added and Google emails the invites (`sendUpdates: all`).
4. **Create record**: a new **Interviews** record with `event_id`, `meet_link` and outcome `scheduled`.
5. **Update record**: the candidate gets `meet_link` and `event_link` (the calendar link) from the new event.
6. **Gmail, send email**: "Your interview for the {role} role" goes to the candidate with slot and Meet link, reply-to the hiring manager.
7. **Slack, send message**: a post through `SLACK_WEBHOOK_URL` with candidate, role, slot, panel and Meet link.

There are no delays: everything happens within seconds of the stage change.

## Who it's for

- **Startup recruiters** — book a full panel without leaving the candidate table or opening Google Calendar.
- **Hiring managers** — get every invite automatically and see upcoming calls and missing feedback in saved views.
- **Founders hiring their first team** — a lightweight hiring pipeline without paying for an applicant tracking system.

## The problem

A recruiter agrees a Thursday 3 pm slot with a candidate in New York. Then comes the manual part: build the invite, add three attendees and a Meet link, check the time zone, write the confirmation, tell the channel.

Something slips: no Meet link, the wrong hour, or a hiring manager left off.

## What it does

The import creates a **Hiring** database with three linked objects:

- **Jobs**: title, team (engineering, product, design, sales, marketing, operations), hiring manager email and status (open, on hold, filled).
- **Candidates**: name, unique email, job (with the role title pulled in by lookup), stage (applied, screening, interview, offer, hired, rejected), interview start and end, time zone, interviewer email, hiring manager email, Meet link and calendar link.
- **Interviews**: title, candidate, start, end, interviewer, calendar event ID, Meet link, outcome (scheduled, strong yes, yes, no, strong no, cancelled) and notes.

Five saved views come with it: **Interview stage** (candidates sorted by slot), **Active pipeline** (applied to offer), **Upcoming interviews** (outcome scheduled), **Awaiting feedback** (scheduled with empty notes) and **Open jobs**.

Sample data: two open jobs, three candidates at different stages and one completed interview with notes.

## Setup

1. From the Databases page, click **Import template**; your **Hiring** database appears with its views and workflows.
2. Connect your Google account for Google Calendar and Gmail. Events are created on that account's primary calendar and emails are sent from its address.
3. Create a Slack incoming webhook for your hiring channel and save it as the secret `SLACK_WEBHOOK_URL`.
4. Replace the sample emails (`yourcompany.example`) with real interviewers and hiring managers, or delete the sample records.
5. Test it: on a candidate with your own email, fill `interview_start`, `interview_end` and `time_zone` (for example `Europe/Paris`), then set `stage` to `interview`. Check the invite, the email, the Slack post and the new Interviews record.
6. Activate the workflow.

## Customize it

- Copy the job's `hiring_manager` onto new candidates automatically with a second workflow on record creation.
- Change the condition to also book a call at the `screening` stage, with a shorter title and no hiring manager.
- Add a delayed Gmail step that asks the interviewer for feedback two hours after `interview_end`.
- Post to a different Slack channel per team with a second webhook secret.

## FAQ

### How do I automate interview scheduling with Google Calendar?

Fill the interview start, end and time zone on the candidate, then move the stage to interview. The workflow creates the Google Calendar event with a Meet link and invites the panel. It does not pick the slot for you: you agree the time first, then enter it.

### Can candidates pick their own interview slot?

Not in this template. Runbase does not read your calendar's free and busy times, so there is no self-service booking page.

### What happens if I reschedule the interview?

Editing the dates alone does nothing: the workflow runs only when `stage` changes. Update or cancel the event in Google Calendar (its ID is saved on the Interviews record), or move the stage away and back to interview, which books a new event and sends a new email.

### Can I send an interview confirmation email from Gmail automatically?

Yes. The confirmation is sent from your connected Gmail account with the role, slot, time zone and Meet link, and the hiring manager as reply-to. Runbase cannot read your inbox, so candidate replies arrive in Gmail, not in Runbase.

## Related templates

- [Applicant Tracker](https://getrunbase.com/templates/applicant-tracker) — capture applications and move them through stages before the interview.
- [Meeting Reminder Emails](https://getrunbase.com/templates/meeting-reminder-emails) — send a Gmail reminder before each call to cut no-shows.
- [Employee Onboarding](https://getrunbase.com/templates/employee-onboarding) — hands each hire a checklist for their first days.
