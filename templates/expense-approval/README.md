Every expense claim your team files becomes a Slack alert for the manager, a one-click decision in Runbase, a row in your finance Google Sheet, a memo in Google Drive and a Gmail reply to the employee. First, AI checks it against your policy in one sentence.

It replaces the receipt forwarded in a DM, the "did you approve this?" thread and the Friday spreadsheet catch-up, with one expense approval workflow that runs the same way for every claim.

## Key benefits

- **Policy checked before the manager opens it**: the AI flags a 72 per person dinner or a missing receipt link, and names the broken rule.
- **The finance sheet fills itself**: each approved claim lands as a new row in the Expenses tab.
- **A paper trail per expense**: every approval leaves a text memo in your Drive folder, and its link is saved on the expense record for audits.
- **Employees know where they stand**: approved or rejected, they get an email with the manager in copy, and the rejection quotes the policy reason.

## How it works

The workflow **Check, approve, log and archive expenses** runs when a record is created in Expenses.

1. **Trigger**: a new Expenses record (form, Runbase page, CSV import or MCP agent).
2. **AI policy check** (`ai.decide`): the claim is read against the policy in the prompt. Rules include meals up to 60 per person, hotels up to 180 per night, a receipt link and submission within 60 days. It returns `within_policy` or `out_of_policy` plus a reason.
3. **Save the result**: `policy_check` and `policy_note` are written on the record.
4. **Slack alert**: a message goes to the channel behind `SLACK_WEBHOOK_URL` with the claim details, policy result and receipt link.
5. **Human approval**: the run pauses until someone approves or rejects in Runbase. After 7 days with no decision, the step times out.
6. **If approved**:
   - a row is appended to the `Expenses` range of your finance Google Sheet;
   - a `.txt` memo is uploaded to your Google Drive expenses folder;
   - the record is set to `approved` and `archive_link` gets the Drive link;
   - Gmail sends "Expense approved: ..." to the employee, manager in CC.
7. **If rejected**: status becomes `rejected` and Gmail sends "About your expense: ..." with the policy note, manager in CC.

## Who it's for

- **Ops managers** — one queue of claims waiting for approval instead of a dozen chat threads.
- **Finance leads** — a Google Sheet ledger and a Drive archive that stay complete without manual entry.
- **Founders** — spend control without a spend management suite.
- **Marketing and growth leads** — event and software spend checked against limits before it hits the budget.

## The problem

Maya takes the Northwind team to dinner and sends the receipt to her manager on Slack. Priya buys a 720 USD design license and mentions it in a standup. Tom expenses a headset but never attaches the receipt. Three weeks later, finance asks who approved what, and nobody can say whether the dinner fit the meal limit.

The spreadsheet is updated in batches, receipts live in inboxes, and employees chase managers about reimbursements.

## What it does

- **Database**: Finance, with one object, **Expenses**: description (title), employee, employee email, manager email, category (travel, meals, software, equipment, events, training, other), amount, currency (EUR, USD, GBP, CHF), spent on, vendor, receipt link, policy check, policy note, status (submitted, approved, rejected), Drive archive.
- **Saved views**: Waiting for approval (status submitted, oldest first), Out of policy (flagged claims with their note), Approved expenses (with archive link), All expenses.
- **Sample data**: five claims, including a within-policy client dinner, an out-of-policy software license, and a rejected headset with no receipt.
- **Secret**: `SLACK_WEBHOOK_URL`, used to ping approvers.

## Setup

1. Import the template; it sets up the **Finance** database and its workflows in one step.
2. Connect your Google account in Connections, so the Gmail, Google Sheets and Google Drive steps can run.
3. Create a Slack incoming webhook and save it as the secret `SLACK_WEBHOOK_URL`.
4. In the `log` step, replace `YOUR_FINANCE_SHEET_ID` with your sheet ID. Add a tab named `Expenses`.
5. In the `archive` step, replace `YOUR_EXPENSES_FOLDER_ID` with the ID of your Drive folder.
6. Pick an AI provider (none is set by default) and edit the `policy` prompt to your limits.
7. Create a test expense, approve it in Runbase, and check the sheet row, the Drive memo and the email.
8. Activate the workflow.

## Customize it

- Raise the meal limit to 80 by editing the `policy` prompt.
- Skip the human step for claims under 50 that are within policy, with a condition before `approve`.
- Change `timeout` on the approval step from `7d` to `3d` to push faster decisions.
- Add a "Training" view filtered on category to track the learning budget.
- Post the decision back to Slack after `confirm` and `decline` with another Slack step.

## FAQ

### How do I set up an expense approval workflow with Google Sheets?

Each approved expense is appended as a row in the `Expenses` tab. Rejected claims stay only in Runbase.

### Can managers approve expenses directly from Slack?

Not in this version. The Slack message is a notification only: the decision is made in Runbase or through MCP.

### Can AI check expense claims against company policy?

Yes, the `ai.decide` step reads each claim and returns within or out of policy with a reason. It sees only record fields, never the receipt file itself. The manager still makes the final call.

### What happens if the manager never answers?

The approval step waits 7 days, then times out and the run stops. The claim stays in the Waiting for approval view, so you can follow up or resubmit it.

## Related templates

- [PTO Request Approval](https://getrunbase.com/templates/pto-request-approval) — the same manager approval pattern, for time off.
- [Invoice Archive to Drive](https://getrunbase.com/templates/invoice-archive-drive) — file supplier invoices in Drive automatically.
- [Quote Approval](https://getrunbase.com/templates/quote-approval) — get sign-off on discounts before a quote goes out.
