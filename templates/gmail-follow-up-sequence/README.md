Every prospect you add to Runbase gets up to three personal emails sent from your own Gmail account, all in one thread, three and four days apart. The moment you mark someone as replied, the remaining follow-ups stay unsent. It is Gmail follow up automation you own, with prospects kept in your workspace.

It replaces the calendar reminders, copied drafts and per-seat outreach tool that most small teams juggle to chase cold emails.

## Key benefits

- **No forgotten second email**: the follow-ups on day 3 and day 7 go out on schedule, so prospects who answer on the second or third touch still hear from you.
- **One thread, not three cold emails**: steps two and three reuse the Gmail thread id from the first send, so the prospect sees one tidy conversation.
- **No awkward follow-up after a reply**: before each send, the workflow checks the prospect's status and stops if it is no longer `in_sequence`.
- **A pipeline you can read at a glance**: three saved views split prospects into in sequence, replied or booked, and finished without reply.

## How it works

The workflow **Send the Gmail follow-up sequence** runs once per prospect:

1. **Trigger**: a record is created in **Prospects**.
2. **Condition**: continue only if `status` equals `new` (the default). A prospect imported as `replied` or `not_interested` is never emailed.
3. **Gmail send**: email 1 goes to `email` with the subject "{company} and {topic}", greeting the prospect by `first_name`.
4. **Update record**: `status` becomes `in_sequence`, `last_step` becomes 1 and the Gmail `threadId` is saved in `thread_id`.
5. **Wait** 3 days (`3d`).
6. **Condition**: continue only if `status` is still `in_sequence`.
7. **Gmail send**: email 2, subject "Re: {company} and {topic}", in the same thread.
8. **Update record**: `last_step` becomes 2.
9. **Wait** 4 days (`4d`).
10. **Condition**: continue only if `status` is still `in_sequence`.
11. **Gmail send**: email 3, a short closing note in the same thread.
12. **Update record**: `status` becomes `finished`, `last_step` becomes 3.

## Who it's for

- **Founders doing their own outbound** — keep chasing leads from your real inbox without buying a sales engagement seat.
- **Account executives** — personal follow-ups go out while you work on live deals, and stop once you log a reply.
- **RevOps** — get a clean record of who received which step, and a base to build team-wide sequences on.

## The problem

You send twenty personal emails on Monday. By Thursday, four people have answered and sixteen have not. Chasing those sixteen means finding each thread, writing a nudge and remembering who replied. Most people stop after one round, and the deals that come on the third touch are lost.

Outreach platforms bill per seat and hold your list in their database. And the classic mistake remains: a "just bumping this up" landing a day after the prospect said yes.

## What it does

The template creates an **Outbound** database with one object, **Prospects**. Its fields are `name` (title), `first_name`, `email` (unique, so the same person cannot enter twice), `company`, `topic` (used in the email copy), `status`, `last_step` (last step sent), `thread_id` (Gmail thread id) and `notes`. The `status` options are `new`, `in_sequence`, `replied`, `meeting_booked`, `not_interested` and `finished`.

Saved views:

- **In sequence**: active prospects, sorted by last step sent.
- **Replied**: prospects marked `replied` or `meeting_booked`, with notes.
- **Finished without reply**: prospects who got all three emails.

There is one workflow, described above. It needs no secrets. Four sample prospects (Northwind, Lumen Labs, Brightpath, Quarry) show each stage.

## Setup

1. Start by importing the template, which creates the **Outbound** database.
2. In **Settings › Connections**, connect the Google account you send from. The workflow only uses Gmail's send permission.
3. Open the workflow and rewrite the three emails for your offer. Adjust the `3d` and `4d` waits if needed.
4. Delete the four sample records.
5. Activate the workflow, then add one prospect with your own address and check that email 1 arrives.
6. Import your prospects from CSV. Each new record starts its own sequence.
7. When someone replies, set their status to `replied`, `meeting_booked` or `not_interested`.

## Customize it

- Change the waits to `2d` and `5d`, or add a fourth `wait` and Gmail step before the final update.
- Add a Slack step after `send_3` so the owner hears when a prospect finishes without reply.
- Use the `topic` field for a pain point or a mutual connection instead of a project.
- Add an `owner` field and a saved view per sales rep.

## FAQ

### Can I send automatic follow-up emails from Gmail?

Yes. Once your Google account is connected, Runbase sends each email from your own Gmail, so it shows in your Sent folder. The template sends email 1 when the prospect is added, email 2 three days later and email 3 four days after that.

### How do I stop Gmail follow up automation when someone replies?

Change the prospect's status to `replied`, `meeting_booked` or `not_interested`. Each follow-up first checks that the status is still `in_sequence`. Runbase cannot read your inbox, so it does not detect replies by itself: you, or your AI agent, update the status.

### Will the follow-ups land in the same email thread?

Yes. The first send returns a Gmail thread id, which the workflow saves on the prospect and passes to steps two and three. Their subjects start with "Re:", so Gmail groups them.

### How many follow-up emails can I send per day?

Runbase adds no cap, but Gmail limits daily sends per account, lower on free accounts than on Workspace. Import prospects in small batches.

## Related templates

- [Cold email from sheet](https://getrunbase.com/templates/cold-email-from-sheet) — start outreach from a Google Sheet list instead of adding prospects by hand.
- [No-show follow-up](https://getrunbase.com/templates/no-show-follow-up) — chase prospects who booked a call and missed it.
- [Post-meeting follow-up](https://getrunbase.com/templates/post-meeting-follow-up) — send the recap once a prospect has said yes to a meeting.
