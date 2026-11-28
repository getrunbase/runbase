# Google Sheets automations with Runbase

Half of every company runs on a spreadsheet someone set up years ago: the sales tracker, the stock list, the prospect list a founder keeps adding to. Runbase works with that sheet instead of asking people to abandon it. It reads the rows your team types, cleans them into a real database, and writes results back. Statuses, totals and logs show up in the cells people already look at.

The sheet stays the place people work, and Runbase adds the rules a spreadsheet cannot enforce: deduplication, typed fields, alerts and history.

## What you can automate

- **Turn a sheet into a source of truth**: import rows on a schedule and match them to clean records, without duplicates.
- **Log every event as a row**: new leads, signups, survey answers and expense claims each add a line to a shared sheet.
- **Write status back where people see it**: mark a row as sent, synced or paid, with a timestamp.
- **Build weekly reports without formulas**: append one row of KPIs per week and let charts draw the trend.
- **Watch numbers and act**: read stock levels or prospect lists every hour and trigger the next step.

## Use cases by team

**Sales and RevOps.** Keep reps in their shared sheet while the pipeline gets structure with [Google Sheets CRM Sync](https://getrunbase.com/templates/google-sheets-crm-sync). Send a reviewed outbound batch from a prospect list with [Cold Email Campaign from Google Sheets](https://getrunbase.com/templates/cold-email-from-sheet). Total demos per rep each Monday with [Sales Meeting Tracker](https://getrunbase.com/templates/meeting-booked-tracker). Pay partners from a monthly statement with [Partner Referral Tracker](https://getrunbase.com/templates/partner-referral-tracker).

**Marketing.** Save every form submission as a row with [Lead Capture to Google Sheets](https://getrunbase.com/templates/lead-capture-to-sheets). Give your team a live subscriber list with [Newsletter Signups with Welcome Email](https://getrunbase.com/templates/newsletter-signup). Share the attendee list of a webinar with [Event Registration Manager](https://getrunbase.com/templates/event-registration-manager).

**Customer success.** Log every NPS answer with its sentiment and theme with [NPS Survey and Feedback Loop](https://getrunbase.com/templates/customer-feedback-nps).

**Finance.** Refresh an aging table of overdue invoices with [Invoice Payment Reminders](https://getrunbase.com/templates/invoice-payment-reminders). Keep a ledger of issued invoices with [Invoice Archive to Google Drive](https://getrunbase.com/templates/invoice-archive-drive). Record every approved claim with [Expense Approval](https://getrunbase.com/templates/expense-approval).

**Operations and leadership.** Watch a stock tab and reorder when items run low with [Low Stock Alert](https://getrunbase.com/templates/inventory-low-stock-alert). Add one row of pipeline and revenue figures each week with [Weekly KPI Report](https://getrunbase.com/templates/weekly-kpi-report).

**HR.** Pull applications from a Google Form response sheet into a tracker with [Applicant Tracking from Google Sheets](https://getrunbase.com/templates/applicant-tracker).

## Triggers and actions

A Sheets step runs inside a workflow that starts from a schedule, a record change, a webhook or a manual run. To pick up new rows, a schedule such as every 15 minutes reads the sheet and matches rows on a unique field, so the same row is never imported twice.

**Read rows.** Reads a tab or a range, such as `Sheet1` or `Deals!A1:K1000`. With headers on, the first row gives the column names, and each row comes back as an object such as `{ "Email": "...", "Stage": "..." }`. Later steps can loop over the rows, clean them with a function and upsert them into a Runbase table.

**Add rows.** Adds rows after the last filled row of a tab. Send rows as objects and Runbase matches each key to the column with the same name in the header row. Column order does not matter, and extra columns stay empty. Send rows as plain lists to write values in order.

**Update cells.** Overwrites a range, such as `Deals!J2:K2`, with the values you give. Values are entered as if typed in the sheet, so a formula stays a formula and a date stays a date. Use it to write a Runbase ID, a sync status or a "sent" timestamp next to the row it describes.

Step fields help you pick the sheet: choose a spreadsheet in the Google Drive picker, then select the tab and columns from dropdowns filled from the sheet itself.

## Connect your Google Sheets account

Google Sheets uses the shared Google connection, so one sign-in also covers Gmail, Google Calendar and Google Drive.

1. Add a Google Sheets step, or open **Connections**.
2. Choose **Connect Google** and sign in with an account that can edit the spreadsheet.
3. Check the permissions Google lists, then accept.

Runbase requests `spreadsheets`, to read and write the cells of sheets your account can access, and `drive.file`, to open the files you choose with **Choose in Drive**. It cannot delete spreadsheets or change their sharing. Runbase keeps the tokens encrypted and renews them when they expire.

You can disconnect anytime, from Runbase or from your Google account. The sheet and all its data stay exactly as they are.

## FAQ

**Do I have to move my team off the spreadsheet?**
No. People keep typing in the sheet. Runbase reads it on a schedule and writes results back next to their rows.

**How are duplicates avoided?**
Each import matches rows on a unique field, such as email or domain, and updates the existing record instead of creating a new one.

**Will my formulas and formatting survive?**
Yes. Updates only touch the range you name, and values are entered as typed, so formulas and dates stay intact.

**What if someone renames a column?**
Add rows by column name, so a renamed header leaves that column empty. Rename it in the step too.

**How large can a sheet be?**
Read only the range you need, such as `A1:K1000`, to keep runs fast. Google's API limits apply.

**Is there a self-hosted option?**
Yes. Runbase is open source, and you can run it on your own servers with your own Google credentials.

## Popular templates

- [Google Sheets CRM Sync](https://getrunbase.com/templates/google-sheets-crm-sync)
- [Lead Capture to Google Sheets](https://getrunbase.com/templates/lead-capture-to-sheets)
- [Cold Email Campaign from Google Sheets](https://getrunbase.com/templates/cold-email-from-sheet)
- [Weekly KPI Report](https://getrunbase.com/templates/weekly-kpi-report)
- [Low Stock Alert](https://getrunbase.com/templates/inventory-low-stock-alert)
- [NPS Survey and Feedback Loop](https://getrunbase.com/templates/customer-feedback-nps)
