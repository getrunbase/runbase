Every morning at 8:00, each external guest on tomorrow's Google Calendar gets a meeting reminder email from your own Gmail address, with the time in your time zone, the agenda from the invite and the Google Meet link. Every reminder is logged, so you can mark who attended or did not show up.

It replaces hand-written "see you tomorrow" emails, or a scheduling suite bought just to cut no-shows.

## Key benefits

- **Fewer forgotten calls**: a client who booked two weeks ago gets a nudge in their inbox the day before, not a calendar popup they muted.
- **No copy-paste work**: title, time, join link and agenda come from the Google Calendar event, so fifteen reminders cost as much effort as one.
- **Only the right people are emailed**: colleagues on your domain, you, declined guests and cancelled events are skipped.
- **An attendance record you own**: each reminder is a row whose status you set to attended, no-show or rescheduled.

## How it works

Workflow **Email tomorrow's attendees a reminder**:

1. **Trigger**: a schedule runs every day at 8:00 (cron `0 8 * * *`, Europe/Paris).
2. **Date window**: two date steps compute `now + 16 hours` and `now + 40 hours`, covering tomorrow from midnight to midnight.
3. **Google Calendar**: `list_events` reads your `primary` calendar between those two times, up to 100 events.
4. **Function `build-reminders`**: drops cancelled events and events without a start, then keeps attendees who are not the owner email (`you@yourcompany.com`), not on the internal domain (`yourcompany.com`) and not `declined`. It formats the time, picks the join link (Meet link, else location, else event link) and uses the description as agenda.
5. **Loop over each reminder** (up to 100):
   - **Gmail send**: subject `Reminder: <title> tomorrow, <when>`, plain-text body with time, join link and agenda.
   - **Record upsert** in **Reminders**, matched on `key` (event id + attendee email), with `status` = `sent` and `sent_at` = now.
   - **Event** `reminder_sent` deduplicated by `reminder:<key>`.

## Who it's for

- **Sales and SDR teams**: discovery calls and demos booked weeks ahead show up more often when the prospect gets a reminder from the rep's own address.
- **Customer success managers**: onboarding and QBR calls start on time with the Meet link in the client's inbox.
- **Consultants and agencies**: a reminder for every client session without a per-seat reminder app.
- **RevOps and ops**: a log of reminders and no-shows, plus a `reminder_sent` event to measure show rates.

## The problem

A prospect books a discovery call for Thursday. By Wednesday evening the Google Calendar invite is buried under newer mail, their calendar notification is turned off, and the agenda lives in a description nobody reopens. At 11:00 you sit alone in the Meet room.

The manual fix is to email each guest every evening. That holds for three calls a day. At fifteen, someone gets forgotten or a guest who declined gets nudged anyway.

## What it does

- **Object `Reminders`** (database **Meeting reminders**): `key` (unique, event id + attendee email), `meeting` (title), `attendee` (email), `start`, `meet_link`, `event_id`, `status` (`sent`, `attended`, `no-show`, `rescheduled`) and `sent_at`.
- **Saved views**: **All reminders** (latest meetings first), **No-shows** (status `no-show`) and **Sent reminders** (status `sent`, newest send first).
- **Function** `build-reminders` and **workflow** `daily-reminders`, described above.
- **Sample data**: four reminders (Northwind coaching, Bright Labs review, Acme discovery call, Greenleaf workshop), one per status

A second run updates the existing row (upsert on `key`), but the Gmail step does not check the log, so a manual re-run emails again.

## Setup

1. Import the template to create the **Meeting reminders** database (Databases page › **Import template**, or the MCP tool `template.import`).
2. Connect your Google account for Google Calendar and Gmail in **Connections**. No secrets are needed.
3. Open the workflow, edit the `build` step and replace `internalDomain` (`yourcompany.com`) and `ownerEmail` (`you@yourcompany.com`) with your own values. Outside Europe/Paris, change `timezone` and the trigger time zone.
4. Run the workflow once in test mode with a test meeting tomorrow that has an external guest,, then check the email and the row in **Reminders**.
5. Activate the workflow. It then runs every morning at 8:00.

## Customize it

- Send reminders two hours before instead of the day before: change the cron to hourly and the date window to 1-3 hours.
- Add a Slack step after the loop that posts `{{steps.build.output.count}}` reminders sent to your sales channel.
- Trigger a second workflow on the `reminder_sent` event to send a follow-up when you set the status to `no-show`.

## FAQ

### How do I send automatic meeting reminder emails from Google Calendar?

Calendar notifications reach the guest's calendar app, which many people mute. This template reads tomorrow's events every morning and sends each external guest a real email from your Gmail, with the time, agenda and Meet link.

### Will my colleagues get the reminder too?

No. Anyone whose email ends with your `internalDomain`, and the `ownerEmail` you set, is skipped. Guests who declined the invite and cancelled events are skipped as well.

### Does it know if the attendee showed up?

No. Runbase cannot see who joined a Google Meet call, so every reminder is logged as `sent`. Set the status yourself or from another workflow; the **No-shows** view picks it up.

### Can it send a reminder one hour before the meeting?

Not out of the box: it runs once a day and covers the next calendar day. You can change the schedule to hourly and shrink the date window, but the Gmail step does not check the log, so overlapping windows would email the same guest twice. Add a lookup on the `Reminders` key first.

## Related templates

- [No-show follow-up](https://getrunbase.com/templates/no-show-follow-up) — email guests who missed the call and offer a new slot.
- [Demo booking confirmation](https://getrunbase.com/templates/demo-booking-confirmation) — confirm the booking the moment it is made, before this reminder goes out.
- [Daily agenda digest](https://getrunbase.com/templates/daily-agenda-digest) — get your own summary of the day's meetings each morning.
