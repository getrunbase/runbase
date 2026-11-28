Every new quote with a discount above 15% stops in Slack until a manager approves it. Once it clears, Runbase saves the quote as a file in Google Drive, emails it to the buyer from your Gmail account and stamps the Drive link on the record. Quotes at 15% or less skip the queue. This quote approval workflow keeps every discount decision on record.

It replaces the "can I do 25% here?" thread answered two days late.

## Key benefits

- **No unapproved discounts leave the building**: a quote above 15% cannot reach the buyer until a manager clicks approve in Runbase.
- **Small discounts never wait**: quotes at 15% or less go straight to the buyer.
- **Finance finds the sent version**: each sent quote carries its Google Drive link, so nobody digs through a rep's laptop for the file the customer saw.
- **Stalled approvals do not hang forever**: after 3 days without a decision, the quote is marked rejected and the rep is told in Slack to revise it.

## How it works

The workflow **Approve discounts and send quotes** runs on every new Quotes record.

1. **Trigger**: a record is created in Quotes.
2. **Check the discount**: a condition tests `discount_pct > 15`.
3. **If above 15%**: `status` is set to `pending_approval`.
4. **Ask in Slack**: a message posts to the channel behind `SLACK_WEBHOOK_URL` with the quote number, company, sales rep, list price, discount, net price, currency and `discount_reason`.
5. **Wait for a decision**: a human approval step pauses the run for up to 3 days. Approved continues to step 6. Rejected or expired goes to step 9.
6. **Save to Drive** (also the direct path for discounts of 15% or less): Google Drive creates an HTML file named `Quote <number> - <company>.html` in your quotes folder, with buyer, line items, list price, discount, total and validity date.
7. **Email the buyer**: Gmail sends to `buyer_email` a message with the line items, net price, `valid_until` and the Drive link, signed with the sales rep's name.
8. **Mark as sent**: `status` becomes `sent` and `drive_link` stores the file's link.
9. **On rejection or timeout**: `status` becomes `rejected` and a second Slack message asks the rep to revise the discount and create a new quote.

## Who it's for

- **Sales managers** — approve or refuse a discount from one Slack ping that already shows the price, the cut and the rep's reason.
- **RevOps** — enforce one discount threshold in a single condition instead of a policy doc nobody rereads.
- **Finance** — open the exact file each buyer received.

## The problem

Jordan, an account executive, needs 20% off a 30,000 EUR annual plan to beat a competing offer. He messages his manager on Friday afternoon, gets no answer, and on Monday the buyer asks if the offer still stands. Either Jordan sends it anyway and margin leaks, or he waits and the deal cools.

The quote itself lives in a document on Jordan's laptop. Finance cannot find the version Elena at Northwind received. CPQ tools fix this, but take weeks to set up for one rule and one approval.

## What it does

The template creates a **Quotes** database with two linked objects:

- **Deals**: title, company, owner, amount and a stage (qualified, proposal, negotiation, won, lost).
- **Quotes**: a unique quote number, a link to the deal, company, buyer name and email, sales rep, line items, list price, discount (0 to 100%), net price, currency (EUR, USD, GBP), valid until, discount reason, status (draft, pending_approval, rejected, sent, accepted, declined) and Drive link.

Four saved views come with it:

- **Waiting for approval**: pending quotes, biggest discount first.
- **Sent quotes**: sent quotes, closest expiry first, with the Drive link.
- **High discounts**: every quote above 15%, whatever its status.
- **Open deals**: deals in qualified, proposal or negotiation, by amount.

The sample data holds two deals and three quotes for Northwind Logistics and Brightpath Health: one pending at 20%, one sent at 10% and one rejected at 35%.

## Setup

1. Install the template from the Databases page (**Import template**) to get the **Quotes** database.
2. Connect your Google account so the Gmail and Google Drive steps can run. Gmail sends from that address, and Runbase only sees the Drive files it creates.
3. In Slack, create an Incoming Webhook for your approvals channel and save its URL as the secret `SLACK_WEBHOOK_URL`.
4. Create a Drive folder for quotes, copy its ID from the URL and replace `YOUR_QUOTES_FOLDER_ID` in the **Save to Drive** step.
5. Test it: create a quote at 20% with your own email as `buyer_email`, approve it in Runbase, then check Slack, Drive and your inbox.
6. Activate the workflow.

## Customize it

- Change the threshold by editing `15` in the condition step, for example to 10% for a tighter policy.
- Shorten the approval window from `3d` to `1d` for fast-moving deals.
- Edit the Drive step's HTML to add your logo or payment terms.
- Add a Slack step after **Mark as sent** to tell the rep the quote went out.

## FAQ

### How do I set up a quote approval workflow with Slack?

Import this template, save a Slack Incoming Webhook URL as `SLACK_WEBHOOK_URL` and activate the workflow. Slack receives the approval request, but the approve or reject decision is made in Runbase, since an Incoming Webhook only posts messages and cannot carry buttons back.

### Can I require manager approval for discounts above a certain percentage?

Yes. The condition step compares `discount_pct` to 15, and only quotes above it pause for approval. Change the number to match your policy.

### Can I email quotes automatically from Gmail?

Yes. Once a quote is approved, or if it needs no approval, Gmail sends it from your connected account to `buyer_email` with the Drive link. Runbase cannot read your inbox, so the buyer's reply and acceptance must be recorded by hand by setting the status to `accepted` or `declined`.

## Related templates

- [Expense Approval](https://getrunbase.com/templates/expense-approval) — the same manager-approval pattern applied to spending.
- [Invoice Payment Reminders](https://getrunbase.com/templates/invoice-payment-reminders) — follow up once accepted quotes become invoices.
- [CRM Light](https://getrunbase.com/templates/crm-light) — a fuller pipeline to sit next to these deals.
