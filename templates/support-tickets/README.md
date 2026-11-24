# Support tickets

A lightweight support inbox: every new ticket lands in one shared list and
triggers an alert in the support channel in Slack, with the customer, the
subject and the priority.

## Who it's for

This template is for product teams and early-stage startups where engineers
handle support themselves and already talk to each other in Slack. It suits
teams that receive bug reports and questions from a contact form, an in-app
widget, an email parser or a webhook, and that do not want to pay for a
helpdesk suite just to route a few dozen tickets a week. It is also useful as
a starting point for a custom support desk: statuses, priorities and fields
can all be changed after the import, and more steps can be added to the
workflow later.

## The problem

Support requests usually arrive in many places at once. A customer reports a
bug by email, another one fills in a form, a third one writes through the
product, and nobody on the team sees all of them. Requests get answered twice
or not at all, and the customer never hears back because nobody knows who
owns the ticket. Helpdesk products solve this, but they are expensive, they
keep the data in their own cloud, and they add yet another inbox to watch.
Small teams need something simpler: one list of tickets, a clear status for
each one, and a ping in the team chat as soon as a new request comes in.

## What it does

The template creates a Support database with a Tickets object: subject,
customer email, message, priority (low, normal, high, urgent) and status
(open, in progress, resolved). A workflow runs on every new ticket. It posts a
short alert to a Slack channel with the Slack connector, with the customer
email, the subject and the priority, so the right person can pick the ticket
up within minutes. A saved view lists every ticket that is not resolved yet,
which gives the team a single queue to work through. Every run is kept in the
run history with its inputs and outputs, and a failed step can be retried on
its own without sending the alert twice.

## Setup

1. Import the template from the Databases page with **Import template**, or
   with the MCP tool `template.import`.
2. Create a Slack app with the `chat:write` bot scope, install it and invite
   the bot to your support channel.
3. In **Settings › Secrets**, add `SLACK_BOT_TOKEN`.
4. Open the **Alert the team for each ticket** workflow, replace `#support`
   with your channel, then activate it.
5. Create a test ticket to check the Slack alert.
