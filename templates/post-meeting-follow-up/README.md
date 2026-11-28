Every client call that ends on your Google Calendar turns into an automatic follow-up email after the meeting: an AI drafts the recap and next steps from the notes you typed in the event, you approve it, and Gmail sends it to the external attendees within the half hour.

It replaces next-morning recaps written from memory, and meeting-assistant seats that keep your notes on their servers.

## Key benefits

- **Recap out while the call is fresh**: meetings are picked up within 30 minutes of ending.
- **No invented promises**: the AI only uses the meeting title and notes, and you read every draft before anything leaves your Gmail.
- **Colleagues never get a client email**: your own address, your company domain and anyone who declined the invite are removed from the recipient list.
- **One log of every commitment**: next steps are stored per call, so Sent follow-ups doubles as a list of promises.

## How it works

**Workflow 1: Collect client meetings that just ended**

1. A schedule trigger runs every 30 minutes (cron `*/30 * * * *`, Europe/Paris).
2. Date steps compute `since` (now minus 30 minutes) and `lookback` (now minus 8 hours).
3. **Google Calendar › List events** reads your `primary` calendar from the lookback time to now, up to 100 events.
4. The `pick-ended-meetings` function keeps events that ended between `since` and now, are not cancelled, and whose title does not contain `[no follow-up]`. It drops `ownerEmail`, the `internalDomain` and declined attendees; events with no external attendee left are ignored.
5. A loop (up to 50 meetings) upserts each one into **Follow-ups**, matched on `event_id`, with `meeting`, `attendees`, `start`, `ended_at` and `notes` (the event description).

**Workflow 2: Draft, approve and send the follow-up email**

1. Triggered when a new Follow-ups record is created.
2. An AI step writes a `subject`, a plain-text `body` (thanks, 3 to 5 recap bullets, next steps, a closing question, under 200 words) and `next_steps`.
3. The draft is saved on the record and `status` becomes **awaiting approval**.
4. A human approval step shows the email, with a 3-day timeout.
5. Approved: **Gmail › Send an email** sends it to `attendees`, then the record gets `status` **sent**, `sent_at` and the Gmail `thread_id`.
6. Rejected or expired: `status` becomes **skipped**.

## Who it's for

- **Account executives** — every discovery call and demo gets a written recap without blocking 15 minutes after each one.
- **Founders who sell** — follow-ups go out on time even on back-to-back days.
- **Customer success managers** — renewal and QBR next steps are confirmed in writing.
- **RevOps leads** — next steps land in a queryable database, not each rep's inbox.

## The problem

A discovery call ends at 10:45; the next starts at 11:00. The notes sit in the invite. By 6 pm the details are fuzzy, the "pricing by Friday" promise is written nowhere the client can see, and sometimes the recap never goes out.

Fully automatic recap tools fix the speed but risk one invented figure in an email signed by you. Here you stay the last reader before send.

## What it does

The template creates a **Meeting follow-ups** database with one object, **Follow-ups**. Key fields: `meeting` (title), `event_id` (unique, so a meeting is never saved twice), `attendees`, `start`, `ended_at`, `notes`, `subject`, `draft`, `next_steps`, `status` (pending, awaiting approval, sent, skipped), `sent_at` and `thread_id`.

Three saved views are included: **Awaiting approval** (oldest first, with subject), **Sent follow-ups** (latest first, with next steps) and **Skipped**. Four sample records (Northwind, Bright Labs, Greenleaf, Acme) show each status, one with empty notes.

## Setup

1. Import the template; it sets up the **Meeting follow-ups** database and its workflows in one step.
2. Add your Google account under **Settings › Connections**. The same account reads the calendar and sends the email. No secret is needed for Google.
3. Open **Collect client meetings that just ended** and, in the **pick** step, replace `yourcompany.com` with your domain and `you@yourcompany.com` with your address.
4. Open **Draft, approve and send the follow-up email** and choose the AI provider, model and API key secret of the **draft** step. Runbase does not pick a provider for you.
5. Activate both workflows. Hold a test meeting with an external guest and notes in the description.
6. Approve the draft from the run, check Gmail, then delete the sample records.

## Customize it

- Change the cron to `*/15 * * * *` for faster recaps, and the `since` step to `-15` minutes to match.
- Add your booking link to the draft prompt.
- Add a Slack step before the approval so the rep is pinged when a draft is waiting.
- Replace `[no follow-up]` with your own skip keyword, such as `[internal]`.

## FAQ

### How do I send an automatic follow-up email after a meeting?

Import this template, connect Google and activate both workflows. Every 30 minutes Runbase finds client meetings that just ended, drafts the email with AI and waits for your approval before Gmail sends it.

### Can AI write meeting recap emails from my notes?

Yes, from the calendar event description. The AI is told never to invent figures, dates or commitments. With empty notes it writes a short thank-you asking to confirm the next step.

### Does it work with Zoom or Google Meet transcripts?

Not directly. The template reads the event description, not recordings or transcripts. If your note-taker writes its summary into the event, the draft uses it.

### Will the follow-up reply in the existing email thread?

No. Each recap is sent as a new Gmail email, and its thread id is stored on the record. Runbase cannot read your inbox, so it does not see the client's replies.

## Related templates

- [No-show Follow-up](https://getrunbase.com/templates/no-show-follow-up) — handles the calls that never happened, while this one covers the ones that did.
- [Gmail Follow-up Sequence](https://getrunbase.com/templates/gmail-follow-up-sequence) — nudges prospects who go quiet after your recap.
- [Meeting Booked Tracker](https://getrunbase.com/templates/meeting-booked-tracker) — logs meetings as they are booked.
