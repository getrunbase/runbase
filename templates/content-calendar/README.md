Every blog post, newsletter, LinkedIn carousel or case study you add to this content calendar shows up as an all-day event on the owner's Google Calendar, gets a ready-to-fill brief in Google Drive, and triggers a Slack nudge when the deadline is two days out and the piece is still not scheduled.

It replaces the editorial spreadsheet that holds every due date but never tells the person who owns it.

## Key benefits

- **Deadlines land where writers look**: each dated item becomes an all-day Google Calendar event with the owner as attendee.
- **Briefs start from the same skeleton**: every new item gets a Markdown brief in Drive with channel, owner, due date and target keyword.
- **Moved deadlines move everywhere**: change the due date, status or owner and the Calendar event follows.
- **Late pieces surface before they are late**: on weekday mornings, anything due within two days and not yet scheduled lands in Slack.

## How it works

1. **Add new content to Google Calendar and Drive** runs when a content item is created.
   1. A condition checks that `due` is not empty; undated ideas stop here.
   2. Date steps turn `due` into a `YYYY-MM-DD` start and next-day end.
   3. Google Calendar creates an all-day event on `primary` titled `[channel] title`, with `owner_email` as attendee and `sendUpdates: none` (no invitation email).
   4. Google Drive creates `Brief - <title>.md` with the brief template.
   5. The record is updated with `calendar_event_id`, `calendar_link` and `brief_url`.
2. **Keep the Calendar event in sync** runs when `title`, `channel`, `due`, `status`, `owner` or `owner_email` changes.
   1. It continues only if `calendar_event_id` and `due` are both filled.
   2. It updates the event dates, sets the title to `[channel] title (status)` and links the Drive brief.
3. **Remind owners in Slack before the deadline** runs on a schedule at 09:00 Monday to Friday (Europe/Paris), over items whose status is not `scheduled` or `published` and whose `due` is filled.
   1. A date step counts the days from today to `due`.
   2. If it is between 0 and 2, Slack gets a message via `SLACK_WEBHOOK_URL` with title, status, owner and brief link.

## Who it's for

- **Content marketers** — blog, newsletter, social, video and podcast deadlines on Google Calendar instead of buried in a tab.
- **Growth teams** — track the target keyword per piece and see in one view which SEO articles are still in drafting.
- **Marketing ops** — one brief format and one status pipeline across writers, with no per-seat editorial tool.
- **Small agencies** — run a client's publishing plan with several owners and get a Slack warning before a deliverable slips.

## The problem

Monday planning goes well: a content calendar of twelve pieces typed into a sheet. By Wednesday the case study owner has forgotten it is due Thursday, because the date only lives in a cell. The newsletter brief is a Slack message, the blog brief does not exist yet. When the date slips, the sheet gets updated but not the calendar block, and the first reminder is the head of marketing asking where the post is.

## What it does

The template creates a **Content** database with one object, **Content items**. Key fields: `title`, `channel` (blog, newsletter, linkedin, x, youtube, podcast, case-study), `status` (idea to published, default idea), `owner`, `owner_email`, `due`, `topic`, `brief`, the workflow-filled links (`brief_url`, `calendar_event_id`, `calendar_link`) and `published_url`.

Four saved views:

- **Upcoming**: not published, by due date.
- **In review** and **Idea backlog**: one status each.
- **Published**: newest first, with `published_url`.

Three workflows (above) and one secret, `SLACK_WEBHOOK_URL`. Five sample items cover a blog post, a newsletter, a case study in review, a LinkedIn idea and a published webinar replay.

## Setup

1. Add the **Content** database to your workspace with **Import template** on the Databases page.
2. Connect your Google account for Google Calendar and Google Drive. Events go to your `primary` calendar.
3. Create a Slack incoming webhook for the channel where reminders should land, and save its URL as the secret `SLACK_WEBHOOK_URL`.
4. Replace or delete the sample items so events do not invite `example.com` guests.
5. Test with one item due in two days: check the event, the Drive file and the Slack message.
6. Activate the three workflows.

## Customize it

- Widen the reminder window from `[0, 2]` to `[0, 5]` days.
- Set `sendUpdates` to `all` so owners get a real invitation email.
- Swap `primary` for a shared "Editorial" calendar id.
- Add a `reviewer_email` field and a Gmail step that alerts the reviewer when status moves to `review`.
- Add a "LinkedIn" view filtered on `channel`.

## FAQ

### How do I sync a content calendar with Google Calendar automatically?

Import this template and connect Google: each new dated item creates an all-day event, and later edits update it. An item created without a due date never gets an event, even if you add the date later, because creation runs once. Set the date before saving.

### Can it create a content brief in Google Drive for each post?

Yes, a `Brief - <title>.md` file with outline, sources and call-to-action sections. Runbase only sees Drive files it created, so it cannot reuse existing briefs, and later record edits do not rewrite the file.

### Will it remind writers in Slack before a deadline?

Yes, on weekdays at 09:00 Paris time, for items due in 0 to 2 days and not scheduled or published. It posts to one channel through an incoming webhook, not as a direct message to each owner.

### Does deleting a content item remove the Calendar event?

No. None of the workflows listens for deletions, so the event and the Drive brief stay until you delete them by hand.

## Related templates

- [Weekly KPI report](https://getrunbase.com/templates/weekly-kpi-report) — a weekly summary of what shipped.
- [Newsletter signup](https://getrunbase.com/templates/newsletter-signup) — grow the audience the newsletter items in this calendar go to.
- [Client project tracker](https://getrunbase.com/templates/client-project-tracker) — track agency deliverables beyond content pieces.
