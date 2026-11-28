Every alert your monitoring tool fires becomes an incident record in Runbase, a Slack message in your on-call channel and, for SEV1 incidents, a Google Meet war room booked on Google Calendar. Customers affected by the outage then get an incident status update from Gmail, drafted by AI from the facts on the record and sent only after your incident lead approves it.

It replaces the scramble of posting in Slack, hunting for a call link and writing a nervous customer email while the fix is still in progress.

## Key benefits

- **War room in seconds**: a SEV1 alert books a one-hour Google Meet call starting now and posts the link to Slack
- **No leaked internals**: the AI draft is told to skip root-cause guesses, fix-time promises and internal names, and a human reads it before it leaves.
- **Customers kept private**: the update goes out with recipients in Bcc, so one client never sees another client's address.
- **A real incident log**: every alert ID maps to one record, so you can count SEV1 incidents per month and see which customers were told what.

## How it works

1. **Trigger**: a call to the `incident-alerts` incoming webhook creates or updates an Incidents record, matched on `external_id` (payload `id`).
2. **Slack alert**: posts severity, title, service, status, summary and lead via `SLACK_WEBHOOK_URL`.
3. **SEV1 check**: continues to the war room only if `severity` is `sev1` and `war_room_link` is empty; otherwise it jumps to step 7.
4. **War room**: creates a 60-minute Google Calendar event with a Google Meet link, inviting the incident lead.
5. **Save the link**: writes the Meet link into `war_room_link`, so later updates for the same alert reuse it.
6. **Slack follow-up**: posts "SEV1 war room is open" with the Meet link.
7. **Customer check**: if `affected_customers` is empty, sets `customer_notice` to `skipped` and stops.
8. **AI draft**: writes a subject and a plain-text body under 150 words: what customers may notice, what the team is doing, when the next update comes. Saves the body in `customer_update` and sets `customer_notice` to `pending`.
9. **Approval**: asks for a human approval in Runbase showing recipients, subject and body, with a 4-hour timeout.
10. **Send**: on approval, Gmail sends the update to the incident lead with affected customers in Bcc, then sets `customer_notice` to `sent`. On rejection or timeout, it sets `skipped`.

## Who it's for

- **Ops leads** — run incidents from one table instead of a chat thread, with lead, responders and war room on each record.
- **Customer success and support managers** — know which accounts were notified for each outage without asking engineering.
- **Small SaaS engineering teams** — get structured incident communication without paying for a dedicated incident platform.

## The problem

Your checkout API starts returning 502s at 14:05. The support inbox fills up. Someone eventually posts in Slack, someone else drops a Zoom link, and the customer email goes out an hour later, written in a hurry, mentioning a load balancer and a colleague by name.

A week later, sales asks whether Contoso was told. The answer is buried in three threads.

## What it does

- **Object**: Incidents, in an Incidents database. Key fields: Alert ID (`external_id`, unique), Severity (sev1–sev3), Status (investigating to resolved), Affected service, Summary, Source, Started and Resolved at, Incident lead, Responders, Affected customer emails, War room link, Customer update and Customer notice (pending, sent, skipped).
- **Saved views**: Open incidents (status not resolved, newest first), SEV1 incidents, Customer update pending (notice pending and customers listed, oldest first) and Incident history.
- **Sample data**: four incidents: a SEV1 checkout outage, a SEV2 notification delay still pending a customer notice, a resolved SEV3 dashboard slowdown and a resolved SEV1 SSO failure.

## Setup

1. Import the template to create the **Incidents** database (Databases page › **Import template**, or the MCP tool `template.import`).
2. Connect your Google account so the workflow can create Calendar events with Meet links and send email from Gmail.
3. Configure an AI provider of your choice in Runbase for the draft step.
4. Create a Slack incoming webhook for your on-call channel and save it as the secret `SLACK_WEBHOOK_URL`.
5. Create the `incident-alerts` webhook in Runbase and point your monitoring or on-call tool at its URL. Send at least `id`, `title` and `severity`.
6. Send a test payload with a SEV1 severity and your own email in `affected_customers`, then check Slack, the invite and the approval.
7. Activate the workflow.

## Customize it

- Lengthen the war room by changing the `room_end` amount from 60 to 120 minutes.
- Add responders to the invite by putting `{{record.responders}}` in the war room attendees.
- Open a war room for SEV2 too by changing the `is_sev1` condition to `neq` `sev3`.
- Shorten the approval timeout from 4h to 30m for faster customer notices.
- Add a "Resolved this month" view filtered on `resolved_at`.

## FAQ

### How do I send incident status updates to customers automatically?

Send your alerts to the `incident-alerts` webhook with the affected customer emails. Runbase drafts the update with AI and Gmail sends it once the lead approves. Nothing reaches customers without a human click.

### Can I create a Google Meet link automatically when an incident starts?

Yes, for SEV1 incidents. The workflow creates a one-hour Google Calendar event with a Meet link, invites the incident lead and saves the link on the record.

### Does this replace a public status page?

No. It emails the customers listed on the incident, it does not publish a status page.

### What happens if nobody approves the email?

After 4 hours without a decision, the notice is marked `skipped` and nothing is sent. The draft stays in `customer_update` for a manual send.

## Related templates

- [Slack lead alert](https://getrunbase.com/templates/slack-lead-alert) — the same Slack webhook pattern, aimed at new leads.
- [Support tickets](https://getrunbase.com/templates/support-tickets) — track the customer tickets an outage generates.
- [Renewal reminders](https://getrunbase.com/templates/renewal-reminders) — follow up with accounts hit by incidents before they renew.
