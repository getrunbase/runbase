Every leave request logged in Runbase reaches the right manager in Gmail, waits for a yes or no, and once approved lands on the team Google Calendar, in the employee's inbox and in your Slack channel. This PTO request approval workflow keeps one list of who is off, when, and who signed off.

It replaces the "can I take Friday?" message buried in a chat thread, the yes nobody wrote down, and the shared calendar nobody updated.

## Key benefits

- **No forgotten requests**: the manager gets an email the moment a request is created, and it stays queued until someone decides.
- **Calendar updated without anyone touching it**: an approved request becomes an event on the team calendar, and its link is saved back on the request.
- **Employees know where they stand**: a Gmail confirmation or decline arrives, manager in copy.
- **Handovers planned before the absence**: Slack hears about approved time off at approval, not on the first day off.

## How it works

One workflow, **Approve time off and share it**:

1. **Trigger**: a record is created in Leave requests.
2. **Email the manager** (Gmail): sends to `manager_email` with the subject "Time-off request from {employee}", with dates, leave type, working days and note.
3. **Wait for a decision** (human approval): the run pauses until someone approves or rejects in Runbase. The timeout is 7 days; with no decision, the run ends and the request stays `pending`.
4. **If approved, create the event** (Google Calendar): adds "{employee} off ({leave_type})" to the calendar set in `calendarId`, from `first_day` to `back_on`, without sending invitations (`sendUpdates: none`).
5. **Update the request**: sets `status` to `approved` and stores the event's link in `event_link`.
6. **Confirm to the employee** (Gmail): sends to `email`, with `manager_email` in copy, the dates and the calendar link.
7. **Tell the team** (Slack): posts "Heads-up: {employee} ({team}) is off from … and back on …" through the `SLACK_WEBHOOK_URL` webhook.
8. **If rejected**: sets `status` to `rejected`, then emails the employee (manager in copy) that the dates could not be approved and the manager will suggest others.

## Who it's for

- **Ops and people leads** — one approval path for every team, with a record of each decision instead of scattered chat replies.
- **Growth and marketing managers** — see who is away before a launch or campaign week, straight from the Upcoming time off view.
- **RevOps leads** — keep coverage on pipeline reviews and quarter close by spotting overlapping absences early.

## The problem

Maya from Growth asks her manager for two weeks over the holidays. Sam replies "sure" between two meetings. Nobody updates the team calendar, so a campaign review lands on her first day off, and Maya is not sure the "sure" counted.

Multiply that by a dozen people and "who is out over New Year?" takes an afternoon of scrolling. Rejections leave no trace at all.

## What it does

The template creates a **Time off** database with one object, **Leave requests**. Its fields: employee (title), employee email, team, manager email, leave type (vacation, sick, parental, unpaid, other), first day off, back on, working days, note, status (pending, approved, rejected) and calendar link.

Three saved views ship with it:

- **Waiting for approval**: pending requests, soonest first day first. This is the manager's queue.
- **Upcoming time off**: approved requests by date, with the calendar link.
- **All requests**: the full history, newest first.

Four sample records cover each status: one pending vacation, two approved (vacation and parental) and one rejected unpaid leave. The workflow above needs one secret, `SLACK_WEBHOOK_URL`.

## Setup

1. Start by importing the template, which creates the **Time off** database.
2. Connect your Google account so Gmail can send the emails and Google Calendar can create the events.
3. Open the workflow and replace `YOUR_TEAM_CALENDAR_ID` in the calendar step with your shared team calendar's ID (Google Calendar settings, "Integrate calendar").
4. Create an incoming webhook in Slack for the channel that should hear about absences, and save it as the secret `SLACK_WEBHOOK_URL`.
5. Create a test request with your own email in both email fields. Approve it and check the email, the calendar event and the Slack message.
6. Activate the workflow.

## Customize it

- Shorten the approval timeout from `7d` to `3d` for teams that plan short absences.
- Add a condition on `leave_type` so sick leave skips the approval step and goes straight to the calendar.
- Add a condition on `working_days` to send requests over 10 days to a second approver.
- Remove the Slack step and set `sendUpdates` to `all` if you prefer calendar invites to a channel post.

## FAQ

### How do I set up a PTO request approval workflow with Google Calendar?

Import this template, connect your Google account and paste your team calendar's ID into the calendar step. Each approved request becomes an event from the first day off to the back-on date; pending and rejected ones never reach it.

### Can a manager approve time off by replying to the email?

No. Runbase sends the email from Gmail but does not read your inbox, so a reply does nothing. The manager approves or rejects in Runbase, from the Waiting for approval view, or asks an AI agent to do it over MCP.

### What happens if the manager never answers a leave request?

The approval step waits 7 days. After that the run ends, no event is created and the request stays pending in the Waiting for approval view. Nothing reminds the manager automatically.

### Does this track remaining PTO balances?

No. Each request stores its working days, but there is no per-employee balance. Add an Employees object with an allowance field and a rollup of approved working days to get one.

## Related templates

- [Employee onboarding](https://getrunbase.com/templates/employee-onboarding) — set up new hires, then use this template once they start taking time off.
- [Expense approval](https://getrunbase.com/templates/expense-approval) — routes expense claims to a manager for sign-off.
