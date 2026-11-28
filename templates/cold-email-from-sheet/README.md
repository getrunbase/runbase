Turn the prospect list in your Google Sheet into a cold email campaign that sounds written by hand. AI writes one opening line per row, you review the batch, Gmail sends it from your inbox and the sheet logs `sent` with a timestamp.

It replaces both the generic mail merge prospects ignore and the afternoon spent writing openers by hand.

## Key benefits

- **An afternoon of writing becomes a ten-minute review**: AI drafts each line from `role`, `company` and `notes`; you fix the misses.
- **Nothing goes out unseen**: the run waits up to three days for your approval before Gmail sends anything.
- **No double emails to the same prospect**: rows marked `sent` in the sheet stay out of the queue.
- **The sheet stays the team's source of truth**: columns F and G show `sent` and the send time, with no manual update.

## How it works

**Send personalized emails from a Google Sheet** starts manually:

1. **Read the sheet**: Google Sheets reads `Contacts!A1:G101` with headers (up to 100 prospects).
2. **Draft each contact** (loop, max 100): compute the sheet row (index + 2), keep the row's `status` or default to `drafted`, ask AI for a `first_line` of at most 25 words (no greeting, flattery or exclamation marks), then upsert the contact matched on `email`.
3. **Wait for approval**: review the **Awaiting approval** view, edit lines or set contacts to `skipped`, then approve (3-day timeout).
4. **Build the send queue**: search up to 100 contacts with `status` = `drafted`.
5. **Send and log**: for each contact, Gmail sends "Quick question for {company}" with the first name, first line and your pitch; the record becomes `sent` with `sent_at`; the sheet row gets `sent` and the timestamp in F:G.

## Who it's for

- **Founders doing their own outbound** — send a reviewed batch from your real inbox without an outreach tool.
- **Sales and SDR teams** — test a new segment, with every opener checked first.
- **Growth and marketing teams** — run small batches and see results in the shared sheet.
- **RevOps** — one record of who was contacted and when.
- **Agencies** — clients read the drafted lines before the send.

## The problem

You have 60 prospects in a sheet, each with a note: a new warehouse, a hiring post. A mail merge swaps the first name and sends one body to all 60, and replies stay near zero. Writing 60 real openers eats the afternoon.

Outreach platforms charge per mailbox and keep your list. Afterwards the sheet is stale, and a teammate emails the same people next week.

## What it does

- **Object**: **Campaign contacts** in an **Outbound** database. Fields: `email` (unique, the record title), `first_name`, `company`, `role`, `notes`, `first_line` (the personalized opener), `sheet_row`, `status` (`drafted`, `sent`, `skipped`) and `sent_at`.
- **Saved views**: **Awaiting approval** (drafted, in sheet order) and **Sent** (newest first).
- **Workflow**: the manual workflow above.
- **Sample data**: four contacts covering all three statuses.

## Setup

1. Ask your AI agent to run `template.import`, or use **Import template** on the Databases page, to add the **Outbound** database.
2. In Google Sheets, create a tab named `Contacts` with these headers in row 1, columns A to G: `email`, `first_name`, `company`, `role`, `notes`, `status`, `sent_at`. Leave `status` empty.
3. Link the Google account you prospect from in **Settings › Connections**. One connection covers Gmail and Google Sheets.
4. In the **read** and **log** steps, replace `YOUR_SPREADSHEET_ID` with the id from your sheet URL (`docs.google.com/spreadsheets/d/<id>/edit`).
5. On the **personalize** step, choose your AI provider and model, and the secret that holds its API key. There is no default.
6. On the **email** step, replace `[your one-line value proposition]` and `[Your name]`
7. Delete the sample records, then test on a sheet holding only your address.
8. Activate the workflow and start a run on the real list.

## Customize it

- Change the batch size: lower `limit` on both loops and shorten the range (for example `Contacts!A1:G26`) to send 25 at a time.
- Add a Slack step after the **send** loop that posts how many emails went out.
- Add a `segment` column to the sheet and the object, then filter the **queue** step on it to send to one segment per run.
- Replace `text` with `html` on the **email** step to add a formatted signature.
- Add a **Skipped** view filtered on `status` = `skipped` to audit who was left out and why.

## FAQ

### How do I send personalized cold emails from Google Sheets with Gmail?

Put prospects in a `Contacts` tab, connect Google and start this workflow. After your approval, Gmail sends one email per contact and the sheet shows `sent` per row.

### Can AI write a different first line for each prospect?

Yes, from role, company and notes, up to 25 words. Quality depends on `notes`: "Opened a second warehouse in Lyon" beats an empty cell. Edit any line before approving.

### Does this template send follow-up emails or track replies?

No. Runbase cannot read your inbox, so it cannot see replies. For follow-ups, add the Gmail follow-up sequence template.

### How many cold emails can I send from Gmail per day?

Google sets limits per account type, and cold domains get flagged sooner. A run caps at 100 rows; start with 20 to 30 a day and respect opt-out rules.

### What happens if I run the campaign twice on the same sheet?

Rows marked `sent` are not emailed again, but their first line is rewritten, so move them to another tab. A contact skipped only in Runbase returns to `drafted` unless the sheet says `skipped`. Empty rows make the run fail.

## Related templates

- [Gmail follow-up sequence](https://getrunbase.com/templates/gmail-follow-up-sequence) — adds timed follow-ups after the first cold email.
- [Google Sheets CRM sync](https://getrunbase.com/templates/google-sheets-crm-sync) — keeps the prospects who reply in a real CRM synced with your sheet.
- [Lead capture to Sheets](https://getrunbase.com/templates/lead-capture-to-sheets) — fills the same kind of sheet with inbound leads from a form.
