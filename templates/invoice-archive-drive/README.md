Save invoices to Google Drive automatically. Each invoice you log in Runbase becomes a numbered HTML file in your Drive invoices folder and a new row in your Google Sheets ledger. Gmail emails the client the Drive link, and the record is marked as sent.

No more export, upload, copy-paste and "please find attached" for every invoice.

## Key benefits

- **No missing files at month end**: an invoice cannot reach the client without first landing in the Drive folder, so the archive your accountant opens is complete.
- **A ledger that matches what was sent**: the Sheets row is built from the same record as the file and the email, so amounts and due dates never drift between the three.
- **Sequential numbers without a spreadsheet formula**: an autonumber field produces `INV-00001`, `INV-00002` and so on with no typing.
- **Clear view of what is owed**: the "Unpaid invoices" view lists every sent invoice by due date, with its Drive link one click away.

## How it works

The template ships one workflow, **Archive and send new invoices**, triggered when an Invoices record is created.

1. **Condition**: the run continues only if `status` is not `draft`. Invoices created as drafts are left alone.
2. **Read the invoice**: `record.get` loads the invoice with its linked `client` included.
3. **Render**: the `render-invoice` function builds the number, the file name (`INV-00042 - Client - 2026-11-28.html`), the HTML invoice, the email and the ledger row, using the `company` and `currency` inputs.
4. **Google Drive**: "Create a file" uploads the HTML (`text/html`) into the folder set in `folderId`.
5. **Google Sheets**: "Append rows" adds Number, Client, Issue date, Due date, Amount, Currency and Description to the `Invoices` tab of your spreadsheet.
6. **Gmail**: "Send an email" goes to the client's billing email, with the invoice summary and the Drive `webViewLink`.
7. **Update the record**: `status` becomes `sent`, and `invoice_number` and `drive_link` are stored on the invoice.

Each step runs only if the previous one succeeded, so a failed upload sends nothing.

## Who it's for

- **Finance and ops leads** — one form to issue an invoice, with the archive, ledger and client email handled for you.
- **Agency owners and freelancers** — bill retainers and projects without paying per seat for an invoicing suite.
- **External accountants** — receive a Drive folder and a Sheets ledger that are always in sync, without chasing files.

## The problem

An agency sends fifteen invoices a month. For each one, someone exports a file, drops it in Drive, copies the amount into the ledger and emails the client. On a busy Friday, one step gets skipped. In December the accountant asks for invoice 37: it is not in the folder, the ledger does not match the bank, and nobody knows if the client received it.

## What it does

The import creates an **Invoicing** database with two linked objects:

- **Clients**: name, billing email (unique), contact name, billing address.
- **Invoices**: description, number (autonumber), invoice number, client (link to Clients), amount (currency), issue date, due date, status (`draft`, `sent`, `paid`, `void`) and Drive file (URL).

Four saved views come with it: **Unpaid invoices** (status `sent`, oldest due date first), **Issued last 30 days**, **Paid invoices** and **All clients** sorted by name.

Sample data: two clients (Northwind Traders, Globex Studio) and three invoices, one paid and two sent, with placeholder Drive links.

## Setup

1. Add the **Invoicing** database to your workspace with **Import template** on the Databases page.
2. Link the Google account that holds your invoice archive. Runbase asks for Drive, Sheets and Gmail send access. No secrets are needed.
3. Create a Drive folder for invoices and copy its ID from the URL. Paste it in place of `YOUR_DRIVE_FOLDER_ID` in the `archive` step.
4. Create a spreadsheet with an `Invoices` tab, and add the headers Number, Client, Issue date, Due date, Amount, Currency, Description. Paste its ID in place of `YOUR_SPREADSHEET_ID` in the `ledger` step.
5. In the `render` step, replace `Your Company Ltd` with your company name, and change `EUR` if you bill in another currency.
6. Test: create a `sent` invoice for a client with your own email, then check the file, row and email.
7. Activate the workflow.

## Customize it

- Add a Slack step after `email` to post each new invoice and amount to a #finance channel.
- Edit the HTML in `render-invoice` to add your logo, VAT number, bank details or several line items.
- Add a "Due this week" view on Invoices, filtered on `due_date` and status `sent`.

## FAQ

### How do I save invoices to Google Drive automatically?

Connect your Google account, set the Drive folder ID in the workflow, and create invoices in Runbase with a status other than draft. Each one is uploaded there as an HTML file named by number, client and date. Invoices made in other tools are not picked up.

### Is the invoice saved as a PDF?

No. The file is HTML, which opens in any browser and in the Drive preview. Runbase does not convert HTML to PDF, so a PDF needs base64 content you generate yourself.

### Can Gmail attach the invoice file to the email?

This template does not attach the file. The email carries the Drive link, so share the folder so clients can open it. Runbase only sees the Drive files it created.

### What happens if I create an invoice as a draft?

Nothing is uploaded, logged or sent. The trigger fires only on creation, so switching a draft to `sent` later does not start it; add a workflow on record update for that.

### Does it track payments or send reminders?

No. You mark invoices `paid` yourself. For reminders, add the payment reminders template below.

## Related templates

- [Invoice Payment Reminders](https://getrunbase.com/templates/invoice-payment-reminders) — follow up on the sent invoices this template creates until they are paid.
- [Quote Approval](https://getrunbase.com/templates/quote-approval) — get quotes signed off before they turn into invoices.
- [Sheet Backup to Drive](https://getrunbase.com/templates/sheet-backup-drive) — keep dated copies of your ledger in Drive.
