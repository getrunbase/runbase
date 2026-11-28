Every Monday at 9am, your weekly KPI report lands in Slack and in the founder's and RevOps' inboxes via Gmail: new pipeline, won revenue, win rate and open pipeline versus last week, plus a short AI commentary. Each week also becomes a new row in a Google Sheet.

It replaces the Monday ritual of exporting the CRM and fixing spreadsheet formulas.

## Key benefits

- **Monday morning back**: the report is computed and sent before your stand-up, with no export.
- **Week-over-week deltas**: new pipeline and won revenue show their change versus last week, so a slowdown shows on day one.
- **A history with no gaps**: one snapshot per week in Runbase and one row in your `KPI history` tab, ready to chart.
- **Commentary tied to the numbers**: the AI only sees this week's and last week's figures.

## How it works

The **Send the weekly KPI report** workflow runs on a schedule:

1. **Trigger**: every Monday at 9:00, Europe/Paris time (cron `0 9 * * 1`).
2. **Period**: a date step goes back 7 days and formats that date as `YYYY-MM-DD` to label the week.
3. **Load deals**: it reads up to 500 **Deals** records, and continues if none exist.
4. **Compute KPIs**: `compute-weekly-kpis` counts deals by `opened_on` and won or lost deals by `closed_on` in the window, plus every open deal. It repeats this for the prior 7 days to get deltas, in EUR.
5. **AI commentary**: your AI provider writes under 70 words on the biggest move and one thing to watch.
6. **Snapshot**: it upserts a **KPI snapshots** record matched on `week`.
7. **Google Sheets**: it appends a row to the `KPI history` tab of `KPI_SPREADSHEET_ID`.
8. **Slack**: it posts the report via the webhook in `SLACK_WEBHOOK_URL`.
9. **Gmail**: it emails `founder@yourcompany.com` and `revops@yourcompany.com` from your Google account.

## Who it's for

- **Founders** — read the pipeline and revenue pulse in Slack without asking anyone for a number.
- **RevOps leads** — no more rebuilding the Monday report.
- **Sales managers** — the week's win rate before the pipeline review.
- **Finance** — won revenue and average deal size per week, in a sheet.

## The problem

Monday, 8:40. The RevOps lead exports deals, pastes them into last week's spreadsheet, fixes a date filter still set to October and computes the win rate by hand. The founder has asked twice before the Slack message goes out. The week this person is on holiday, there is no report.

Three months later, someone asks whether the win rate is rising. Half the weeks are missing, the rest used slightly different rules. A CRM dashboard shows today's numbers, but pushes them to no one and freezes no weekly snapshot.

## What it does

The template creates a **Revenue** database with two objects:

- **Deals**: name, company, owner, amount, stage (lead, qualified, proposal, negotiation, won, lost), source (inbound, outbound, referral, partner, expansion), opened on, closed on and lost reason.
- **KPI snapshots**: one record per week, keyed on a unique `week` ("Week of"), with new deals, new pipeline, open deals, open pipeline, won deals, won revenue, lost deals, win rate %, average won deal, commentary and sent at.

Three saved views come with it: **Open pipeline** (deals not won or lost, largest first), **Closed this month** (won or lost deals closed in the last 30 days, with lost reason) and **KPI history** (snapshots, latest week first).

Sample data: five deals at different stages, such as Northwind (won, 18,000) and Fieldworks (lost), and one snapshot for the week of 2026-11-16.

## Setup

1. Import the template; it sets up the **Revenue** database and its workflows in one step.
2. Connect your Google account (connection `google`), used for Sheets and Gmail.
3. Create a Google Sheet with a tab named `KPI history`. Put these headers in row 1: `Week`, `New deals`, `New pipeline`, `Open deals`, `Open pipeline`, `Won deals`, `Won revenue`, `Lost deals`, `Win rate %`, `Avg deal size`.
4. Set the secret `KPI_SPREADSHEET_ID` to the ID in the sheet URL.
5. Set a Slack Incoming Webhook URL as the secret `SLACK_WEBHOOK_URL`.
6. Replace the two `to` addresses in the Gmail step. Pick your AI provider; Runbase has no default.
7. Do a test run and check Slack, the email and the sheet.
8. Activate the workflow.

## Customize it

- Change the cron to `0 8 * * 5` to send a Friday wrap-up instead of a Monday report.
- Set `currency` in the compute step to `USD` or `GBP` to match your books.
- Add a `deals` filter on `owner` and duplicate the workflow to send each rep their own numbers.
- Add a Slack step that only runs when `win_rate` is below 25, to flag a bad week in a separate channel.
- Add a **Deals** view filtered on `source` to see which channel feeds the pipeline.

## FAQ

### How do I automate a weekly KPI report in Google Sheets?

Import this template, set `KPI_SPREADSHEET_ID` and activate it. Each Monday adds one row. Rows are only appended: a second run in the same week updates the Runbase snapshot but adds a duplicate row to the sheet.

### Can I send a weekly sales report by email automatically from Gmail?

Yes, as plain text to the recipients you list. It uses only the `gmail.send` scope, so Runbase can send but cannot read your inbox.

### Where do the deal numbers come from?

From the **Deals** object in Runbase: typed in, imported from CSV or synced by another workflow. Only 500 deals are read, so raise the limit for a larger pipeline.

### Will the AI commentary make up figures?

It only sees the KPIs and is told never to invent numbers, but it is still generated text. The report figures themselves come from the function, not the AI.

## Related templates

- [Google Sheets CRM Sync](https://getrunbase.com/templates/google-sheets-crm-sync) — sync the deals behind this report with a shared sheet.
- [Slack Lead Alert](https://getrunbase.com/templates/slack-lead-alert) — new leads in Slack as they arrive.
- [CRM Light](https://getrunbase.com/templates/crm-light) — a simple pipeline for the deals this report measures.
