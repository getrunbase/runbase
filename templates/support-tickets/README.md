Every customer request becomes a ticket in one shared queue, and your support channel in Slack gets a message within seconds. The message names the customer, the subject and the priority. This support ticket system gives a small team one place to see what is waiting, who wrote in and how urgent it is, without buying a helpdesk seat for every person.

It replaces the mix of a shared inbox, a spreadsheet and "did anyone answer this?" threads, where requests get two replies or none.

## Key benefits

- **No ticket sits unseen**: each new ticket posts to Slack as soon as it is saved, so nobody has to check a separate inbox to notice it.
- **Urgency at a glance**: the alert carries the priority (low, normal, high or urgent), so an urgent bug report stands out from a password question in the channel itself.
- **One queue to clear**: the "Open tickets" view hides everything marked resolved, so the team works from the same short list each morning.
- **Your data stays yours**: tickets live in your own Runbase database, so you can export or self-host them.

## How it works

The template has one workflow, **Alert the team for each ticket**:

1. **Trigger**: a record is created in the Tickets object (`trigger.record_created`).
2. **Slack step** (`node.slack.send`): posts a message to the Incoming Webhook stored in the `SLACK_WEBHOOK_URL` secret, with the text `New ticket from {{record.email}}: {{record.subject}} ({{record.priority}})`.

There are no conditions and no delays. Every new ticket sends exactly one alert. Changing a ticket's status later does not trigger the workflow again.

## Who it's for

- **Support and customer success leads**: a ticket queue with statuses and priorities, without a per-agent helpdesk licence.
- **Ops teams** handling internal requests (IT, facilities, access): every request is logged and the team is pinged where it already talks.
- **Product and engineering teams** that do their own support: bug reports reach the Slack channel the developers already watch.
- **Founders of early-stage startups**: a real support process from the first customer, which can grow into a custom desk later.

## The problem

A customer emails about a failed payment on Monday morning. One teammate sees it, means to reply after a meeting, and forgets. Another customer reports the same bug through the contact form, and two people answer it with different advice.

Helpdesk suites fix this, but they charge per seat and add one more inbox to watch. They need a single list of tickets with a status, and a ping in the team chat when a new one lands.

## What it does

The template creates a **Support** database with one object, **Tickets**:

- **Subject** (text, used as the ticket title)
- **Customer email** (email)
- **Message** (text)
- **Priority** (select: low, normal, high, urgent)
- **Status** (select: open, in_progress, resolved)

A saved view, **Open tickets**, filters on status not equal to resolved, so it shows both new and in-progress tickets. The workflow above sends the Slack alert. The template ships no sample records.

## Setup

1. Add the **Support** database to your workspace with **Import template** on the Databases page.
2. In Slack, create an Incoming Webhook for your support channel and copy its URL.
3. Save it under **Settings › Secrets** with the name `SLACK_WEBHOOK_URL`.
4. Open the **Alert the team for each ticket** workflow and activate it.
5. Create a test ticket in Tickets, with a subject, an email and a priority. Check that the message appears in your channel.
6. Decide how real tickets will arrive: typed by the team, added by your AI agent through MCP, imported from CSV, or created from an inbound webhook connected to your contact form.

## Customize it

- **Only alert on urgent tickets**: add a condition before the Slack step so it runs only when `priority` is `high` or `urgent`.
- **Capture tickets from your form**: create an inbound webhook and a `trigger.webhook` mapping that fills subject, email and message from the form payload.
- **Add an owner**: add an "Assigned to" field and a saved view per teammate, so each person sees only their own open tickets.
- **Split the queue**: add an "Urgent open" view that filters on `priority` = `urgent` and status not resolved.
- **Route by channel**: add a second secret such as `SLACK_URGENT_WEBHOOK_URL` and a second Slack step for urgent tickets.

## FAQ

### How do I build a simple support ticket system without a helpdesk?

Import this template. You get a Tickets object with priority and status, an open-tickets view and a Slack alert for each new ticket. It does not ship a customer portal or canned replies.

### Can I get a Slack notification for every new support ticket?

Yes, that is the one workflow in this template. It posts through a Slack Incoming Webhook, so the message goes to the single channel that webhook is tied to. It does not tag a specific person or open a thread.

### Can customers email tickets straight into it?

Not out of the box. Runbase does not read a mailbox, so emails do not become tickets on their own. Point your contact form or an email-parsing service at a Runbase inbound webhook, or add tickets by hand or through your AI agent over MCP.

### Does it reply to the customer automatically?

No. The template only alerts your team. You reply from your own email client. You can add a Gmail step to send an acknowledgement, but this template does not include one.

## Related templates

- [Incident status updates](https://getrunbase.com/templates/incident-status-updates) — when one ticket turns into an outage, keep customers informed.
- [Customer feedback NPS](https://getrunbase.com/templates/customer-feedback-nps) — measure how customers feel after their tickets are resolved.
- [Slack lead alert](https://getrunbase.com/templates/slack-lead-alert) — alerts sales in Slack the moment a lead comes in.
