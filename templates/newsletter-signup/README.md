Every newsletter signup from your form lands in one clean subscriber list, gets a welcome email from your own Gmail within seconds, receives two onboarding emails over the next five days, and shows up as a new row in a Google Sheet. That is newsletter welcome email automation without paying an email platform per contact.

No more copying signups out of an inbox, welcoming people days late, or emailing the same person twice because they subscribed from two pages.

## Key benefits

- **Welcome sent while interest is fresh**: the first email leaves Gmail as soon as the form posts, not when someone remembers to check the sheet.
- **No double welcomes**: the email address is unique, so a repeat signup updates the existing subscriber and the series never restarts.
- **Unsubscribes respected mid-series**: status is checked again before each onboarding email, so setting someone to unsubscribed stops the rest.
- **Source and campaign on every subscriber**: source, UTM source and UTM campaign are stored, so you can see which page or lead magnet actually grows the list.

## How it works

The **Welcome new newsletter subscribers** workflow runs in this order:

1. **Trigger**: your form posts to the inbound webhook `newsletter-form`. Runbase creates or updates the subscriber matched on `email` and maps `email`, `first_name`, `source`, `utm_source` and `utm_campaign`.
2. **Condition**: continues only if `status` is `new` (the default for a fresh record). Existing subscribers stop here.
3. **Gmail**: sends "Welcome to the newsletter, {first_name}" from the `google` connection.
4. **Update record**: sets `status` to `onboarding` and `onboarding_step` to 1.
5. **Google Sheets**: appends a row to the `Subscribers` tab of the sheet in `SUBSCRIBERS_SPREADSHEET_ID` with Email, First name, Source, UTM campaign and Signed up (time of processing).
6. **Wait 2 days.**
7. **Condition**: continues only if `status` is still `onboarding`.
8. **Gmail**: sends "The 3 issues readers save the most".
9. **Update record**: sets `onboarding_step` to 2.
10. **Wait 3 days.**
11. **Condition**: continues only if `status` is still `onboarding`.
12. **Gmail**: sends "One thing to try this week".
13. **Update record**: sets `status` to `active` and `onboarding_step` to 3.

## Who it's for

- **Content marketers** — new readers get a warm start the same minute they subscribe, with no manual send.
- **Growth teams** — UTM fields on every subscriber show which campaigns bring readers who reach active.
- **Founders writing a company newsletter** — run the welcome series from your own Gmail address instead of a paid list tool.
- **Marketing ops** — one deduplicated subscriber table plus a Sheet mirror that the rest of the team already reads.

## The problem

Your signup form drops emails into a spreadsheet or an inbox. Once a week someone copies them, misses a few, and sends a generic welcome to the batch. By then the reader who signed up after your webinar has forgotten why they subscribed. Someone who joined from two pages gets two welcomes.

Newsletter platforms fix this but bill by list size, which a welcome email and two follow-ups rarely justify.

## What it does

The template creates an **Audience** database with a **Subscribers** object. Fields: `email` (unique, record title), `first_name`, `source` (homepage, blog, webinar, lead-magnet, referral, other), `utm_source`, `utm_campaign`, `status` (new, onboarding, active, unsubscribed; default new), `onboarding_step` (number of onboarding emails sent) and `notes`.

Five saved views come with it: **Latest signups**, **In welcome series** (status onboarding, with step count), **Active subscribers**, **Signups by source** and **Unsubscribed**.

One workflow, described above, handles the welcome and two-email onboarding series. Four sample subscribers cover each status.

## Setup

1. From the Databases page, click **Import template**; your **Audience** database appears with its views and workflows.
2. Create a Google Sheet with a tab named `Subscribers` and this header row: Email, First name, Source, UTM campaign, Signed up.
3. In **Settings › Connections**, connect a Google account and name the connection `google`. It covers both Gmail and Sheets.
4. In **Settings › Secrets**, add `SUBSCRIBERS_SPREADSHEET_ID` (the id in the sheet URL).
5. Create an inbound webhook named `newsletter-form` and set its URL as your form's submit target. Send `email`, `first_name`, `source`, `utm_source` and `utm_campaign` as top-level JSON fields. `source` must match one of the options or be left out.
6. Rewrite the three emails in your own voice, then sign up with a test address and check the welcome email and the new sheet row.
7. Activate the **Welcome new newsletter subscribers** workflow and delete the sample records.

## Customize it

- Change the `2d` and `3d` waits to space the onboarding emails differently.
- Add a third tip: duplicate the wait, condition, Gmail and update steps before `mark_active`.
- Add a Slack step after `log_sheet` to post each new subscriber with their `utm_campaign` to a marketing channel.
- Add a `lead-magnet` filtered view, or a condition on `source` to send webinar signups a different welcome.

## FAQ

### How do I send an automatic welcome email to new newsletter subscribers from Gmail?

Point your form at the `newsletter-form` webhook and connect Google as `google`. Each new address gets the welcome from that Gmail account right away. Repeat signups from the same address are matched and do not get a second welcome.

### Can people unsubscribe automatically?

Runbase cannot read your inbox, so an "unsubscribe" reply does not change anything until you set the subscriber's `status` to `unsubscribed`. From then on, the remaining onboarding emails are skipped.

### Can I send my regular newsletter issues with this?

The template only sends the welcome and the two onboarding emails. Gmail has daily sending limits, so it suits lists that grow by up to a few hundred signups a day. For bulk issues, export the **Active subscribers** view as CSV and import it into your sending tool.

## Related templates

- [Lead capture to Sheets](https://getrunbase.com/templates/lead-capture-to-sheets) — logs sales enquiries from a web form into Google Sheets.
- [Gmail follow-up sequence](https://getrunbase.com/templates/gmail-follow-up-sequence) — a longer timed Gmail sequence when two follow-ups are not enough.
- [Event registration manager](https://getrunbase.com/templates/event-registration-manager) — manage webinar signups first.
