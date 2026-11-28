# Slack automations with Runbase

Your team already lives in Slack, so that is where the news should arrive: a hot lead, a deal just logged, a customer who gave a 3 out of 10, a product about to run out. Runbase posts those moments to the right channel as they happen, with the context needed to act. Nobody has to refresh a dashboard or dig through a spreadsheet to learn what changed.

Alerts come from your own data and your own rules, so a channel only gets the messages that matter to it. That is the difference between a channel people mute and one they watch.

## What you can automate

- **Alerts on the records that matter**: post only the leads AI scores as hot, only the tickets marked urgent, only the deals above a threshold.
- **Announcements when something starts**: a new client project, a new hire, a new customer to onboard.
- **Approval requests**: ask a manager to review a discount or an expense, with a link to decide in Runbase.
- **Scheduled digests**: weekly KPIs, a Monday rep scoreboard, an overdue invoice total split by age.
- **Failure and incident pings**: tell on-call when an alert fires or a nightly backup does not finish.

## Use cases by team

**Sales.** Route only the best inbound to reps with [Slack Lead Alert with AI Scoring](https://getrunbase.com/templates/slack-lead-alert). Announce each new deal with [Light CRM](https://getrunbase.com/templates/crm-light) or, when deals live in a spreadsheet, with [Google Sheets CRM Sync](https://getrunbase.com/templates/google-sheets-crm-sync). Hold big discounts for a manager with [Quote and Discount Approval](https://getrunbase.com/templates/quote-approval). Post a weekly ranking with [Sales Meeting Tracker](https://getrunbase.com/templates/meeting-booked-tracker).

**Marketing.** Show every form fill to the team with [Lead Capture to Google Sheets](https://getrunbase.com/templates/lead-capture-to-sheets). Warn the owner two days before a piece is due with [Content Calendar](https://getrunbase.com/templates/content-calendar). Tell sales about each partner referral with [Partner Referral Tracker](https://getrunbase.com/templates/partner-referral-tracker).

**Customer success and support.** Flag detractors the moment they answer with [NPS Survey and Feedback Loop](https://getrunbase.com/templates/customer-feedback-nps). Greet new accounts with [Customer onboarding](https://getrunbase.com/templates/customer-onboarding). Put every request in front of the team with [Support tickets](https://getrunbase.com/templates/support-tickets).

**Operations.** Page on-call for outages with [Incident Alerts and Status Updates](https://getrunbase.com/templates/incident-status-updates). Post items under their minimum with [Low Stock Alert](https://getrunbase.com/templates/inventory-low-stock-alert). Hear about failed runs with [Database Backup to Google Drive](https://getrunbase.com/templates/sheet-backup-drive).

**Finance and leadership.** Share the overdue total with [Invoice Payment Reminders](https://getrunbase.com/templates/invoice-payment-reminders). Bring claims to managers with [Expense Approval](https://getrunbase.com/templates/expense-approval). Deliver the Monday numbers with [Weekly KPI Report](https://getrunbase.com/templates/weekly-kpi-report).

**HR.** Post interviews in the hiring channel with [Interview Scheduler](https://getrunbase.com/templates/interview-scheduler). Introduce new hires with [Employee Onboarding Checklist](https://getrunbase.com/templates/employee-onboarding). Share approved leave with [Time-off Request Approval](https://getrunbase.com/templates/pto-request-approval).

## Triggers and actions

Slack is an action in Runbase. The workflow starts from a new or updated record, a schedule, an inbound webhook or an approval step, and Slack is where the result is announced.

**Send a Slack message.** Posts a message to the channel tied to an Incoming Webhook. Write the text with values from earlier steps, such as the lead's name, the deal amount or the reason an AI step gave. Slack formatting works too: bold, links and line breaks. Add a link back to the Runbase record so the reader can open it in one click.

Each step can use its own webhook. One workflow can post hot leads to `#sales` and failures to `#ops`, and one workspace can even reach several Slack workspaces. For safety, the step only sends to `hooks.slack.com`, so a mistyped URL can never leak data to another site.

Runbase does not listen to Slack messages or reactions today. Decisions such as approvals are made in Runbase, and the Slack message links there.

## Connect your Slack account

Slack connects through an Incoming Webhook, not a full Slack app sign-in. You give Runbase the right to post in one chosen channel, and nothing else.

1. In Slack, create an Incoming Webhook for the channel. A workspace admin may need to approve it.
2. Copy its URL, which starts with `https://hooks.slack.com/services/`.
3. In Runbase, store it in **Settings › Secrets**, then insert the secret in the step's webhook field. You can also paste the URL directly.

A webhook can only post messages to its channel. It cannot read messages, list members, open DMs or see other channels. Keep the URL in a secret: anyone who has it can post to that channel.

You can disconnect anytime. Remove the webhook in Slack, or delete the secret in Runbase, and posting stops right away.

## FAQ

**Can it post to several channels?**
Yes. Create one webhook per channel and choose the right one in each step.

**Can Runbase read our Slack conversations?**
No. An Incoming Webhook can only send messages. It has no read access to your workspace.

**Can I mention someone in the alert?**
Yes. Use Slack's mention syntax with a member ID, such as `<@U012AB3CD>`, in the message text.

**How do I avoid noisy channels?**
Add a condition or an AI decision before the Slack step, so only the records that meet your rule are posted.

**What happens if the webhook is revoked?**
The step fails with a clear error in the run, and the rest of your data stays intact. Add a new webhook and update the secret.

**Is Runbase open source?**
Yes. You can self-host it, and your alerts then go straight from your servers to Slack.

## Popular templates

- [Slack Lead Alert with AI Scoring](https://getrunbase.com/templates/slack-lead-alert)
- [Light CRM](https://getrunbase.com/templates/crm-light)
- [Support tickets](https://getrunbase.com/templates/support-tickets)
- [Incident Alerts and Status Updates](https://getrunbase.com/templates/incident-status-updates)
- [Weekly KPI Report](https://getrunbase.com/templates/weekly-kpi-report)
- [NPS Survey and Feedback Loop](https://getrunbase.com/templates/customer-feedback-nps)
