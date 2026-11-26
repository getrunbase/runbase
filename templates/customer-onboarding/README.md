# Customer onboarding

Track where each new customer stands in onboarding, and announce every new
customer to the team in Slack so someone reaches out right away.

## Who it's for

This template is for SaaS founders, customer success managers and small
operations teams who sign new customers every week and still follow them up
by hand. It fits teams that coordinate in Slack and want a shared, always up
to date list of the customers they are onboarding. It works the same whether
customers come from a signup form, a checkout page, a webhook from your
product or a CSV import of a new batch of accounts.

## The problem

The first hours after a signup decide whether a customer gets value or drifts
away. A welcome that arrives late, or never, makes the product feel
abandoned. Yet onboarding is spread across people and tools: someone notices
the signup, someone else is supposed to say hello, and the status of each
customer lives in a spreadsheet or in someone's head. Steps get skipped on
busy days, and nobody can answer the simple question of which customers were
welcomed and which were not.

## What it does

The template creates a Customers database with a Customers object: name,
unique email, company, plan and onboarding status (new, welcomed, active). A
workflow runs on every new customer record. First it moves the status of the
customer to welcomed, so the record shows that onboarding has started. Then it
posts a message to a Slack channel with the Slack connector, with the name,
company, plan and email of the customer, so the team knows who to greet. A
saved view lists every customer who is not active yet, which gives your team a
daily onboarding queue. Each run keeps its inputs, outputs and errors in the
run history, and a failed step can be retried on its own without posting the
message twice.

## Setup

1. Import the template from the Databases page with **Import template**, or
   with the MCP tool `template.import`.
2. In Slack, create an Incoming Webhook for your onboarding channel and copy its URL.
3. In **Settings › Secrets**, add `SLACK_WEBHOOK_URL` with the webhook URL.
4. Open the **Welcome new customers** workflow, adjust the message to your own voice, then activate it.
5. Create a test customer to check the whole flow.
