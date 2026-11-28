Every customer marked as due gets a one-question NPS survey from your own Gmail address on Tuesday morning. Each answer is scored, tagged by AI with a sentiment, a theme and a one-line summary, logged as a row in a shared Google Sheet, and any detractor lands in Slack the moment they reply. It is NPS survey automation your team owns.

It replaces a feedback platform billed per response and a pile of comments nobody tags.

## Key benefits

- **Detractors reach a human within minutes**: a score of 0 to 6 posts the email, score, theme and comment to Slack as soon as the form is submitted.
- **Comments come pre-tagged**: the AI step files each comment under product, support, pricing, onboarding, performance or other, so the theme dragging the score down is visible without reading every answer.
- **No double surveys**: a customer moves from `due` to `sent` the moment the email leaves, and to `answered` when they reply, so nobody is asked twice.
- **One sheet for leadership**: every answer is appended to the `NPS` tab, ready for a pivot table.

## How it works

**Workflow 1: Send NPS surveys**

1. Trigger: schedule, every Tuesday at 10:00 (Europe/Paris), on each Customers record whose `survey_status` is `due`.
2. Gmail emails the customer, signed by `account_owner`, with a link to `NPS_SURVEY_URL?email=<email>`.
3. If the send succeeds, the customer is updated: `survey_status` = `sent`, `last_survey_at` = today.

**Workflow 2: Classify NPS answers and alert on detractors**

1. Trigger: the `nps-answer` webhook. `response_id`, `email`, `score` and `comment` upsert an NPS responses record, matched on `response_id`.
2. The `nps-category` function buckets the score: 9-10 promoter, 7-8 passive, 0-6 detractor. Detractors get `follow_up` = `to_contact`, others `none`.
3. An AI step returns `sentiment`, `theme` and a one-sentence `summary`.
4. The response is updated with these five values.
5. Google Sheets appends a row to the `NPS` range of `NPS_SPREADSHEET_ID`: Date, Email, Score, Category, Sentiment, Theme, Summary, Comment.
6. Runbase looks up the customer by `email`. If found, the response is linked and the customer gets `survey_status` = `answered` and `last_nps_score`.
7. Condition: if the category is `detractor`, Slack gets a "Detractor alert" via `SLACK_WEBHOOK_URL`.

## Who it's for

- **Customer success managers** — get every unhappy account in Slack plus a "Detractors to contact" list.
- **RevOps** — see `last_nps_score` next to plan and owner, ready to cross with renewal risk.
- **Marketing** — pull the "Promoters" view for reviews and case studies.

## The problem

Omar, an enterprise customer, rates you 4 out of 10 and writes that large exports keep timing out. The answer sits in a survey dashboard nobody opens, and his account owner first hears about the timeouts on the renewal call. Without tagging, nobody knows whether this month's detractors share one bug or one price complaint.

## What it does

The template creates a **Customer feedback** database with two objects:

- **Customers**: name, email (unique), company, plan (starter, pro, enterprise), account owner, survey status (due, sent, answered, opted out), last survey sent, last NPS score.
- **NPS responses**: response ID (unique), respondent email, customer (link to Customers), score (0-10), comment, NPS category, sentiment, main theme, AI summary, follow-up (none, to contact, contacted, closed).

Saved views: **Detractors to contact** (detractors with follow-up `to_contact`, newest first), **Responses by theme**, **Promoters**, and **Surveys due** on Customers.

It ships the two workflows above and the `nps-category` function. Sample data: three customers (Maya scored 10, Omar 4, Lena is due) and their two classified responses.

## Setup

1. Start by importing the template, which creates the **Customer feedback** database.
2. Link the Google account that sends surveys, under the connection name `google`.
3. Create a Google Sheet with a tab named `NPS` and the headers Date, Email, Score, Category, Sentiment, Theme, Summary, Comment.
4. Set the secrets: `NPS_SURVEY_URL` (your form link), `NPS_SPREADSHEET_ID` (the ID in the sheet URL) and `SLACK_WEBHOOK_URL` (a Slack incoming webhook).
5. Create the `nps-answer` webhook and point your form tool (Tally, Typeform) at its URL. Send `response_id`, `email` (from the `?email=` link parameter), `score` and `comment`.
6. Configure an AI provider in the workspace for the classification step.
7. Test: submit a score of 3 and check the record, sheet row and Slack message.
8. Activate both workflows, then set `survey_status` to `due` on the customers you want to survey.

## Customize it

- Change the cron to survey quarterly instead of weekly.
- Edit the `nps-category` function to also flag passives (7-8) as `to_contact`.
- Add a Gmail step after the condition that thanks promoters and asks for a review.
- Add a view on follow-up = `contacted` to track closed loops.

## FAQ

### How do I automate NPS surveys with Gmail and Google Sheets?

Mark customers as `due` and the Tuesday schedule emails each one from your connected Gmail account. Form answers reach the webhook and become rows in your sheet. Runbase does not host the survey page, so you need a form tool that posts to a webhook.

### Can I get a Slack alert when a customer gives a low NPS score?

Yes. Any score from 0 to 6 is a detractor and triggers a Slack message with the email, score, theme, AI summary and comment. Others are logged silently.

### Can AI categorize NPS comments automatically?

The AI step returns a sentiment, one of six themes and a one-sentence summary for each comment. It is told not to invent details, so a blank comment is filed as `other`. Adjust the prompt if your themes differ.

### What happens if someone answers twice or replies by email?

Answers are matched on `response_id`, so a form resend updates the same record instead of creating a duplicate. Runbase cannot read your inbox, so a customer who replies to the survey email with a score is not captured; only form submissions to the webhook are.

## Related templates

- [Slack lead alert](https://getrunbase.com/templates/slack-lead-alert) — posts every new inbound lead to a Slack channel.
- [Renewal reminders](https://getrunbase.com/templates/renewal-reminders) — call at-risk detractors before their renewal.
- [Weekly KPI report](https://getrunbase.com/templates/weekly-kpi-report) — add your weekly NPS to the report leadership already reads.
