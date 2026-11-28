Every demo request submitted on your website form becomes a Google Calendar event with a Meet link, a demo booking confirmation email sent from Gmail, and a Slack heads-up for the rep who runs the call. Every request also lands in a table your sales team can sort and report on.

It replaces copying form answers into an event, typing a confirmation by hand and pinging the rep in a side channel.

## Key benefits

- **Booked before the prospect closes the tab**: the invite, the Meet link and the confirmation go out as soon as the form posts, while intent is high.
- **No double bookings on resends**: requests are matched on `request_id`, so a form that retries the same submission updates one record instead of creating a second event.
- **Reps walk in prepared**: the Slack message carries the company, team size and "what they want to see", so the owner knows the agenda before opening the calendar.

## How it works

The template ships one workflow, **Book the demo from the form**.

1. **Trigger, webhook `demo-form`**: the form payload (`payload.id`, `payload.name`, `payload.email`, ... `payload.owner`) creates or updates a **Demo requests** record, matched on `request_id`.
2. **Google Calendar, create event**: on the `primary` calendar, with the title "Demo: {company} x our team" and the request details in the description, the start and end from the slot fields, and `time_zone` as the event time zone. The prospect and the owner are both invited, a Google Meet link is added and Google sends the invites (`sendUpdates: all`).
3. **Update the record**: `status` becomes `booked`, and `event_id`, `event_link` and `meet_link` are saved from the new event.
4. **Gmail, send email**: the prospect receives "Your demo is booked" with the Meet link. The reply-to address is the owner, so a reschedule request goes straight to the rep.
5. **Slack, send message**: a post through `SLACK_WEBHOOK_URL` with owner, prospect, company, team size, slot start (UTC), request message and Meet link.

No conditions or delays: every submission runs all five steps.

## Who it's for

- **Sales teams and founders** — every inbound demo gets booked and confirmed without anyone touching a calendar.
- **RevOps** — a clean record per request with owner, slot and status, ready for conversion and no-show reporting.
- **Growth and marketing** — the form you already run becomes a booking flow, no per-seat scheduler.

## The problem

A prospect picks a Thursday slot on your pricing page at 9:40. The form emails a shared inbox. At 11:15 someone creates the event, forgets the Meet link and gets the hour wrong because the slot was in New York time. The rep has no idea what the prospect wanted to see.

At twenty requests a week, you lose hours, a few deals to slow replies, and any view of who booked or showed up.

## What it does

- **Database**: Sales demos.
- **Object**: Demo requests, with Request ID (unique), Name, Email, Company, Team size (1-10, 11-50, 51-200, 201+), What they want to see, Slot start, Slot end, Time zone, Owner email, Status (requested, booked, done, no_show, cancelled), Calendar event ID, Calendar link and Meet link.
- **Saved views**: **Upcoming demos** (status booked, soonest first, showing name, company, slot, owner and Meet link), **Not booked yet** (status requested, by slot) and **All requests by slot** (newest slot first).
- **Workflow**: Book the demo from the form, described above.
- **Secret**: `SLACK_WEBHOOK_URL`, where booked demos are announced.
- **Sample data**: four requests covering the booked, requested, done and no_show statuses across four time zones.

## Setup

1. From the Databases page, click **Import template**; your **Sales demos** database appears with its views and workflows.
2. Connect the Google account whose calendar should host the demos; it also sends the Gmail confirmation.
3. Create a Slack incoming webhook for your sales channel and save its URL as the secret `SLACK_WEBHOOK_URL`.
4. Create an inbound webhook named `demo-form` and point your form at its URL. Send the fields listed in step 1 of How it works, with ISO 8601 dates and an IANA time zone such as `Europe/Paris`.
5. Send a test submission with your own email as the prospect and check the event, the email, the Slack post and the record.
6. Activate the workflow.

## Customize it

- Add a condition on `team_size` so only `201+` requests post to an enterprise Slack channel.
- Add a Gmail step after the event that sends the owner a prep brief with the request message.
- Add a "No-shows this month" view filtering `status` on `no_show` for your weekly pipeline review.
- Swap `primary` for a shared team calendar ID so every demo sits on one calendar.

## FAQ

### How do I automatically create a Google Calendar event from a form submission?

Point the form at the `demo-form` webhook and each submission becomes an event with both attendees and a Meet link. Your form must send the slot start and end; Runbase does not pick a free time for you.

### Can I send a demo booking confirmation email automatically from Gmail?

Yes. Step four sends it from your connected Gmail, with the Meet link and the owner as reply-to. Runbase cannot read your inbox, so replies asking to reschedule reach the rep, who updates the event by hand.

### Does it check whether the rep is free at that time?

No. The workflow books the slot the form sends, without reading availability. Offer only open slots in your form, or add a Calendar list events step and a condition before booking.

### Will the prospect see the right time in their time zone?

The event is created with the `time_zone` from the form, and Google Calendar shows each attendee the time in their own zone. The Slack message prints the slot start in UTC, so reps should rely on the invite for local time.

## Related templates

- [Meeting reminder emails](https://getrunbase.com/templates/meeting-reminder-emails) — reminds booked prospects before the call to cut no-shows.
- [No-show follow-up](https://getrunbase.com/templates/no-show-follow-up) — picks up the requests you mark `no_show` and offers a new slot.
- [Post-meeting follow-up](https://getrunbase.com/templates/post-meeting-follow-up) — sends the recap once a demo is marked done.
