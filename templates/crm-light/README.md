# Light CRM

A simple, self-hosted CRM with companies, contacts and deals, a pipeline view,
and a Slack message every time a new deal is created.

## Who it's for

This template is for founders, consultants, agencies and small sales teams who
have outgrown a spreadsheet but do not want the cost, the seat pricing or the
complexity of a full CRM suite. It suits teams that want to own their customer
data on their own server, query it with SQL, and connect it to their other
tools through workflows instead of paid add-ons. It is also a good starting
point for developers who want to build a custom CRM on top of Runbase: every
object, field and view can be changed after the import.

## The problem

Early sales work usually lives in a spreadsheet, a notes app and a chat
channel at the same time. Contacts are copied by hand, companies appear twice
with slightly different names, and nobody knows which deals are still open.
Hosted CRMs fix the structure, but they charge per seat, lock the data behind
their own export formats, and push complex pipelines on teams that only need a
clear list of companies, people and opportunities. Meanwhile the team still
wants to know, in real time, when a new deal enters the pipeline.

## What it does

The template creates a CRM database with three linked objects. Companies hold
a name, a unique domain and a size bucket. Contacts hold a name, a unique email
address, a phone number and a link to their company, so the same person is
never stored twice. Deals hold a title, an amount, a stage (lead, qualified,
proposal, won or lost), a close date, and links to the company and the main
contact. Two saved views are included: the open pipeline, sorted by amount,
and the list of won deals, sorted by close date. A workflow listens for new
deals and posts a short message to a Slack channel with the deal title, amount
and stage, using the Slack connector. Sample records (one company, one contact
and one deal) show how the relations work and can be deleted at any time.

## Setup

1. Import the template from the Databases page with **Import template**, or
   with the MCP tool `template.import`.
2. Create a Slack app with the `chat:write` bot scope, install it in your
   workspace and invite the bot to your sales channel.
3. In **Settings › Secrets**, add `SLACK_BOT_TOKEN` with the bot token.
4. Open the **Announce new deals in Slack** workflow, change the channel from
   `#sales` to your own channel if needed, then activate it.
5. Create a deal to check the Slack message, then delete the sample records
   and import your own companies and contacts from CSV.
