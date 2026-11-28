Your reps keep typing deals into the shared Google Sheet, and every 15 minutes Runbase turns those rows into a clean Google Sheets CRM: deduplicated companies, contacts and deals, with a Runbase ID and synced stage written back into the sheet and each new deal posted to Slack.

No migration and no per-seat licence: the spreadsheet stays where people work, Runbase adds the structure a pivot table cannot.

## Key benefits

- **A pipeline total you can trust**: "$8,400" becomes a number and odd stage labels fall back to `lead`.
- **No duplicate accounts**: companies match on domain and contacts on email, so a second row for Maria stays one record.
- **Sync status inside the sheet**: columns J and K show the Runbase ID and recorded stage of each row.
- **New deals surface on their own**: Slack gets title, amount, stage and owner when a row first reaches the CRM.

## How it works

Workflow 1, **Sync the sales sheet every 15 minutes** (schedule `*/15 * * * *`):

1. **Google Sheets, Read rows** reads `Deals!A1:K1000` from the spreadsheet in `CRM_SHEET_ID`, using row 1 as headers.
2. **Function `clean-sheet-rows`** lowercases `Email`, strips currency signs from `Amount`, maps unknown `Stage` values to `lead`, keeps `Close date` only as `YYYY-MM-DD`, and fills `Company` and `Domain` from the email when empty. Rows without a `Deal` name or an email containing "@" are skipped.
3. **Loop over clean rows** (up to 1,000), three upserts per row:
   - the company, matched on `domain`;
   - the contact, matched on `email` and linked to the company;
   - the deal, matched on a key built from email and deal name, with both links.
4. **Function `sheet-writeback-values`** builds a Runbase ID and synced stage per sheet line; skipped lines keep their cells.
5. **Google Sheets, Update cells** writes those pairs into `Deals!J2:K`.

Workflow 2, **Announce new deals in Slack** (trigger: deal record created):

1. **Slack, Send message** posts to `SLACK_WEBHOOK_URL`: "New deal from the sales sheet: title (amount), stage, owner".

## Who it's for

- **RevOps** — get a typed pipeline with saved views and reliable totals while the sales team keeps its spreadsheet.
- **Sales leads and founders** — see open deals by amount and upcoming closes by date, without chasing reps.
- **Growth and ops teams** — reuse deduplicated companies and contacts in other workflows.
- **Account executives** — keep editing the row you know; the CRM follows.

## The problem

Picture ten reps sharing one "Deals" tab. Sam writes "Proposal", Lea writes "sent prop", someone pastes "€2.5k" into Amount, and Globex appears twice. The Monday pipeline number is a guess, and new deals go unnoticed until someone scrolls down.

A hosted CRM would fix the data, at the cost of a migration, a per-seat bill and a team that keeps a sheet on the side anyway.

## What it does

The import creates a **CRM** database with three linked objects:

- **Companies**: name, domain (unique).
- **Contacts**: name, email (unique), company.
- **Deals**: title, amount, stage (lead, qualified, proposal, won, lost), close date, owner, company, contact, sheet row.

Three saved views on Deals:

- **Open pipeline**: every stage except won and lost, largest amount first.
- **Upcoming closes**: qualified and proposal deals that have a close date, soonest first.
- **Won deals**: stage won, most recent close date first.

Two functions (`clean-sheet-rows`, `sheet-writeback-values`) and the two workflows described above. Sample data: Northwind and Globex, contacts Maria Chen and Tom Okafor, and two deals.

The sheet is the source of truth: Runbase edits to a synced deal are overwritten on the next run.

## Setup

1. Install the template from the Databases page (**Import template**) to get the **CRM** database.
2. Prepare the sheet: a tab named **Deals** with headers in row 1: `Deal`, `Company`, `Domain`, `Contact`, `Email`, `Amount`, `Stage`, `Close date`, `Owner`, then `Runbase ID` in column J and `Synced stage` in column K.
3. Connect your Google account under Connections so the Google Sheets steps can read and write the file.
4. Set the secret `CRM_SHEET_ID` to the ID in the sheet URL, after `/d/`.
5. For sync alerts, add a Slack incoming webhook for your sales channel as the secret `SLACK_WEBHOOK_URL`.
6. Run **Sync the sales sheet every 15 minutes** once as a test, then check the Deals table and columns J and K in the sheet.
7. Activate both workflows. The first sync posts one Slack message per existing row.

## Customize it

- Change the cron to `0 * * * *` for an hourly sync.
- Add a condition before the Slack step so only deals above 5,000 are announced.
- Add a `source` field to Deals and map a new sheet column to it in `clean-sheet-rows`.

## FAQ

### Can I use Google Sheets as a CRM?

Yes for data entry, and this template adds what a sheet cannot do alone: unique companies and contacts, typed amounts and dates, linked records and saved views. Build reports and automations on the Runbase copy, not the raw tab.

### Does editing a deal in Runbase update the Google Sheet?

No, only the Runbase ID and Synced stage columns are written back. An amount or owner changed in Runbase is replaced by the sheet value on the next sync.

### How do I stop duplicate contacts when syncing a spreadsheet to a CRM?

Contacts are matched on email and companies on domain, so the same person on several rows stays one record. Deals are keyed on email plus deal name, so renaming a deal in the sheet creates a new one. Rows without a valid email are skipped.

### Do deleted rows get removed from the CRM?

No. The sync only creates and updates records, so a deleted row leaves its deal in Runbase. Mark the row as lost instead.

## Related templates

- [Slack lead alert](https://getrunbase.com/templates/slack-lead-alert) — ping Slack the moment a lead arrives, before it reaches the pipeline.
- [Lead capture to Sheets](https://getrunbase.com/templates/lead-capture-to-sheets) — feed form leads into the same sheet this sync reads.
- [Weekly KPI report](https://getrunbase.com/templates/weekly-kpi-report) — send a weekly digest of the clean pipeline numbers.
