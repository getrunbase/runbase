Every meeting on your Google Calendar that an outside guest declined or never confirmed gets a no-show follow-up email from your own Gmail within the hour, with your reschedule link. Each miss is logged, and your team gets a Slack alert.

No more reps writing "sorry we missed you" notes by hand the next morning, or forgetting them entirely.

## Key benefits

- **Follow-up lands while the call is still fresh**: the workflow runs at five past every hour, so a guest who skipped a 3 pm demo hears from you by 4:05 pm.
- **Colleagues never get the email**: anyone on your `INTERNAL_EMAIL_DOMAIN` is skipped, and cancelled events are ignored.
- **No double sends**: each run only looks at meetings that ended in the hour just closed, and each record is keyed by event ID plus attendee email.
- **A no-show rate you can finally count**: every missed meeting sits in one table with its invite response and status.

## How it works

1. **Schedule trigger**: the workflow `Follow up no-shows every hour` fires on the cron `5 * * * *`.
2. **Compute the window** (`fn.no-show-window`): returns the hour that just ended (`start`, `end`) and a `listFrom` 24 hours earlier, so long meetings that ended in the window are still listed.
3. **Read the calendar** (`google_calendar.list_events`): lists up to 250 events on your `primary` calendar between `listFrom` and `end`, through the `google` connection.
4. **Find no-shows** (`fn.find-no-shows`): keeps non-cancelled events whose end time falls inside the window. For each attendee with a real email outside `INTERNAL_EMAIL_DOMAIN`, it keeps those whose response is `declined` or `needsAction` (stored as `no_reply`).
5. **Loop over each no-show** (up to 100 per run):
   - **Gmail send**: emails the attendee with the subject "Sorry we missed you: {meeting title}", the scheduled time and your `RESCHEDULE_URL`.
   - **Record upsert**: writes the meeting into `meetings` with the key `{event_id}-{email}`, status `follow_up_sent` and `follow_up_sent_at` set to now.
   - **Slack send**: posts to `SLACK_WEBHOOK_URL` who missed which meeting, when, and the invite response.

## Who it's for

- **SDRs and account executives** — win back booked discovery calls and demos without chasing every ghosted slot by hand.
- **RevOps** — get a clean record of missed meetings and how many were rescheduled or lost.
- **Recruiters and HR** — send candidates who missed an interview a polite way to pick a new time.
- **Customer success managers** — catch missed onboarding calls before the account goes quiet.
- **Growth and marketing teams** — recover demo requests that cost ad spend to generate.

## The problem

A prospect books a 30-minute demo, then the slot comes and goes with no one on the line. The rep waits five minutes, jumps to the next call, and means to send a note later. Two days on, the lead is cold.

Scheduling tool add-ons only cover meetings booked through their own links, and managers have no count of missed meetings or recoveries.

## What it does

- **Object `meetings`** (database Meetings): `title`, `attendee_email`, `event_id`, `start`, `end`, `response` (`declined`, `no_reply`), `status` (`no_show`, `follow_up_sent`, `rescheduled`, `lost`), `follow_up_sent_at`, `event_link` and free `notes`.
- **Saved views**: *Waiting for a new slot* (status `follow_up_sent`), *Rescheduled* (status `rescheduled`) and *All no-shows*, all sorted by most recent end time.
- **Sample data**: four meetings (Northwind, Brightlane, Quillstack, Ferrovia) covering the follow-up sent, rescheduled and lost statuses.

## Setup

1. Ask your AI agent to run `template.import`, or use **Import template** on the Databases page, to add the **Meetings** database.
2. Connect your Google account under the connection name `google`, with Google Calendar and Gmail access. Follow-ups are sent from this mailbox.
3. Set the secrets:
   - `RESCHEDULE_URL`: your booking page link.
   - `SLACK_WEBHOOK_URL`: a Slack incoming webhook for the channel that should get alerts.
   - `INTERNAL_EMAIL_DOMAIN`: your company domain, for example `acme.com`.
4. Run the workflow once in test mode and check the events found and planned emails.
5. Activate the workflow. It then runs at five past every hour.

## Customize it

- Edit the email text in the Gmail step to match your voice, or add the meeting link with `{{item.event_link}}`.
- Change `calendarId` from `primary` to a shared team calendar.
- Drop `needsAction` from `find-no-shows` to email only guests who explicitly declined.
- Add a saved view on `status` = `lost` filtered to the last 30 days for a monthly review.

## FAQ

### How do I send an automatic no-show follow-up email from Gmail?

Connect your Google account in Runbase, set your reschedule link as `RESCHEDULE_URL`, and activate this workflow. Every hour it sends the email from your Gmail to outside guests of meetings that just ended.

### How does it know someone did not show up?

It reads the invite response in Google Calendar, not who actually joined the call. A guest who declined or never answered the invite counts as a no-show. A guest who accepted and then skipped the call is not detected, and someone who joined without accepting would still get the email.

### Will it email people who reply or rebook?

The workflow sends one email per meeting and attendee, and it does not read your inbox or your booking tool. When a guest rebooks, change the record's status to `rescheduled` yourself, or connect your booking tool's webhook to update it.

### Does it work with Zoom or Google Meet calls?

Yes, as long as the meeting is an event on the connected Google Calendar with the guest invited. Only the event and its attendee responses are read.

### Can I send a second reminder if they do not answer?

Not out of the box: the workflow sends a single follow-up. You can add a second workflow that finds `follow_up_sent` records older than a few days and emails them again.

## Related templates

- [Meeting Reminder Emails](https://getrunbase.com/templates/meeting-reminder-emails) — cut no-shows before they happen with reminders ahead of each call.
- [Post-meeting Follow-up](https://getrunbase.com/templates/post-meeting-follow-up) — the matching email for meetings that did take place.
- [Meeting Booked Tracker](https://getrunbase.com/templates/meeting-booked-tracker) — log every booked meeting so no-shows sit next to the full picture.
