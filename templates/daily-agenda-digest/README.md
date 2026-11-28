Every weekday at 7:30, today's Google Calendar meetings arrive as a daily agenda email in Gmail and a Slack message: the schedule, the join links, and a short prep brief on each external attendee, pulled from the notes you keep on them in Runbase.

No more opening the calendar, the CRM and old email threads at 8:55 to remember who Maria from Northwind is and why she asked for this call.

## Key benefits

- **Context before every call**: each external attendee comes with their company, role, relationship and your last notes.
- **Ten minutes back each morning**: no more cross-checking invites against contact notes by hand.
- **Gaps in your contact list made visible**: the email tells you how many attendees are not in your contacts yet, and the brief names them instead of guessing.

## How it works

1. **Schedule trigger**: the workflow "Send today's agenda digest" runs at 7:30, Monday to Friday, Europe/Paris time (cron `30 7 * * 1-5`).
2. **Time window**: a date step sets the end of the window to now plus 15 hours.
3. **Google Calendar**: lists up to 50 events from your `primary` calendar between now and the end of that window.
4. **Prepare agenda** (function `prepare-agenda`): drops cancelled events, your own address and declined invitations, marks every attendee outside `internalDomain` as external.
5. **Condition**: if `count` is 0, the run stops and nothing is sent.
6. **Contacts lookup**: finds Contacts whose `email` matches an external attendee (up to 200).
7. **Merge context** (function `merge-attendee-context`): attaches name, company, role, relationship, notes and last met to each attendee, builds the schedule and counts unknown attendees.
8. **AI brief**: an AI step writes one or two lines per meeting from contact notes and the invite agenda only, flags unknown attendees and names the meeting that needs most preparation (under 180 words).
9. **Slack**: posts the schedule and the brief through the `SLACK_WEBHOOK_URL` incoming webhook.
10. **Gmail**: sends the same content to your address, with the meeting count in the subject.
11. **Log**: upserts an Agenda digests record matched on `day`.

## Who it's for

- **Account executives and sales managers**: walk into each prospect call knowing who owns the budget and what was promised last time.
- **Customer success and RevOps**: see renewal dates and open requests from customer notes right before each QBR.
- **Founders**: keep investor, partner and candidate calls straight on days with eight meetings.
- **Executive assistants**: stop rebuilding the morning briefing by hand.

## The problem

Google Calendar shows a 9:30 meeting with three email addresses. It does not say one of them is a Head of Operations whose renewal is due in January and who asked for SSO. That context sits in notes or someone's memory, and gathering it for every call takes longer than anyone has.

So people skim the invite title and improvise, or an assistant rebuilds the same briefing by hand every day.

## What it does

The template creates an **Agenda** database with two objects:

- **Contacts**: name, email (unique), company, role, relationship (prospect, customer, partner, investor, candidate, other), notes and last met.
- **Agenda digests**: day (unique), meetings, known attendees, unknown attendees, brief and sent at.

Saved views: **Customers** (most recently met first), **Recently met** (all contacts by last met) and **Digest history**.

Two functions (`prepare-agenda`, `merge-attendee-context`) and one workflow do the work. Sample data includes four contacts and one past digest.

## Setup

1. Import the template to create the **Agenda** database (Databases page › **Import template**, or the MCP tool `template.import`).
2. Add a `google` connection for the account whose calendar you want summarized. It is used both to read Google Calendar and to send with Gmail.
3. Create a Slack incoming webhook for the channel you want, then set it as the secret `SLACK_WEBHOOK_URL`.
4. Choose your AI provider in the workspace settings. Runbase has no default provider, and the brief step needs one.
5. Open the workflow and edit the placeholders: `internalDomain` and `ownerEmail` in the prepare step, the Gmail `to` address, and the timezone in both the trigger and the prepare step.
6. Add your real contacts and delete the sample records.
7. Start a test run on a day with meetings, check the Slack message and the email, then activate the workflow.

## Customize it

- Change the cron to `0 8 * * 1-5` for an 8:00 digest.
- Remove the Slack step if you only want the Gmail version, or the Gmail step for Slack only.
- Edit the AI prompt to add a suggested question per meeting.
- Add a "Needs notes" view on Contacts filtered on empty notes, to see whose context is missing.

## FAQ

### How do I get a daily agenda email from Google Calendar?

Google Calendar's own daily agenda lists only titles and times. This template sends its own email through Gmail at 7:30 on weekdays, with join links and a prep brief on each attendee.

### Can I get a summary of my meetings in Slack every morning?

Yes. The workflow posts the schedule and the brief to the Slack channel behind your `SLACK_WEBHOOK_URL`. One webhook posts to one channel, and the workflow reads one calendar (`primary`), so each teammate needs their own copy.

### Does it read my emails or past meeting notes?

No. Runbase cannot read your inbox or meeting recordings. The brief uses only the Contacts records you maintain, plus the agenda written in the calendar invite, so its quality depends on keeping those notes current.

### What happens if an attendee is not in my contacts?

The brief says plainly that the person is not in your contacts instead of inventing a profile, and the email shows how many unknown attendees you had.

## Related templates

- [Meeting booked tracker](https://getrunbase.com/templates/meeting-booked-tracker) — log every booked meeting so your contacts and the daily brief stay complete.
- [Post-meeting follow-up](https://getrunbase.com/templates/post-meeting-follow-up) — send the recap email after the calls this digest prepared you for.
- [CRM light](https://getrunbase.com/templates/crm-light) — a fuller contact and deal base when your notes outgrow a single object.
