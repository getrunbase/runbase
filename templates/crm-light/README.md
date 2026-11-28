A simple CRM your sales team actually opens: companies, contacts and deals in one place, an open pipeline sorted by deal size, and a Slack message in your sales channel the moment anyone logs a new deal.

It replaces the shared spreadsheet where deals get lost between tabs, and the seat-priced CRM suite you only use a tenth of.

## Key benefits

- **No more "did anyone log that deal?"**: every new deal posts its title, amount and stage to Slack, so the team hears about it within seconds instead of at the Monday meeting.
- **One email, one contact**: contact emails and company domains are unique, so the same buyer or account cannot be entered twice by two reps.
- **Pipeline you can read in five seconds**: the Open pipeline view hides won and lost deals and puts the biggest amounts at the top.
- **Wins with dates attached**: the Won deals view lists closed business by close date, ready for a quarterly review or a commission check.

## How it works

The template ships one workflow, **Announce new deals in Slack**:

1. **Trigger**: a record is created in the Deals object (`trigger.record_created`). It fires for deals added by hand, by CSV import or by an AI agent over MCP.
2. **Step `notify`** (Slack): sends a message to the incoming webhook stored in the `SLACK_WEBHOOK_URL` secret, with the text `New deal: {{record.title}} ({{record.amount}}), stage {{record.stage}}`.

There is no condition and no delay: every new deal is announced once, right after it is saved. Editing a deal later (moving it to `won`, for example) does not send a second message.

## Who it's for

- **Founders and first sales hires** — get out of a spreadsheet with a pipeline that has real stages and linked contacts, without paying per seat.
- **RevOps** — own the deal data in your own database, query it with SQL and wire it to other tools through workflows.
- **Agencies and consultants** — track each client company, the person you talk to there and every proposal you send.
- **Growth and marketing teams** — see which leads turn into qualified deals and celebrate wins where the team already talks: Slack.

## The problem

A three-person sales team runs on a Google Sheet. One rep adds "Acme Corp", another adds "ACME" with a different contact, and the proposal sent last week sits in a row nobody filtered for. The founder asks in Slack which deals are open and waits half a day for an answer that is already out of date.

Moving to a big CRM fixes the structure but brings seat pricing, a long setup and a pipeline with twenty fields nobody fills in. What the team needs is smaller: a clean list of companies, people and opportunities, plus a ping when something new enters the funnel.

## What it does

You get a **CRM** database made of three related objects:

- **Companies**: Name, Domain (unique), Size (1-10, 11-50, 51-200, 200+).
- **Contacts**: Name, Email (unique), Phone, Company (link to Companies).
- **Deals**: Title, Amount, Stage (lead, qualified, proposal, won, lost), Company and Contact (links), Close date.

Two saved views on Deals:

- **Open pipeline**: every deal whose stage is not won or lost, sorted by amount, highest first.
- **Won deals**: deals at stage won, sorted by close date, most recent first.

One workflow, **Announce new deals in Slack**, described above. It needs a single secret, `SLACK_WEBHOOK_URL`.

Sample data shows how the relations fit together: the company Acme (acme.example, 11-50 people), the contact Ada Lovelace (ada@acme.example) and the deal "Acme annual plan" at 12,000, stage proposal, linked to both.

## Setup

1. Import the template; it sets up the **CRM** database and its workflows in one step.
2. In Slack, create an Incoming Webhook for your sales channel and copy its URL.
3. Store it in **Settings › Secrets** as `SLACK_WEBHOOK_URL`.
4. Open **Announce new deals in Slack** and run a test with a new deal to check the message lands in the right channel.
5. Activate the workflow.
6. Delete the sample records, then import your companies and contacts from CSV, matching on domain and email to avoid duplicates.

## Customize it

- Add a condition so only deals above 5,000 reach Slack, and the small ones stay quiet.
- Add a second workflow on record update that posts to Slack when a deal's stage becomes won.
- Add an Owner field on Deals and an "My open deals" view filtered on it for each rep.
- Add a "Closing this month" view that filters open deals on Close date.

## FAQ

### What is the best simple CRM for a small team?

The one your team keeps up to date, which usually means few fields and no seat limits. This template gives you companies, contacts and deals with five stages and two views, and you can add fields when you actually need them. Because Runbase is open source, you can self-host it and export your data at any time.

### Can I get a Slack notification when a new deal is created?

Yes, that is what the included workflow does. It posts the deal title, amount and stage to the channel behind your `SLACK_WEBHOOK_URL` webhook. It only fires on creation, so stage changes need a second workflow if you want them announced.

### Does this CRM sync with Gmail or my calendar?

No, not out of the box. Runbase cannot read your inbox, so emails and meetings are not logged on contacts automatically. You can add workflows that send emails or create events from deals, but conversation history stays in your mail client.

## Related templates

- [Google Sheets CRM sync](https://getrunbase.com/templates/google-sheets-crm-sync) — keep a sheet in step with your CRM for people who still live in spreadsheets.
- [Slack lead alert](https://getrunbase.com/templates/slack-lead-alert) — ping the team on new leads before they become deals.
- [Post-meeting follow-up](https://getrunbase.com/templates/post-meeting-follow-up) — send the recap email after each sales call.
