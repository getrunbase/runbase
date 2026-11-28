Every weekday at 9:00, each unpaid invoice past its due date gets the right reminder from your own Gmail, in the same thread as the last one. The overdue total, split by age, lands in Slack, and an aging table refreshes in Google Sheets. These are automatic invoice payment reminders that escalate from polite to final on their own.

No more scrolling a spreadsheet to work out who owes what and who you already chased.

## Key benefits

- **No awkward chasing**: the reminder at day 1, 7, 14 and 30 goes out without anyone having to write "just following up" again.
- **No double reminders**: the `reminders_count` field records which stage each invoice reached, so a client never gets the same stage twice.
- **One thread per invoice**: later emails reply in the Gmail thread of the first one, so the client sees the whole history in one place.
- **Cash at risk in plain sight**: finance reads the overdue total and the 1-30, 31-60, 61-90 and 90+ day buckets in Slack every morning.

## How it works

The workflow **Chase overdue invoices every morning** runs on a schedule (`0 9 * * 1-5`, Europe/Paris timezone):

1. **Search**: finds up to 500 invoices whose `status` is `sent` or `overdue` and whose `due_date` is before now. If none match, the run stops there.
2. **Plan**: the `plan-invoice-reminders` function computes days late for each invoice with a `due_date` and a `client_email`. Stages are 1 day (polite), 7 days (friendly), 14 days (firm) and 30 days (final). An email is planned only when the invoice reached a stage higher than its `reminders_count`.
3. **Send, for each reminder (up to 100)**: Gmail sends the email from your connected account to `client_email`, replying in `thread_id` when it is set. The invoice is then updated: `status` becomes `overdue`, `reminders_count` takes the stage number, `last_reminder_at` is set to now and `thread_id` stores the Gmail thread.
4. **Slack summary**: posts the overdue count, total, age buckets and the number of reminders sent today to the incoming webhook in `SLACK_WEBHOOK_URL`.
5. **Aging sheet**: overwrites the `Aging` tab of your Google Sheet from cell A1 with one row per overdue invoice (invoice, client, amount, due date, days late, reminders sent).

## Who it's for

- **Agency and studio owners**: get paid on time without souring client relationships.
- **Finance and ops leads**: see the receivables aging every morning without building a report.
- **Freelancers and consultants**: let a calm, consistent sequence do the follow-up while you do billable work.

## The problem

Invoice INV-2026-047 was due on 20 November. The usual chaser was out, and the billing tool's no-reply reminders went to the client's spam. By then it is 30 days late, the tone has to jump straight to "final notice", and the relationship takes the hit.

Chasing by hand works for three invoices, not thirty: you lose track of who got which email, and nobody knows how much cash is stuck past 60 days.

## What it does

The template creates a **Finance** database with one **Invoices** object. Key fields: `number` (unique, the title), `client_name`, `contact_first_name`, `client_email`, `amount`, `issue_date`, `due_date`, `status` (draft, sent, overdue, paid, disputed, written_off), `payment_link`, `reminders_count`, `last_reminder_at`, `thread_id` and `notes`.

Four saved views come with it: **Overdue** (oldest due date first), **Awaiting payment** (sent or overdue), **Disputed** and **Paid**.

The `plan-invoice-reminders` function holds the stages, the four email texts and the Slack and sheet output. Paid, disputed and written-off invoices are never searched, so they are never chased.

Five sample invoices cover each case: two overdue, one not yet due, one paid, one disputed.

## Setup

1. Import the template to set up the **Finance** database with its invoice ledger and reminder workflow.
2. In **Settings › Connections**, connect the Google account you invoice from. It is used for Gmail and Google Sheets.
3. Create a Slack Incoming Webhook for your finance channel and save it in **Settings › Secrets** as `SLACK_WEBHOOK_URL`.
4. Create a Google Sheet with a tab named `Aging` and replace `YOUR_SPREADSHEET_ID` in the workflow with its id.
5. In the `plan` step, set `senderName` and `currency`. Adjust the timezone and review the email texts.
6. Delete the sample invoices, import your open invoices from CSV, and run the workflow once in test mode to check the planned emails.
7. Activate the workflow.

## Customize it

- Change the `STAGES` array in the function to remind at 3, 10 and 21 days instead.
- Add a step after the final notice that creates a task or alerts the account owner in Slack.
- Add a `currency` field on invoices and pass it per invoice for multi-currency billing.

## FAQ

### How do I send automatic invoice payment reminders from Gmail?

Connect your Google account, import your open invoices with a billing email and due date, and activate the workflow. Each weekday it sends the next due reminder from your own Gmail address.

### Does it stop reminding when the client pays?

Only once the invoice status is `paid` (or `disputed` or `written_off`). Runbase does not read your bank account or your inbox, so it cannot detect a payment or a reply by itself. Update the status by hand, by CSV import from your billing export, or by asking your AI agent.

### Can payment reminders reply in the same email thread?

Yes. The first reminder stores its Gmail thread id on the invoice, and later reminders reply in that thread.

### What if an invoice is several weeks late when I import it?

The function sends only the highest stage reached, once. An invoice 20 days late with no reminder gets the firm email, not three emails in a row.

## Related templates

- [Invoice Archive to Drive](https://getrunbase.com/templates/invoice-archive-drive) — file every invoice PDF in Google Drive before you start chasing it.
- [Renewal Reminders](https://getrunbase.com/templates/renewal-reminders) — the same escalating emails for contracts about to expire.
- [Weekly KPI Report](https://getrunbase.com/templates/weekly-kpi-report) — add overdue receivables to the numbers your team reviews each week.
