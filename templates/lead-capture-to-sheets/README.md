Every time someone fills in your landing page, pricing page or webinar form, the lead lands in Runbase, a new row appears in your shared Google Sheet, your team sees it in Slack, and the person gets a thank-you email from your Gmail address within seconds. This is the simplest way to save form submissions to Google Sheets without losing the UTM campaign each lead came from.

It replaces the fragile chain of a form tool dashboard, a zap that copies some rows, and a teammate pasting the good leads into chat by hand.

## Key benefits

- **No lead lost between tools**: one workflow stores the lead, writes the sheet row, posts to Slack and sends the email, with every run logged.
- **Campaign attribution kept**: `utm_source`, `utm_medium` and `utm_campaign` travel from the form to the record, the sheet and the Slack message, so you can count leads per campaign.
- **Instant reply to warm leads**: the thank-you email leaves your own Gmail account right after the submission, promising an answer within one business day.
- **No duplicates in your lead list**: leads are matched on email, so a second submission updates the existing record instead of creating a twin.

## How it works

The **Capture form leads** workflow runs these steps on every submission:

1. **Trigger**: your form posts to the `lead-form` webhook. Runbase maps `email`, `name`, `company`, `message`, `source`, `utm_source`, `utm_medium` and `utm_campaign` onto a Leads record and upserts it by `email`. New leads get the status `new`.
2. **Google Sheets**: appends one row to the `Leads` tab of the spreadsheet in `LEADS_SPREADSHEET_ID`, with the columns Name, Email, Company, Source, UTM source, UTM medium, UTM campaign and Message.
3. **Slack**: once the row is written, posts "New lead: name <email> from company. Source …, campaign …" through the `SLACK_WEBHOOK_URL` incoming webhook.
4. **Gmail**: once Slack succeeds, sends the lead an email titled "Thanks for reaching out, {name}" from your connected Google account.

Steps run in sequence, with no delay or condition.

## Who it's for

- **Growth marketers** — see which campaign and channel each form lead came from, in the sheet everyone already opens.
- **Demand generation teams** — capture ebook, webinar and pricing-page leads in one list without paying for another form tool.
- **Sales and SDRs** — get a Slack ping the moment a lead arrives and reply while the prospect is still on your site.
- **RevOps** — own a clean, deduplicated Leads table with a status field you can report on.

## The problem

A prospect downloads your ops guide from a LinkedIn ad on Tuesday evening. The form tool keeps it in its own dashboard, the zap copying it to the team sheet hit its task limit, and the UTM tags were dropped. Marketing reports zero leads from that campaign and pauses it, while sales finds the lead a week later, cold, with no idea where it came from.

## What it does

The template creates a **Marketing** database with a **Leads** object:

- `name` (title), `email` (unique), `company`, `message`
- `source`: landing-page, pricing-page, webinar, ebook, other
- `utm_source`, `utm_medium`, `utm_campaign`
- `status`: new, contacted, qualified, disqualified (default new)

Three saved views come with it: **New leads** (status new, newest first), **Leads by campaign** (sorted by UTM campaign, with source and UTM columns) and **Qualified leads**.

One workflow, **Capture form leads**, handles the webhook, Google Sheets, Slack and Gmail steps described above. Four sample leads (Google, LinkedIn, newsletter and organic sources) show the fields and statuses in use.

## Setup

1. Start by importing the template, which creates the **Marketing** database.
2. Connect your Google account under Connections. The Sheets and Gmail steps both use the connection named `google`.
3. Create a Google Sheet with a tab named `Leads` and a header row: Name, Email, Company, Source, UTM source, UTM medium, UTM campaign, Message. Set its ID as the secret `LEADS_SPREADSHEET_ID`.
4. Create a Slack incoming webhook for your marketing channel and save it as the secret `SLACK_WEBHOOK_URL`.
5. Create the `lead-form` webhook and point your form at its URL, sending fields with the keys listed in How it works.
6. Send a test submission, then check the run history, sheet, Slack and inbox.
7. Activate the workflow.

## Customize it

- Add a condition before the Gmail step so only `pricing-page` leads get the email.
- Add a `country` or `phone` field to Leads, map it in the trigger and add the column to the sheet row.
- Post `webinar` leads to a separate Slack channel by adding a second Slack step with another webhook secret.
- Add a step that sets `status` to `contacted` once the thank-you email is sent.

## FAQ

### How do I save form submissions to Google Sheets automatically?

Point your form at the `lead-form` webhook. Each submission becomes a lead and a row in the `Leads` tab. Any form builder that can send a webhook POST works.

### Does it track UTM parameters from my landing page?

Yes, if your form sends them. Capture them into hidden fields; Runbase does not read the visitor's URL itself, so empty hidden fields mean empty UTM columns.

### Can I send an automatic thank-you email from Gmail when a form is submitted?

Yes. The last step sends a plain-text email from the Google account you connect. Runbase only sends; it cannot read your inbox, so replies from leads stay in Gmail and are not logged on the record.

### What happens if the same person submits the form twice?

The lead record is matched on email and updated, not duplicated. The sheet still gets a new row and the person gets the email again. Add a condition step if you want to skip repeats.

### Do I need Slack to use this template?

The Slack step runs before Gmail, so a missing or broken `SLACK_WEBHOOK_URL` stops the email. If you do not use Slack, delete that step and link the sheet step directly to Gmail.

## Related templates

- [Slack Lead Alert](https://getrunbase.com/templates/slack-lead-alert) — when you only need the Slack ping.
- [Gmail Follow-up Sequence](https://getrunbase.com/templates/gmail-follow-up-sequence) — keep emailing leads who did not reply to the first message.
- [CRM Light](https://getrunbase.com/templates/crm-light) — move qualified leads into a pipeline with deals and activities.
