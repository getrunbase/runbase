# Google Calendar automations with Runbase

A calendar is where commitments become real: the demo on Thursday, the kickoff with a new client, a new hire's first one-on-one. Runbase connects Google Calendar to the rest of your work. Booking a meeting becomes a side effect of updating a record, and the events already on your calendar start useful work: reminders, recaps, prep briefs and scoreboards.

Sales, ops and people teams stop copying dates between tabs. A record changes, and the invite with its Meet link goes out. A meeting ends, and the follow-up is already drafted.

## What you can automate

- **Book meetings from your data**: move a candidate to "interview" or log a demo request, and the event appears with guests and a video link.
- **Put deadlines on the calendar**: contract end dates, content publish days and approved time off become events the whole team can see.
- **React to what is scheduled**: read today's or tomorrow's meetings to send reminders, agendas and prep notes.
- **Catch what did not happen**: spot declined or unconfirmed external guests and follow up the same hour.
- **Keep events in sync**: change a date or a guest list in Runbase and the event follows, or remove events that no longer apply.

## Use cases by team

**Sales.** Turn website requests into booked calls with [Demo Booking with Calendar Invite](https://getrunbase.com/templates/demo-booking-confirmation). Count held and cancelled demos per rep with [Sales Meeting Tracker](https://getrunbase.com/templates/meeting-booked-tracker). Recover missed calls with [No-show Follow-up](https://getrunbase.com/templates/no-show-follow-up). Send recaps from the notes in the event with [Post-meeting Follow-up Email](https://getrunbase.com/templates/post-meeting-follow-up).

**Customer success.** Put every contract end date on the calendar with [Contract Renewal Reminders](https://getrunbase.com/templates/renewal-reminders). Email external guests the day before with [Meeting Reminder Emails](https://getrunbase.com/templates/meeting-reminder-emails).

**Marketing.** Plan posts as all-day events with [Content Calendar](https://getrunbase.com/templates/content-calendar). Add each webinar registrant to the event guest list with [Event Registration Manager](https://getrunbase.com/templates/event-registration-manager).

**HR.** Book interviews with a Meet link with [Interview Scheduler](https://getrunbase.com/templates/interview-scheduler). Schedule a new hire's first week with [Employee Onboarding Checklist](https://getrunbase.com/templates/employee-onboarding). Show approved leave on the team calendar with [Time-off Request Approval](https://getrunbase.com/templates/pto-request-approval).

**Operations.** Open a war room for critical outages with [Incident Alerts and Status Updates](https://getrunbase.com/templates/incident-status-updates). Book client kickoffs with [Client Project Tracker](https://getrunbase.com/templates/client-project-tracker). Start every weekday with your schedule and attendee notes with [Daily Agenda Digest](https://getrunbase.com/templates/daily-agenda-digest).

## Triggers and actions

Google Calendar steps run inside a workflow that starts from a record change, a schedule, a webhook or a manual run. To react to meetings, pair a schedule (every hour, every morning) with **List events**.

**List events.** Returns the events of a calendar between two dates, sorted by start time. Recurring meetings are expanded into separate occurrences, so a weekly sync counts once per week. A text filter narrows the list, for example to events whose title contains "Demo". Each event carries its guests and their responses, so later steps can find external attendees or declined invites.

**Create an event.** Adds an event to the calendar you pick. Give a start and end as a date and time, or as plain dates for an all-day event such as a deadline or a day off. You can add a title, a description, a location and attendees. Choose whether Google emails the guests an invitation. Templates also request a Google Meet link so the call is ready to join.

**Update an event.** Changes only the fields you send and keeps the rest. Use it to move a meeting, rename it or rewrite its description. Sending attendees replaces the whole guest list, so include the existing guests when you add one.

**Delete an event.** Removes an event, for example when a deal is lost or a request is withdrawn. You can choose to notify the guests that it was cancelled.

Calendar fields in a step offer a dropdown of the calendars on your account, so you never paste a calendar ID by hand.

## Connect your Google Calendar account

Google Calendar uses the shared Google connection. One sign-in covers Calendar, Gmail, Google Sheets and Google Drive.

1. Add a Google Calendar step, or open **Connections**.
2. Choose **Connect Google** and sign in with the account that owns the calendars.
3. Review the permissions Google lists, then accept.

Runbase asks for two Calendar permissions. `calendar.events` lets it read and manage events on calendars you can edit. `calendar.calendarlist.readonly` lets it show your calendars in the step dropdown. It cannot change calendar sharing or settings. Tokens are encrypted and refreshed automatically.

You can disconnect anytime, from Runbase or from your Google account permissions page, and the workflows stop calling Calendar right away.

## FAQ

**Can it book on a shared team calendar?**
Yes, if the connected account can edit that calendar. Pick it in the step dropdown.

**Do guests get a real invitation?**
Yes, when the step asks Google to send updates. Guests receive the standard Google invite and can accept from their inbox.

**How do I react when a meeting ends?**
Run a schedule every 30 or 60 minutes, list events that ended in that window, and continue from there.

**What about recurring meetings?**
List events returns each occurrence on its own, with its own date, so reminders and counts stay correct.

**What time zone is used?**
Events keep the time zone you send. Dates without a zone follow the calendar's default zone.

**Is Runbase open source?**
Yes. You can self-host it and use your own Google OAuth client, so calendar data never leaves your infrastructure.

## Popular templates

- [Demo Booking with Calendar Invite](https://getrunbase.com/templates/demo-booking-confirmation)
- [Interview Scheduler](https://getrunbase.com/templates/interview-scheduler)
- [Daily Agenda Digest](https://getrunbase.com/templates/daily-agenda-digest)
- [Meeting Reminder Emails](https://getrunbase.com/templates/meeting-reminder-emails)
- [Sales Meeting Tracker](https://getrunbase.com/templates/meeting-booked-tracker)
- [Content Calendar](https://getrunbase.com/templates/content-calendar)
