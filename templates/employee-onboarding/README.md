Enter a new hire once and their first week is ready: a welcome email from Gmail, three Google Calendar invites with Meet links, a welcome doc in Google Drive, a three-task checklist split between IT, people ops and the manager, and a Slack intro for the team. It is employee onboarding automation for teams that hire a few people a month.

It replaces the onboarding spreadsheet, the copy-pasted welcome email and the "did anyone ask IT for a laptop?" message sent the Friday before day one.

## Key benefits

- **Twenty minutes back per hire**: one record replaces ten manual actions across four apps.
- **No forgotten first-week review**: the review on `review_date` is booked at the same moment as day one, before the manager's calendar fills up.
- **IT knows the deadline**: the laptop task is due on the start date, in the IT setup view.
- **One place to see who starts when**: the Starting soon view lists every pre-boarding hire by start date, with role, team, manager and location.

## How it works

The **Onboard a new hire** workflow starts when a record is created in **Employees**. There is no condition or delay: every step runs right away, in this order.

1. **Gmail** sends "Welcome to the team, {name}" to `personal_email`, with `manager_email` in copy and as reply-to. It names the manager, buddy and `work_email`.
2. **Google Calendar** creates "Welcome session: {name}" on `start_date`, 9:30 to 11:00 in `time_zone`, inviting `work_email` and `manager_email` with a Meet link.
3. **Google Calendar** creates "1:1 {manager_name} / {name}" on `start_date`, 14:00 to 14:45.
4. **Google Calendar** creates "First-week review: {name}" on `review_date`, 16:00 to 16:30.
5. **Google Drive** creates a Markdown file "Welcome - {name}.md" with the team details, first-week schedule and a "Before day one" list.
6. **Runbase** updates the employee: `status` set to `pre-boarding`, `welcome_doc_id` set to the new Drive file ID.
7. **Runbase** creates three onboarding tasks linked to the employee, all `todo`: "Create accounts and ship laptop" (owner `it`, due `start_date`), "Collect signed contract and payroll details" (owner `people-ops`, due `start_date`) and "Share 30-day plan" (owner `manager`, due `review_date`).
8. **Slack** posts to the `SLACK_WEBHOOK_URL` channel: name, role, team, start date, manager, buddy and `fun_fact`.

## Who it's for

- **HR and people ops** — every hire gets the same welcome, meetings and paperwork task, whoever is on holiday that week.
- **Ops managers** — open tasks by owner and due date, without chasing people in DMs.
- **Founders of small teams** — a repeatable new hire onboarding process without paying per seat for an HR suite.
- **Sales and marketing leads** — new reps get their 1:1 and review booked before they arrive.

## The problem

A sales rep starts Monday. Thursday, someone remembers the welcome email. Friday, the manager books a 1:1, forgets the review, and nobody tells IT: no laptop on day one.

Nothing here is hard: it is ten small actions across four tools and three people, tracked in someone's head. Two hires in one month and things slip.

## What it does

The template creates a **People ops** database with two objects.

- **Employees**: name, personal email (unique), work email, role, team, manager and manager email, buddy, start date, review date, time zone (default `Europe/Paris`), location, status (pre-boarding, onboarding, completed), welcome doc ID and fun fact.
- **Onboarding tasks**: title, linked employee, owner (people-ops, it, manager, new-hire), due date, status (todo, done).

Saved views: **Starting soon**, **Currently onboarding**, **Open tasks** (by due date) and **IT setup**.

One workflow, **Onboard a new hire** (above). Sample data: three employees, one per status, and three tasks.

## Setup

1. Ask your AI agent to run `template.import`, or use **Import template** on the Databases page, to add the **People ops** database.
2. Connect your Google account in **Settings › Connections**. One connection covers Gmail, Calendar (primary calendar) and Drive.
3. In Slack, create an Incoming Webhook for your team channel and save its URL as the secret `SLACK_WEBHOOK_URL` in **Settings › Secrets**.
4. Adjust the email text, event times and doc content. No inbound webhook is needed.
5. Create a test employee with your own addresses, a `start_date` and a `review_date`, then check the email, the three invites, the Drive file, the three tasks and the Slack message.
6. Activate the workflow.

## Customize it

- Add a `folderId` to the Google Drive step so welcome docs land in a shared onboarding folder.
- Add a fourth `record.create` step for a `new-hire` task, such as "Complete security training", due on `review_date`.
- Add a view on Onboarding tasks filtered on owner `manager` so each manager sees their open items.
- Add a second Slack step with another webhook secret to ping the IT channel about the laptop.

## FAQ

### How do I automate employee onboarding with Google Workspace?

Add each hire as a record in Employees. The workflow sends the Gmail welcome, books the Calendar events and creates the Drive doc from your connected Google account.

### Can the welcome doc be shared with the new hire automatically?

Not in this template. The Drive step creates the file and stores its ID but does not change sharing. Share it by hand, or save it in a folder the work account can already open.

### What happens if I leave the review date empty?

The first-week review event and the 30-day plan task use `review_date`, so without it the calendar step has no valid date and the run stops there. Fill in both `start_date` and `review_date` before saving the employee.

### Does it mark tasks done or move the status to "completed"?

No. The workflow only sets `pre-boarding` and creates tasks as `todo`. Owners set tasks to `done`, and you move the employee to `onboarding` or `completed` yourself.

## Related templates

- [Interview Scheduler](https://getrunbase.com/templates/interview-scheduler) — books the interviews that come before the offer.
- [Applicant Tracker](https://getrunbase.com/templates/applicant-tracker) — tracks candidates up to the hire that starts this onboarding.
- [PTO Request Approval](https://getrunbase.com/templates/pto-request-approval) — time off requests once they join.
