# Google Drive automations with Runbase

Some work has to end up as a file: the signed-off quote, the monthly invoice, the onboarding doc for a new hire, last night's backup. Runbase writes those files into Google Drive at the right moment, named the way your team expects and linked back to the record they came from. Nobody exports, renames or drags anything into a folder again.

Your Drive stays the shared shelf people already browse. Runbase is the clerk that keeps it stocked, and the link to every file sits on the deal, invoice or candidate it belongs to.

## What you can automate

- **Archive documents as they are produced**: every invoice, quote or expense memo lands in Drive with a predictable name.
- **Create working docs for new things**: a project brief, a content brief or a welcome guide appears as soon as the record is created.
- **Back up your tables on a schedule**: export customers and orders as dated CSV files every night.
- **Share links, not attachments**: store the Drive link on the record and drop it into the email or Slack message that follows.
- **Keep files tidy for audits**: one folder, one naming rule, one link per record.

## Use cases by team

**Finance.** File each invoice as a numbered document and log it in a ledger with [Invoice Archive to Google Drive](https://getrunbase.com/templates/invoice-archive-drive). Keep a memo for every approved or refused claim with [Expense Approval](https://getrunbase.com/templates/expense-approval).

**Sales.** Save every approved quote as a file and stamp its link on the deal with [Quote and Discount Approval](https://getrunbase.com/templates/quote-approval).

**HR.** Create a screening note for each candidate, ready for interview notes, with [Applicant Tracking from Google Sheets](https://getrunbase.com/templates/applicant-tracker). Prepare a personal welcome doc for each new hire with [Employee Onboarding Checklist](https://getrunbase.com/templates/employee-onboarding).

**Marketing.** Get a ready-to-fill brief for every planned post, newsletter or case study with [Content Calendar](https://getrunbase.com/templates/content-calendar).

**Operations.** Write a project brief for each new client with [Client Project Tracker](https://getrunbase.com/templates/client-project-tracker). Keep a nightly copy of your key tables off-platform with [Database Backup to Google Drive](https://getrunbase.com/templates/sheet-backup-drive).

## Triggers and actions

Google Drive is an action in Runbase. A workflow starts from a new or changed record, a schedule, an approval decision or a webhook. The Drive step then writes the file.

**Create a file.** Creates a new file in Google Drive and returns its ID, its name and a link to open it. You choose:

- **Name**: build it from record values, for example `INV-{{record.number}} {{record.client}}.html` or `customers-{{now}}.csv`.
- **Content**: plain text from earlier steps, such as an HTML invoice, a markdown brief, a CSV export or a summary an AI step wrote. Binary content, such as an image, can be passed base64-encoded.
- **Type**: the MIME type tells Drive how to show the file, for example `text/csv` or `text/html`.
- **Folder**: put the file in a folder of your choice so each kind of document has its home.

The returned link is the useful part. Save it on the record, put it in an email to the client, or post it in Slack, so people open the file in one click.

Each run creates a new file. To keep a history, add the date or a version number to the name. Runbase does not edit or delete existing Drive files, so earlier versions are never overwritten by a workflow.

## Connect your Google Drive account

Google Drive uses the shared Google connection. Connecting a Google account once covers Drive, Gmail, Google Calendar and Google Sheets.

1. Add a Google Drive step, or open **Connections**.
2. Choose **Connect Google** and sign in with the account that should own the files.
3. Read the permissions Google shows, then accept.

For Drive, Runbase asks for the `drive.file` permission only. It can see and manage the files it creates itself, and files you choose to open with it. It cannot browse, read or delete the rest of your Drive. Your existing contracts, HR folders and personal files stay invisible to it. Tokens are stored encrypted and refreshed automatically.

You can disconnect anytime, from Runbase or from your Google account settings. Files already created stay in your Drive, because they belong to you.

## FAQ

**Can Runbase read my existing Drive files?**
No. With `drive.file` it only sees the files it created or the ones you picked for it. Everything else stays private.

**Who owns the files?**
The Google account you connected. They count toward that account's storage and follow its sharing rules.

**Can it create Google Docs instead of plain files?**
It writes files from the content you provide, such as HTML, text or CSV. Drive previews them, and you can open them with Google Docs.

**How do I share a file with a client?**
Put the returned link in a Gmail step. Make sure the folder sharing settings let the recipient open it.

**Can I organise files by month or client?**
Yes. Point each step at the folder you want and build the file name from record fields.

**Can I host Runbase myself?**
Yes. Runbase is open source. Self-hosted teams register their own Google OAuth client, as described in [Connect Google](https://getrunbase.com/docs/guides/google).

## Popular templates

- [Invoice Archive to Google Drive](https://getrunbase.com/templates/invoice-archive-drive)
- [Database Backup to Google Drive](https://getrunbase.com/templates/sheet-backup-drive)
- [Quote and Discount Approval](https://getrunbase.com/templates/quote-approval)
- [Employee Onboarding Checklist](https://getrunbase.com/templates/employee-onboarding)
- [Content Calendar](https://getrunbase.com/templates/content-calendar)
- [Applicant Tracking from Google Sheets](https://getrunbase.com/templates/applicant-tracker)
