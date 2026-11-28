Contract renewal reminders that run on their own: every contract you add gets its end date on Google Calendar, the account owner gets a Slack alert, and the customer gets a check-in email from Gmail 90, 60 and 30 days before the contract ends.

No more finding out a contract lapsed when the customer's finance team sends a cancellation notice.

## Key benefits

- **Three touchpoints per renewal** — 90, 60 and 30 days leave time for a review call, a quote and a signature.
- **No duplicate emails** — each contract stores the last milestone it was reminded at, so nobody gets the same email twice, even after a missed run.
- **Owner-level visibility** — the Slack alert shows account, value, end date and owner, and flags contracts that do not auto-renew.
- **A calendar you don't maintain** — the renewal shows up as an all-day event on the owner's Google Calendar the moment the contract is created.

## How it works

The template runs two workflows.

**Add renewal date to Google Calendar** (trigger: a record is created in Contracts)

1. The `build-renewal-event` function builds an all-day event on `end_date` with the account, annual value, owner and auto-renew status.
2. A condition stops the run when the contract has no `end_date`.
3. Google Calendar creates the event on your primary calendar and invites `owner_email`, with no update emails.
4. The event id is saved to `calendar_event_id` on the contract.

**Send 90/60/30-day renewal reminders** (trigger: schedule, 8:00 Monday to Friday, Europe/Paris)

1. Search Contracts with `status` active or renewal_in_progress (500 max).
2. The `plan-renewal-reminders` function keeps contracts whose end date is 90, 60 or 30 days away or less, picks the smallest milestone reached, and skips any contract whose `last_reminder_stage` already covers it.
3. For each reminder (up to 100), Slack posts the alert through `SLACK_WEBHOOK_URL`, then the contract gets `last_reminder_stage` and `last_reminder_at` updated.
4. For each contract with a `customer_email` and `email_customer` on, Gmail sends the check-in. The 90 and 60-day emails ask for a 20-minute review call; the 30-day email asks who signs the renewal.

## Who it's for

- **Customer success managers** — a reminder in Slack at each milestone, with the customer email already sent in their name.
- **RevOps** — one table of every contract by end date and status, instead of dates buried in PDFs and a forgotten spreadsheet column.

## The problem

A 64,000 USD enterprise contract ends on December 31. The end date sits in a PDF and a spreadsheet nobody updated after the spring owner change. Nobody looks until mid-December, when the customer's procurement team says the budget for next year is already closed.

Manual calendar reminders do not survive an owner change, and customer success suites cost more than many small teams spend protecting those contracts.

## What it does

The template creates a **Renewals** database with two objects:

- **Accounts**: name, a unique domain, segment (smb, mid_market, enterprise), health (healthy, at_risk, churn_risk) and notes.
- **Contracts**: contract name, a link to the account, account name, plan, annual value, currency, start and end dates, auto-renew, status (active, renewal_in_progress, renewed, churned), owner name, email and Slack mention, customer first name and email, an **Email the customer** switch, last reminder stage and date, and the calendar event id.

Five saved views come with it: **Renewing soon** (active and in-progress contracts, soonest end date first), **Renewal in progress**, **Renewed**, **Churned**, and **At risk** for accounts flagged at_risk or churn_risk.

Sample data includes two accounts (Northwind Studio, Lumen Labs) and three contracts, one with customer emails turned off.

## Setup

1. Import the template to create the **Renewals** database (Databases page › **Import template**, or the MCP tool `template.import`).
2. Link your customer success Google account in **Settings › Connections**. Gmail and Google Calendar both use it, and emails leave from that address.
3. In Slack, create an Incoming Webhook for your customer success channel. In **Settings › Secrets**, add `SLACK_WEBHOOK_URL` with its URL.
4. Open **Send 90/60/30-day renewal reminders** and replace `Your name, Your company` with your signature (used when a contract has no owner name).
5. Run a test of the reminder workflow on the sample contracts and check the Slack message and the email.
6. Activate both workflows, then delete the sample records and add your contracts by hand or from a CSV.

## Customize it

- Change the `STAGES` list in `plan-renewal-reminders` to `[120, 60, 14]` to match a longer procurement cycle.
- Fill **Owner Slack mention** with a user id such as `<@U012ABCDEF>` so the owner is pinged directly.
- Add a condition before the Gmail step that skips accounts with health set to churn_risk, so those get a call first.
- Add a view of contracts with auto-renew off, sorted by end date.

## FAQ

### How do I set up automatic contract renewal reminders?

Import this template, connect Google, add the Slack webhook and activate both workflows. Every weekday at 8:00 Runbase checks each open contract against the milestones and sends what is due.

### Can I send renewal reminder emails from Gmail automatically?

Yes. The Gmail step sends from the connected Google account, signed with the contract owner's name. Runbase does not read your inbox, so a customer reply does not change the contract status: update it to renewed or churned yourself, and the reminders stop once it leaves active and renewal_in_progress.

### Does it update the Google Calendar event if the end date changes?

No. The calendar workflow only runs when a contract is created. If you extend a contract, create a new contract for the new term or move the event by hand.

### What happens if a contract is added with less than 30 days left?

The next run sends the 30-day reminder right away, because the function picks the smallest milestone already reached.

## Related templates

- [Invoice Payment Reminders](https://getrunbase.com/templates/invoice-payment-reminders) — the same milestone logic for the invoices the renewal produces.
- [Customer Feedback NPS](https://getrunbase.com/templates/customer-feedback-nps) — know which accounts are at risk before the 90-day call.
- [Quote Approval](https://getrunbase.com/templates/quote-approval) — get the renewal quote signed off internally before it goes to the customer.
