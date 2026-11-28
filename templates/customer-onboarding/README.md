Every customer you add to Runbase lands in a customer onboarding tracker with their plan and status, and the moment the record is created your team gets a Slack message naming the customer, their company, their plan and the email to greet them at. The record flips from new to welcomed on its own, so the list always shows who still needs attention.

It replaces the shared spreadsheet where someone types "welcomed?" in a column on good days and forgets on busy ones.

## Key benefits

- **No silent signups**: each new customer record posts to your onboarding channel within seconds, so a hello goes out the same day instead of whenever someone checks the sheet.
- **A queue that maintains itself**: the "To onboard" view lists every customer whose status is not active, so the CSM works from one screen.
- **Status nobody has to remember to set**: the workflow writes welcomed on the record before Slack is pinged, so the team sees who has been announced.
- **Plan context up front**: the Slack message carries the plan (starter, pro or enterprise), so an enterprise account gets a senior owner from the first minute.

## How it works

1. **Trigger**: the workflow "Welcome new customers" starts when a record is created in the Customers object, from the UI, a CSV import, the MCP server or another workflow.
2. **Track** (`record.update`): sets `status` to `welcomed` on that same record.
3. **Announce** (`node.slack.send`): only after the update succeeds, posts to the Slack Incoming Webhook stored in `SLACK_WEBHOOK_URL` the text "New customer: {name} ({company}, {plan} plan). Say hello at {email}."

There is no delay and no condition: every new customer gets both steps, once. Moving a customer to `active` is a manual step when onboarding is done.

## Who it's for

- **Customer success managers** — one queue of customers not yet active, with no signup slipping through on a busy Monday.
- **Ops leads** — see who is new, welcomed or active without asking for an update.
- **RevOps** — plan and company stored as clean, typed fields from day one, ready to report on activation by plan.
- **Founders of small SaaS teams** — everyone sees each new customer in Slack before the first support ticket.

## The problem

A customer signs up for the pro plan on Friday afternoon. The founder sees the Stripe email, means to forward it, and does not. On Tuesday the customer writes to support asking how to invite their team, and nobody can say whether they were ever welcomed, because "onboarding status" is a column in a sheet that two people edit and nobody trusts.

Multiply that by ten new accounts a week and your first impression depends on who happened to be online.

## What it does

- **Database and object**: a Customers database with a Customers object. Fields: `name` (text, title), `email` (email, unique, so the same customer cannot be added twice), `company` (text), `plan` (select: starter, pro, enterprise) and `status`, labelled "Onboarding status" (select: new, welcomed, active).
- **Saved view**: "To onboard", filtered on `status` not equal to `active`.
- **Workflow**: "Welcome new customers", described above, with two steps linked so Slack is only called after the status update succeeds.
- **Secret**: `SLACK_WEBHOOK_URL`, the onboarding channel webhook.
- **Sample data**: none. The object starts empty, so add a test customer to see the flow.

## Setup

1. Install the template from the Databases page (**Import template**) to get the **Customers** database.
2. In Slack, create an Incoming Webhook for your onboarding channel and copy its URL.
3. Paste that URL into **Settings › Secrets** as `SLACK_WEBHOOK_URL`.
4. Open the **Welcome new customers** workflow and rewrite the message in your own voice if needed.
5. Activate the workflow, then create a test customer: check the Slack post and that the status reads welcomed.
6. Point your real source at the Customers object: a CSV import, a form, or an inbound webhook from your billing tool.

## Customize it

- Add a `csm` user field and mention the owner in the Slack text so each announcement has a name attached.
- Add a condition step on `plan` so only enterprise customers go to a dedicated `#enterprise-onboarding` webhook.
- Add a Gmail send step after Announce to email the customer a welcome message from your own address.
- Add a delay of 7 days, then a Slack reminder if `status` is still welcomed, to chase stalled accounts.
- Save a second view grouped by `plan` to see how many pro and enterprise accounts are still onboarding.

## FAQ

### How do I build a customer onboarding tracker without a spreadsheet?

Import this template: it gives you a typed Customers object with an onboarding status and a saved view of everyone not yet active. Records can be added by hand, by CSV or by an inbound webhook.

### Can I get a Slack notification when a new customer signs up?

Yes, as long as the signup creates a record in the Customers object, for example through an inbound webhook from your checkout or a form. The workflow then posts to the channel tied to your Incoming Webhook. Runbase does not watch your billing tool on its own, so you need to send it the signup.

### Does the status move to active automatically?

No. The workflow only sets welcomed. You set active by hand, or add a workflow that updates the record when your app pushes an event.

### Can I send a welcome email to the customer too?

Not out of the box: this template only announces the customer internally. You can add a Gmail step to the workflow after connecting your Google account, and keep the Slack post for the team.

## Related templates

- [Employee onboarding](https://getrunbase.com/templates/employee-onboarding) — the same tracked idea, for new hires.
- [Customer feedback NPS](https://getrunbase.com/templates/customer-feedback-nps) — ask onboarded customers how it went once they are active.
- [Renewal reminders](https://getrunbase.com/templates/renewal-reminders) — keep the relationship going after onboarding, before contracts end.
