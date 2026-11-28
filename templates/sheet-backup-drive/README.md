An automatic backup to Google Drive at 02:00 UTC: your Customers and Orders tables become two dated CSV files. Each run logs row counts and Drive links, and Slack pings your channel when a run fails.

It replaces the Friday "export to CSV" chore, and the backup add-on billed per gigabyte for a file in a folder.

## Key benefits

- **No more Friday exports**: the backup runs on schedule, so nobody has to remember to click Export.
- **Silent failures get caught**: a second workflow posts any failed run's error in Slack, so nobody finds out the day they need the file.
- **Proof for auditors**: Backup history lists each night with row counts and links to both Drive files.

## How it works

Workflow 1, **Back up key objects to Google Drive every night**:

1. **Trigger**: schedule, cron `0 2 * * *`, timezone UTC.
2. **Search customers**: reads up to 500 Customers records; an empty table does not stop the run.
3. **Search orders**: reads up to 500 Orders records, same rule.
4. **Build CSV files**: the `records-to-csv` function turns both lists into CSV (`id`, `updated_at`, then every data field) and returns `customersCsv`, `customersCount`, `ordersCsv` and `ordersCount`.
5. **Upload customers**: Google Drive uploads `customers-{{today}}.csv` (`text/csv`) to the folder set in `BACKUP_DRIVE_FOLDER_ID`.
6. **Upload orders**: Google Drive uploads `orders-{{today}}.csv` to the same folder.
7. **Log the backup**: creates a Backups record labelled "Nightly backup {{today}}" with `backup_date`, `customers_rows`, `orders_rows`, `customers_file` and `orders_file` (the Drive `webViewLink` of each upload) and `status` = `succeeded`.

Workflow 2, **Alert Slack when the nightly backup fails**:

1. **Trigger**: a failed run of the nightly backup workflow.
2. **Alert**: posts the workflow name, run id and error to `SLACK_WEBHOOK_URL`.
3. **Log the failure**: creates a Backups record labelled "Failed backup {{today}}" with `status` = `failed` and the `error` text.

## Who it's for

- **Ops managers** — an off-site copy of customer and order data exists every morning, without a recurring task on anyone's list.
- **RevOps leads** — a dated MRR and plan snapshot sits in Drive, ready to compare month over month in Sheets.
- **Finance teams** — daily order files are already in Drive for the accountant.
- **Founders facing a security questionnaire** — the backup question gets an answer and a log.

## The problem

A teammate bulk-updates the Orders table and sets fifty orders to `refunded` by mistake. Nobody can say what the table looked like yesterday: the last manual export is three weeks old, in someone's Downloads folder.

The quieter failure: a homemade script stops after a token expires and nobody hears about it for a month. A backup counts only if you can see it ran last night.

## What it does

The template creates an **Operations** database with three objects:

- **Customers**: name, billing email (unique), plan (`starter`, `team`, `enterprise`), status (`active`, `paused`, `churned`), MRR and customer since.
- **Orders**: reference (unique), customer (link to Customers), amount, status (`pending`, `paid`, `refunded`) and ordered on.
- **Backups**: backup label, date, customer rows, order rows, customers file and orders file (URLs), status (`succeeded`, `failed`) and error.

Saved views: **Backup history** (newest first, with counts and file links), **Failed backups** (status = failed, with the error), **Active customers** (sorted by MRR) and **Recent orders** (by order date).

Sample data: two customers (Acme Logistics, Lumen Studio), two orders (ORD-1042, ORD-1043) and one succeeded backup dated 2026-11-27.

## Setup

1. From the Databases page, click **Import template**; your **Operations** database appears with its views and workflows.
2. Connect your Google account in Connections. The Drive connector uses the `drive.file` scope, so Runbase only sees files it creates.
3. Copy your Drive folder id (after `/folders/` in its URL) into the secret `BACKUP_DRIVE_FOLDER_ID`.
4. Create a Slack incoming webhook for your ops channel and save its URL as the secret `SLACK_WEBHOOK_URL`.
5. Start a test run of the nightly workflow and check for two CSV files and a new Backup history row.
6. Activate both workflows. The first scheduled backup runs at 02:00 UTC.

## Customize it

- Change the cron to `0 */6 * * *` for a backup every six hours, or set your own timezone.
- Raise the `limit` on both search steps if a table grows past 500 records.
- Add a third search step and a third upload, for example a Deals or Invoices object, and pass it to the function.
- Add a Slack step after the log to post a nightly "backup OK" message with `total` rows.

## FAQ

### How do I set up an automatic backup to Google Drive every night?

Import this template, connect Google, set `BACKUP_DRIVE_FOLDER_ID` and activate the nightly workflow. It runs at 02:00 UTC and writes two new dated files each night.

### Does it back up every record in my tables?

No: each search step reads up to 500 records per object. Raise the `limit` if a table is bigger. The row counts in the log show when you hit the cap.

### Will old backup files pile up in my Drive?

Yes. The workflow only adds files and never deletes them, so clean the folder by hand when storage matters.

### Can I restore my data from the CSV backup?

Yes, by hand: re-import a file with Runbase CSV import and match on billing email or order reference. The template does not restore anything on its own.

### What happens if Google Drive is down or my token expires?

The run fails, Slack gets the error and a failed row is logged. Nothing retries on its own: fix the connection, then start a manual run.

## Related templates

- [Invoice archive to Drive](https://getrunbase.com/templates/invoice-archive-drive) — files each invoice in Drive as it is issued, next to your nightly CSVs.
- [Google Sheets CRM sync](https://getrunbase.com/templates/google-sheets-crm-sync) — keeps a live copy of your records in a Sheet, on top of the daily snapshots.
- [Weekly KPI report](https://getrunbase.com/templates/weekly-kpi-report) — turns the same customer and order data into a weekly summary.
