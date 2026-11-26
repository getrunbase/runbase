# @getrunbase-connectors/google

Send Gmail emails, manage Google Calendar events, read and write Google Sheets,
upload files to Google Drive.

## Nodes

- `node.gmail.send`: send an email from the connected account (text, html or
  both; reply in a thread with `threadId` and `inReplyTo`).
- `node.google_calendar.list_events`: events between two dates, recurring
  events expanded.
- `node.google_calendar.create_event`: create an event (all-day with
  `YYYY-MM-DD`, attendees, optional Google Meet link).
- `node.google_calendar.update_event`: change some fields of an event.
- `node.google_calendar.delete_event`: delete an event.
- `node.google_sheets.read_rows`: read a range, rows keyed by the header row.
- `node.google_sheets.append_rows`: add rows, objects matched to the header row
  by column name.
- `node.google_sheets.update_rows`: overwrite a range.
- `node.google_drive.upload_file`: create a file from text or base64 content.

## Setup

Pick or connect a Google account in the step's **Account** field (or in
**Settings › Connections**). One connection covers every node.

Scopes requested: `openid`, `email`, `gmail.send`, `calendar.events`,
`spreadsheets`, `drive.file`. None of them needs a Google security assessment.
Reading the mailbox and full Drive access are not included.

### Self-hosting

1. In the [Google Cloud console](https://console.cloud.google.com/), create a
   project and enable the Gmail, Google Calendar, Google Sheets and Google Drive
   APIs.
2. Configure the OAuth consent screen with the scopes above. In **Testing**
   status, add your users as test users.
3. Create an OAuth client of type **Web application** with the redirect URI
   `<BETTER_AUTH_URL>/api/connections/callback`.
4. Set `OAUTH_GOOGLE_CLIENT_ID` and `OAUTH_GOOGLE_CLIENT_SECRET`.

## Development

```sh
pnpm test        # unit tests, HTTP mocked
pnpm runbase node test connectors/google
```

License: MIT.
