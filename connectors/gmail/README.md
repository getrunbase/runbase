# Gmail automations with Runbase

Your best emails are the ones that go out on time: the thank-you right after a signup, the second nudge to a quiet prospect, the payment reminder nobody likes to write. Runbase sends them for you from your own Gmail address, triggered by what happens in your data. A new lead, a deal that moves stage or an invoice that slips past its due date becomes a real message in your Sent folder, written in your voice and threaded where it belongs.

Your recipients see a normal email from a person, not a newsletter blast from a no-reply domain. Your team keeps the records, the rules and the history in one workspace it controls.

## What you can automate

- **Instant replies to inbound interest**: answer form fills, demo requests and newsletter signups within seconds.
- **Follow-up sequences that stop on a reply**: chase prospects in one thread and stop as soon as you mark the reply on the record.
- **Reminders people actually open**: overdue invoices, upcoming renewals and tomorrow's meetings, each sent from a real inbox.
- **Recaps and status emails drafted by AI**: a step writes the text from your notes, you approve it, Gmail sends it.
- **Internal notices**: approval requests to managers and weekly reports to founders, so nobody has to forward anything by hand.

## Use cases by team

**Sales.** Run a three-touch cadence with the [Gmail Follow-up Sequence](https://getrunbase.com/templates/gmail-follow-up-sequence), or a personalised outbound batch from a spreadsheet with [Cold Email Campaign from Google Sheets](https://getrunbase.com/templates/cold-email-from-sheet). Confirm calls with [Demo Booking with Calendar Invite](https://getrunbase.com/templates/demo-booking-confirmation). Send the recap after every client call with [Post-meeting Follow-up Email](https://getrunbase.com/templates/post-meeting-follow-up). Win back missed meetings with [No-show Follow-up](https://getrunbase.com/templates/no-show-follow-up).

**Marketing.** Greet every new subscriber with [Newsletter Signups with Welcome Email](https://getrunbase.com/templates/newsletter-signup). Thank each form submission with [Lead Capture to Google Sheets](https://getrunbase.com/templates/lead-capture-to-sheets). Confirm webinar seats with [Event Registration Manager](https://getrunbase.com/templates/event-registration-manager). Send a nurture reply to warm leads with [Slack Lead Alert with AI Scoring](https://getrunbase.com/templates/slack-lead-alert).

**Customer success.** Collect scores with [NPS Survey and Feedback Loop](https://getrunbase.com/templates/customer-feedback-nps). Check in 90, 60 and 30 days before a contract ends with [Contract Renewal Reminders](https://getrunbase.com/templates/renewal-reminders). Cut no-shows with [Meeting Reminder Emails](https://getrunbase.com/templates/meeting-reminder-emails).

**Finance.** Escalate from polite to final with [Invoice Payment Reminders](https://getrunbase.com/templates/invoice-payment-reminders). Email clients their invoice link with [Invoice Archive to Google Drive](https://getrunbase.com/templates/invoice-archive-drive). Reply to each employee claim with [Expense Approval](https://getrunbase.com/templates/expense-approval).

**HR and ops.** Acknowledge every applicant with [Applicant Tracking from Google Sheets](https://getrunbase.com/templates/applicant-tracker). Welcome new hires with [Employee Onboarding Checklist](https://getrunbase.com/templates/employee-onboarding). Route leave requests to managers with [Time-off Request Approval](https://getrunbase.com/templates/pto-request-approval). Reorder from suppliers with [Low Stock Alert](https://getrunbase.com/templates/inventory-low-stock-alert).

## Triggers and actions

Gmail in Runbase is an action: something else starts the workflow, and Gmail delivers the message. Common starting points are a new record in a table, a field change, a schedule, an inbound webhook from your website form, or a manual run.

**Send an email.** This action sends a message from the connected Gmail account. You set the recipient, the subject and the body. The body can be plain text, HTML, or both, so you can keep it simple or match your brand. Every field accepts values from earlier steps, such as `{{record.first_name}}` or a paragraph an AI step just wrote.

To reply inside an existing conversation, give the thread ID from an earlier send. You can also pass the original Message-ID as "in reply to". The new message then lands in the same Gmail thread, for you and for the recipient. This is how a follow-up sequence reads as one tidy conversation instead of three cold emails.

The action returns the message and thread IDs. Store them on the record so later steps can reply in the thread or audit what went out.

Runbase does not read your inbox today. To react to a reply, update the record yourself, from a form or through your AI agent, and let the workflow check that status before it sends.

## Connect your Gmail account

Gmail uses the shared Google connection. Connect a Google account once and the same sign-in also covers Google Calendar, Google Sheets and Google Drive.

1. Add a Gmail step to a workflow, or open **Connections**.
2. Choose **Connect Google** and sign in with the account that should send the emails.
3. Review the permissions Google shows, then accept.

For Gmail, Runbase asks for the `gmail.send` permission only. It can send messages as you. It cannot read, search, label or delete the mail in your inbox. Tokens are stored encrypted in your workspace and refreshed automatically.

You can disconnect anytime, from Runbase or from your Google account security page. Sending stops at once, and your data stays where it is. Self-hosting teams register their own Google OAuth client: see [Connect Google](https://getrunbase.com/docs/guides/google).

## FAQ

**Will emails look like they come from a tool?**
No. They are sent through the Gmail API from your account, so they carry your name and appear in your Sent folder. Gmail does not add your signature to API sends, so include it in the body.

**Can Runbase read my emails?**
No. The only Gmail permission requested is sending. Your inbox content never reaches Runbase.

**How do I stop a sequence when a prospect answers?**
Mark the record as replied. The templates check the status before every send and skip the remaining steps.

**Are there sending limits?**
Google's own daily limits for your account apply, roughly 500 recipients per day on a free account and more on Google Workspace. Keep batches in line with that.

**Can several teammates send from their own inbox?**
Yes. Each person can connect their Google account, and each step picks the connection it sends from.

**Can I self-host this?**
Yes. Runbase is open source, so you can run it on your own servers with your own Google OAuth client.

## Popular templates

- [Gmail Follow-up Sequence](https://getrunbase.com/templates/gmail-follow-up-sequence)
- [Cold Email Campaign from Google Sheets](https://getrunbase.com/templates/cold-email-from-sheet)
- [Invoice Payment Reminders](https://getrunbase.com/templates/invoice-payment-reminders)
- [Newsletter Signups with Welcome Email](https://getrunbase.com/templates/newsletter-signup)
- [Post-meeting Follow-up Email](https://getrunbase.com/templates/post-meeting-follow-up)
- [Meeting Reminder Emails](https://getrunbase.com/templates/meeting-reminder-emails)
