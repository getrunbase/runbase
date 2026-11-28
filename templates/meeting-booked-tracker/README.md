Every demo your reps put in Google Calendar becomes a row in one sales meeting tracker: who booked it, which prospect is coming, and whether it was held or cancelled. Every Monday the week's totals per rep go into a Google Sheet, and a ranked scoreboard goes to Slack.

No more hand-logged demos, and no more Monday count guessed from calendars.

## Key benefits

- **No manual logging**: reps keep booking in Google Calendar and the daily sync records each demo.
- **Held versus booked, not just booked**: cancelled and fully declined demos are counted apart, so they never inflate the total.
- **A weekly history that builds itself**: one row per rep lands in the sheet every Monday, ready for quarterly show-rate trends.
- **Public accountability in Slack**: reps are ranked by held meetings where the whole team reads them.

## How it works

The sales meeting tracker runs two scheduled workflows.

**Sync sales meetings from Google Calendar** (every day at 6:00, cron `0 6 * * *`):

1. Two date steps compute a window from 14 days ago to 30 days ahead.
2. Google Calendar `list_events` reads the `primary` calendar in that window, keeping events that match the search text `demo` (up to 250).
3. A loop runs over each event (limit 250):
   - `meeting-fields` sets the rep (first attendee on `yourcompany.com`), the prospect domain (first outside attendee) and the status: `cancelled` if the event is cancelled or all outside guests declined, `held` once it ended, else `booked`.
   - A record upsert matched on `event_id` saves the meeting, so re-runs never duplicate.

**Publish the weekly meeting scoreboard** (Mondays at 8:00, cron `0 8 * * 1`):

1. Date steps build a `YYYY-MM-DD` week label from seven days ago.
2. A record search loads meetings with `start` within the last 7 days (up to 500), continuing even if none.
3. `build-scoreboard` counts per rep booked (not cancelled), held and cancelled, plus show rate (held / booked), ranked by held.
4. Google Sheets `append_rows` adds the rows (Week, Rep, Booked, Held, Cancelled, Show rate) to the `Scoreboard` range of your spreadsheet.
5. Slack posts the scoreboard text through the `SLACK_WEBHOOK_URL` incoming webhook.

## Who it's for

- **RevOps managers** — get a trustworthy held-meetings metric per rep without per-seat analytics tools.
- **Sales managers** — start Monday one-on-ones with each rep's numbers ready.
- **Founders selling themselves** — see whether outbound produces demos that happen, not just invites.

## The problem

Monday, 9:00: the sales lead needs last week's demo count. Half the reps logged calls in the CRM, one logged them twice, and nobody marked Wednesday's cancelled Globex demo. The slide says "around 14", and nobody knows how many actually happened.

Meeting analytics tools fix this but bill per seat and keep the data in their dashboard. Here the raw list stays in your workspace and totals go to a sheet and channel you already use.

## What it does

The import creates a **Sales meetings** database with one object, **Meetings**:

- `title` (text, record title), `event_id` (Calendar event id, unique), `rep` (email), `attendee_domain` (prospect domain), `start` (date), `status` (select: booked, held, cancelled), `link` (Calendar link).

Four saved views:

- **Upcoming meetings**: status booked, soonest first.
- **Held this week**: held meetings that started within the last 7 days.
- **Cancelled meetings**: most recent first.
- **Meetings by rep**: sorted by rep, then latest start.

Functions `meeting-fields` and `build-scoreboard` hold the logic; both workflows are described above.

Five sample meetings for three reps cover held, cancelled and booked demos.

## Setup

1. Install the template from the Databases page (**Import template**) to get the **Sales meetings** database.
2. Connect your Google account so the workflows can read Google Calendar and write to Google Sheets.
3. In the sync workflow, replace `yourcompany.com` in the `fields` step with your company email domain. Change the `q` search text if your demos are not titled with "demo".
4. Create a Google Sheet with a tab named `Scoreboard` and a header row: Week, Rep, Booked, Held, Cancelled, Show rate. Paste its id in place of `YOUR_SPREADSHEET_ID` in the `sheet` step.
5. Store a Slack incoming webhook URL as the secret `SLACK_WEBHOOK_URL`.
6. Test-run both workflows, check the Upcoming meetings view, the sheet row and the Slack message, then activate them.

## Customize it

- Look back 60 days by changing `amount: -14` in the `since` step.
- Read a shared team calendar instead of each rep's own by replacing `primary` with its calendar id.
- Add a `source` select field (inbound, outbound) and a view per source.
- Post the scoreboard on Friday afternoon instead by changing the cron to `0 16 * * 5`.

## FAQ

### How do I track booked meetings per sales rep from Google Calendar?

Import this template, connect Google and set your company domain. The daily sync assigns each "demo" event to the first attendee on your domain. For a shared calendar, swap `primary` for its id.

### Does it know if the prospect actually showed up?

Not directly. Google Calendar does not report attendance, so a meeting counts as held once it ends, unless cancelled or declined by every outside guest. Mark real no-shows as cancelled by hand.

### What happens when a demo is deleted from the calendar?

Deleted events are not returned by the listing, so the record keeps its last status: set it to cancelled by hand. Events cancelled rather than deleted update automatically within the 14-day lookback.

### Can I send a weekly sales meeting report to Google Sheets and Slack automatically?

Yes. Every Monday at 8:00 the second workflow appends one row per rep to your Scoreboard tab and posts a ranked summary to Slack. Change the cron to move it.

## Related templates

- [No-show follow-up](https://getrunbase.com/templates/no-show-follow-up) — email prospects who missed the demo the tracker counted as cancelled.
- [Post-meeting follow-up](https://getrunbase.com/templates/post-meeting-follow-up) — send a recap after each held demo.
- [Weekly KPI report](https://getrunbase.com/templates/weekly-kpi-report) — put meetings held next to pipeline and revenue in one Monday digest.
