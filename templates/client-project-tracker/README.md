Every new client project you log becomes a project brief in Google Drive, a kickoff meeting with a Meet link in Google Calendar and an announcement in Slack. Each weekday morning, milestone owners get a Gmail reminder before a date slips, and every Friday afternoon each active client receives a status email drafted by AI from your own tracker data. This client project tracker keeps agencies and freelancers on top of several accounts.

It replaces copied briefs, hand-sent invites and the Friday hour spent writing one update per client.

## Key benefits

- **Kickoff ready in seconds**: one new project record produces the brief, the invite for the client and the lead, two milestones and the Slack post.
- **No silent slips**: any open milestone due within three days, or already late, triggers an email to its owner and a Slack line at 8:00.
- **Friday updates without the writing**: the AI drafts each client's status from the health flag, the lead's notes and the milestone list, and never invents dates.

## How it works

**Kick off a new client project** (trigger: a record is created in Projects)

1. Google Drive saves `Project brief - {name}.md` with contacts, dates, budget, goals and scope.
2. Google Calendar creates "Kickoff: {name}" on the primary calendar, on `kickoff_date` from 10:00 to 11:00 in the project's `time_zone`, with a Meet link and the brief, inviting `client_contact_email` and `lead_email`.
3. The project is set to `status` active and `health` on-track, and stores `brief_file_id` and `kickoff_link`.
4. Two client-facing milestones owned by the lead are created: "Kickoff and brief sign-off" and "Final delivery".
5. Slack announces the project, lead and dates.

**Remind owners of milestones due in the next 3 days** (trigger: schedule, 8:00 Monday to Friday, Europe/Paris)

1. A date step computes now plus 3 days.
2. Runbase searches milestones whose `status` is not done and whose `due_date` is before that date, up to 200.
3. For each, Gmail emails `owner_email` and Slack gets a matching line.

**Send the weekly client status email** (trigger: schedule, 15:00 every Friday, Europe/Paris, once per project with `status` active)

1. Runbase loads the project's milestones.
2. An AI step writes the body (under 180 words) and an internal summary from health, delivery date, `status_notes` and milestones.
3. Gmail sends "{name}: weekly status" to `client_contact_email`, with `lead_email` in cc and as reply-to.
4. `last_update_sent_at` is set and `status_notes` is cleared for next week.
5. Slack receives the health and the internal summary.

## Who it's for

- **Agency account managers** — every client gets a consistent Friday update, even in a crunch week.
- **Ops leads at studios** — every kickoff and brief follows one routine.
- **Freelancers and consultants** — client admin runs itself while you do billable work.

## The problem

Monday: a website redesign is signed. The lead copies an old brief, forgets to change the budget and sends an invite without the brief attached. By Thursday a wireframe review is two days late, unnoticed in a spreadsheet tab. On Friday four clients expect an update written from memory, and the campaign stuck on the client's missing screenshots gets the vaguest one, so the delay looks like your fault.

## What it does

A "Client work" database links three objects. **Clients** hold the main contact, a unique domain and a status. **Projects** hold the client contact, lead, scope, goals, budget, kickoff and delivery dates, time zone, status, health (on-track, at-risk, off-track) and this week's notes. **Milestones** hold an owner, a due date, a status that includes waiting-on-client, and a client-facing flag.

Saved views: Active projects, At risk, Open milestones, Waiting on client, Active clients. Sample data: two clients, two projects, three milestones.

## Setup

1. From the Databases page, click **Import template**; your **Client work** database appears with its views and workflows.
2. In **Settings › Connections**, connect your Google account under the name `google`. That one connection covers Drive, Calendar and Gmail; kickoffs go on its primary calendar.
3. Create a Slack Incoming Webhook for your projects channel and save its URL as the secret `SLACK_WEBHOOK_URL` in **Settings › Secrets**.
4. Choose your workspace's AI provider for the status email step. No webhook is needed.
5. Test: create a project with your own address as client contact, check the brief, invite and Slack post, then run the weekly email manually.
6. Turn on the kickoff, milestone reminder and weekly status workflows.

## Customize it

- Change the reminder window from 3 days to 7 in the `horizon` date step.
- Move the weekly email to Thursday by editing its cron `0 15 * * 5` to `0 15 * * 4`.
- Add a `folderId` to the Drive step so briefs land in a shared clients folder.
- Add a Slack alert when a project's health changes to off-track.

## FAQ

### How do I send weekly client status emails automatically from Gmail?

The Friday workflow sends one Gmail email per active project, to the client contact, with the lead in cc and as reply-to. The AI uses only tracker data, so update milestones and notes before 15:00. Runbase cannot read your inbox: replies go to the lead.

### Can a client project tracker create the kickoff meeting in Google Calendar?

Yes. When you create a project, Runbase books a one-hour kickoff with a Google Meet link on the kickoff date and invites the client contact and the lead. It needs `kickoff_date` and `client_contact_email` filled at creation; the 10:00 start is set in the step.

### Does it remind people about overdue milestones?

Yes. The search catches every open milestone due within three days, late ones included, so they return each morning until done or rescheduled. Reminders go to the owner, not the client.

## Related templates

- [Customer onboarding](https://getrunbase.com/templates/customer-onboarding) — the step before the project: welcome new accounts and collect what you need.
- [Post-meeting follow-up](https://getrunbase.com/templates/post-meeting-follow-up) — send recaps after the kickoff and other client calls.
- [Invoice payment reminders](https://getrunbase.com/templates/invoice-payment-reminders) — chase the invoice once the final delivery milestone is done.
