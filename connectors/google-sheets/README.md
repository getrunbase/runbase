# @getrunbase-connectors/google-sheets

Read rows, add rows and update cells in Google Sheets.

Uses the shared **Google** connection: connecting a Google account once covers
Gmail, Google Calendar, Google Sheets and Google Drive. Setup, scopes and the
OAuth client: [Connect Google](https://getrunbase.com/docs/guides/google).

Scopes: `spreadsheets` and `drive.file` (files picked with "Choose in Drive",
the Google Picker: set `GOOGLE_PICKER_API_KEY` and `GOOGLE_PICKER_APP_ID`).
The tab and column fields of a step are filled from the sheet.

See `index.ts` for the nodes. License: MIT. Logo: © Google, from the selfhst icons (CC BY 4.0).
