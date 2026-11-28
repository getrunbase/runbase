Every referral a partner sends through your form lands in one Partners database, linked to the right partner by code, announced to sales in Slack and answered with a thank-you from Gmail. On the 1st of each month, commissions are added up, appended to a Google Sheet and sent to each partner as a statement email.

It replaces partner referral tracking in a spreadsheet, where leads are pasted in by hand and commission totals are rebuilt every month.

## Key benefits

- **Warm intros reach sales in minutes**: the Slack alert fires as soon as the form is submitted, with the lead, company and the partner's note.
- **No more lost codes**: a referral with a mistyped or unknown code is still saved, flagged in Slack and listed in the Unmatched referrals view.
- **Month-end close in zero clicks**: won deals are multiplied by each partner's rate and the rows appear in your Commissions tab before 8:05am.
- **Partners keep sending leads**: each one gets a thank-you on the day and a statement listing every won deal.

## How it works

**Capture partner referrals** (webhook `partner-referral`)

1. Your form posts `email`, `name`, `company`, `partner_code` and `message`. The referral is created or updated, matched on `lead_email`, so a lead submitted twice stays one record.
2. **Find partner**: searches Partners where `code` equals the referral's `partner_code`.
3. If a partner is found: the referral's `partner` field is linked, Slack gets "New partner referral from …", then Gmail sends the partner contact "Thanks for introducing {company}".
4. If no partner matches: Slack gets "Referral with an unknown code …" pointing to the Unmatched referrals view.

**Send monthly commission statements** (schedule `0 8 1 * *`, Europe/Paris)

1. Loads partners with status `active` or `paused` (up to 500).
2. Loads referrals with status `won` and `won_on` in the last 62 days.
3. The `compute-partner-commissions` function keeps deals won last calendar month, sums `deal_value` per partner and applies `commission_rate`, in EUR.
4. Google Sheets appends one row per partner to the `Commissions` range: Month, Partner, Code, Won referrals, Revenue, Rate %, Commission, Currency. A "none" row is written when nothing was won.
5. Gmail sends each partner with an email their statement (up to 200 per run).
6. Slack receives the summary: partners paid, won referrals, total to pay, statements sent.

## Who it's for

- **Partnerships managers** — see every introduction per partner without chasing them for updates.
- **RevOps** — get commission figures in a sheet finance can audit, computed from won dates, not memory.
- **Growth and marketing teams running affiliates** — know which newsletter or agency actually brings revenue.
- **Sales teams** — get referred leads in Slack while the intro is fresh.

## The problem

Your agency partner fills in the referral form on Tuesday. Someone copies it into the "Referrals" tab on Thursday, after the lead has booked a competitor. The partner never hears back.

On the 1st, someone matches closed deals to codes, applies rates from another tab and writes ten near-identical statements. One typo in a code and a partner is underpaid without anyone noticing.

## What it does

- **Partners** object: name, unique referral code, contact name, email, type (agency, affiliate, reseller, customer, integration), commission %, status (active, paused, ended), joined on.
- **Referrals** object: lead, unique lead email, company, referral code, partner (link), status (new, qualified, won, lost; default new), deal value, won on, notes.
- **Saved views**: New referrals, Open referrals (by deal value), Won last 30 days, Unmatched referrals, Active partners.
- **Workflows**: Capture partner referrals and Send monthly commission statements, described above.
- **Sample data**: two partners (Lumen Agency at 15%, Stackwise Newsletter at 20%) and three referrals: one won at 12,000, one qualified, one new.

## Setup

1. Add the **Partners** database to your workspace with **Import template** on the Databases page.
2. Create the `google` connection; partner emails go out through Gmail and referrals sync to Google Sheets.
3. Create a spreadsheet with a tab named `Commissions` and set its ID as the `COMMISSIONS_SPREADSHEET_ID` secret.
4. Point a Slack incoming webhook at the channel that handles partner deals and store it as `SLACK_WEBHOOK_URL`.
5. Create the `partner-referral` webhook and point your referral form at its URL with the fields `email`, `name`, `company`, `partner_code` and `message`.
6. Send a test submission with a known code, then one with an unknown code, and check both Slack messages.
7. Run the monthly workflow manually once, check the sheet and statements, then activate both workflows.

## Customize it

- Change the currency from `EUR` or the sender name in the `compute` step input.
- Move the run to another day or timezone by editing the cron `0 8 1 * *`.
- Add a tiered rate inside the commission function.
- Add a Gmail step to the unmatched branch that asks the lead which partner referred them.

## FAQ

### How do I track partner referrals without a partner platform?

Give each partner a code, put a `partner_code` field on your form and send it to this template's webhook. Every referral is stored with its partner link and status. You move it to won and set `won_on` when the deal closes; Runbase does not read your CRM on its own.

### Can I send automatic commission statements to affiliates from Gmail?

Yes. On the 1st of each month, every partner with an email and at least one deal won last month gets a statement from your connected Gmail account. Partners with no won deals are skipped.

### What happens if a lead uses the wrong referral code?

The referral is still saved, Slack posts an alert with the code it received and the lead shows up in Unmatched referrals. Link the partner before the next monthly run and the commission is counted.

### Does it pay partners automatically?

No. It computes the amount and writes it to Google Sheets, but no money moves. Finance pays from the sheet with your usual bank or payout tool.

## Related templates

- [Google Sheets CRM sync](https://getrunbase.com/templates/google-sheets-crm-sync) — keep referred deals mirrored in the sheet your sales team already uses.
- [Slack lead alert](https://getrunbase.com/templates/slack-lead-alert) — the same instant Slack ping for leads that come from your own site.
- [Renewal reminders](https://getrunbase.com/templates/renewal-reminders) — follow up when referred customers come up for renewal.
