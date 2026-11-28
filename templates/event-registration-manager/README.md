Every signup for your webinar or meetup joins the Google Calendar guest list, gets a Gmail confirmation with the join link, becomes a row in a live Google Sheet, and gets a reminder 24 hours before the start. Webinar registration automation from your own form, with the attendee list kept in Runbase.

It replaces copy-pasting between form, invite, spreadsheet and inbox, and the event platform billed per attendee.

## Key benefits

- **No missing guests**: each signup rebuilds the full guest list, so nobody drops off the invite.
- **Confirmation in seconds**: Gmail confirms in the same run, with the join link or venue address.
- **Sales sees the list live**: company, job title and source hit the sheet at signup, no weekly export.
- **No reminder after a cancellation**: the run checks the registration is still `confirmed` first.

## How it works

One workflow, "Register an attendee from the signup form":

1. **Trigger**: your form posts to the `event-registration-form` webhook. Runbase upserts a registration on `registration_id` (`payload.id`), with `payload.utm_source` as `source` and `payload.submitted_at` as `registered_at`.
2. **Find the event**: it looks up Events by `calendar_event_id` = `event_id`. No match stops the run with an error.
3. **Load the registrations**: it reads up to 500 registrations for that event.
4. **Plan**: the `plan-registration` function builds the guest list (`hosts` plus non-cancelled registrants), formats the date in the event's `timezone` and sets the reminder time.
5. **Update Google Calendar**: it writes the guest list to the event on your primary calendar with `sendUpdates: none`, so Google sends no invitation of its own.
6. **Confirm by Gmail**: "You're registered: <title>" with date and join link.
7. **Mark confirmed**: `status` = `confirmed`, `confirmed_at` filled.
8. **Log in Google Sheets**: one row (time, name, email, company, job title, event, source, status) appended to `sheet_id` / `sheet_tab`.
9. **Reminder check**: the run continues only if the event starts more than 25 hours from now.
10. **Wait**: the run waits until 24 hours before the start.
11. **Still registered?**: continues only if `status` is still `confirmed`.
12. **Remind by Gmail**: "Tomorrow: <title>", then `status` = `reminded`.

## Who it's for

- **Marketing teams** — run monthly webinars without paying a webinar platform per registrant.
- **Growth teams** — see which `utm_source` brings the most signups per event, right in the registration table.
- **RevOps** — hand sales a sheet of registered companies and job titles that is current before the session starts.
- **Community and ops managers** — run in-person meetups and keep one list of no-shows.

## The problem

You announce a webinar on LinkedIn and 80 people fill in the form over two weeks. Someone copies each email into the invite, writes a confirmation, updates the sales spreadsheet and plans reminders. By signup 40, three people are missing from the invite and the sheet is a week old.

Cancellations still get the reminder. Event tools fix this, but charge per seat and keep your attendees behind an export button.

## What it does

The template creates an **Events** database with two objects:

- **Events**: `calendar_event_id` (unique), title, format (webinar, meetup, workshop, conference), start and end, time zone, join link or address, hosts and speakers (emails), capacity, attendee sheet id and tab, and status (draft, open, full, done).
- **Registrations**: `registration_id` (unique), name, email, company, job title, calendar event id, source, status (registered, confirmed, reminded, attended, no_show, cancelled), and registered, confirmed and reminded timestamps.

Four saved views: **Upcoming events** (open or full, soonest first), **Latest registrations**, **Waiting for reminder** (confirmed, not yet reminded) and **No-shows to follow up**.

Sample data: a December webinar, a January RevOps meetup in Paris, and four registrations (one cancelled).

## Setup

1. Add the **Events** database to your workspace with **Import template** on the Databases page.
2. Link the Google account that owns the event calendar. The workflow uses Gmail (send), Google Calendar (update an event) and Google Sheets (append rows). No secrets are needed.
3. Create the event in Google Calendar and add an Events record with its id as `calendar_event_id`, plus dates, `timezone`, join link, hosts, `sheet_id` and `sheet_tab`.
4. Create the `event-registration-form` webhook and point your form at it. Send `id`, `name`, `email`, `event_id`, and optionally `company`, `job_title`, `utm_source`, `submitted_at`.
5. Send a test submission and check the run: guest added in Calendar, confirmation received, row in the sheet.
6. Activate the workflow.

## Customize it

- Change the reminder from 24 hours to 2 hours in `plan-registration`, and the 25-hour cutoff with it.
- Add a Slack step that posts each signup to your events channel.
- Add a condition on `capacity` that sets the event to `full` and sends a waitlist email instead of a confirmation.
- Set `sendUpdates` to `all` if you also want Google's own invitation email.
- Add a view on Registrations grouped by `source` to compare channels per event.

## FAQ

### How do I automate webinar registration with Google Calendar and Gmail?

Post your form to the Runbase webhook. Each signup is added to the Calendar guest list, confirmed by Gmail and logged in the sheet. Each event needs an Events record whose `calendar_event_id` matches the form's `event_id`.

### Can I send an automatic reminder email the day before an event?

Yes. The run waits until 24 hours before `starts_at` and sends it from your Gmail. Signups less than 25 hours before the start get the confirmation only.

### What happens when someone cancels?

Runbase cannot read your inbox, so a reply saying "I can't come" changes nothing. Set the status to `cancelled` and the reminder is skipped; the next signup also drops them from the guest list.

### Does it handle capacity and waitlists?

Not out of the box. `capacity` and `full` are stored but not enforced; add a condition step for a hard limit.

## Related templates

- [No-show follow-up](https://getrunbase.com/templates/no-show-follow-up) — email the people in your "No-shows to follow up" view with the recording.
- [Newsletter signup](https://getrunbase.com/templates/newsletter-signup) — turn webinar registrants into newsletter subscribers.
- [Slack lead alert](https://getrunbase.com/templates/slack-lead-alert) — ping sales in Slack when a target account registers.
