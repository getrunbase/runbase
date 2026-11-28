Every hour, this low stock alert reads your Google Sheets stock tab, posts each product that falls under its minimum to Slack, and drafts a purchase order for it. Once you approve the batch, every supplier gets a reorder email from your Gmail account with the SKU and quantity.

It replaces the Friday morning scroll through the stock sheet, and the reorder email typed from memory after the best seller has already sold out.

## Key benefits

- **No more surprise stockouts**: the sheet is checked 24 times a day, so a product that crosses its minimum at 3 pm is flagged before 4 pm.
- **One alert per shortage, not one per hour**: a product flagged as requested stays quiet until it is back above its minimum.
- **Reorders checked before they leave**: you fix a quantity or cancel a line before any supplier is emailed.

## How it works

1. **Schedule**: it runs at the top of every hour (`0 * * * *`).
2. **Read the sheet**: Google Sheets reads `Stock!A1:G501` with the first row as headers, so up to 500 product rows.
3. **Sync**: for each row, it upserts the supplier by `supplier_email` (with `supplier_name`), computes `margin` as `on_hand` minus `min_qty`, and upserts the product by `sku` with `name`, `on_hand`, `min_qty`, `reorder_qty`, the supplier link and the sync time.
4. **Clear restocked items**: products with `margin` of 0 or more and `reorder_status` = requested go back to ok.
5. **Find new shortages**: products with `margin` below 0 and `reorder_status` = ok (up to 100).
6. **For each shortage**: create a purchase order (`Reorder <reorder_qty> x <name>`, status pending_approval, tagged with the run id), set the product to requested, and post a Slack message through `SLACK_WEBHOOK_URL` with the SKU, units left, minimum, quantity and supplier.
7. **Approval**: the run pauses on a human approval step for up to 2 days.
8. **Approved**: each purchase order from this run still pending is emailed to its supplier from Gmail (subject `Purchase order: <quantity> x <sku>`), then marked sent with `sent_at`.
9. **Rejected or expired**: the purchase orders from this run still pending are set to cancelled.

## Who it's for

- **E-commerce ops managers** — see shortages in Slack without opening the stock sheet between orders.
- **Retail and wholesale buyers** — send consistent purchase orders to each supplier after one review instead of writing each email.
- **Founders of small product brands** — get inventory reorder automation without paying for an inventory suite.

## The problem

A tea shop tracks stock in a Google Sheet. Sencha drops from 60 to 14 tins on a busy Tuesday, but nobody opens the sheet until Friday. By then the shelf is empty, Greenleaf Teas needs ten days to ship, and the rushed reorder email asks for the wrong quantity.

## What it does

The workflow **Check stock levels and request reorders** runs on top of an **Inventory** database. Sample data adds two suppliers, three products and one pending order.

Three linked objects:

- **Suppliers**: email (unique), name, lead time in days.
- **Products**: SKU (unique), name, on hand, minimum, reorder quantity, units above minimum (`margin`), supplier link, reorder status (ok or requested) and last sync.
- **Purchase orders**: title, product link, SKU, quantity, supplier email, status (pending_approval, sent, cancelled, received), sent at, and the run that created it.

Four saved views come with it: **Below minimum** (products with a negative margin, worst first), **All stock** (every product by margin), **Awaiting approval** (purchase orders to review) and **Open orders** (sent orders, newest first).

Each run sends or cancels only its own orders. A cancelled product stays requested until you set it back to ok.

## Setup

1. Ask your AI agent to run `template.import`, or use **Import template** on the Databases page, to add the **Inventory** database.
2. In your Google Sheet, add a tab named `Stock` with these headers in row 1: `sku`, `name`, `on_hand`, `min_qty`, `reorder_qty`, `supplier_email`, `supplier_name`.
3. Connect your Google account in Runbase. It is used to read the sheet and to send the Gmail emails.
4. In the workflow's read step, replace `YOUR_SPREADSHEET_ID` with the ID from your sheet URL.
5. Create a Slack incoming webhook and save its URL as the secret `SLACK_WEBHOOK_URL`.
6. Edit the email text to replace `[your warehouse address]` and `[Your name]`.
7. Start a test run, check the Slack message and the **Awaiting approval** view, then approve to email a test supplier.
8. Activate the workflow.

## Customize it

- Change the schedule to `0 8 * * 1-5` for one check each weekday morning.
- Lower the approval timeout from `2d` to `4h` when suppliers need fast orders.
- Add the supplier's `lead_time_days` to the Slack message so the team sees the expected delay.

## FAQ

### How do I set up a low stock alert in Google Sheets?

Add a `Stock` tab with one row per product, its on-hand count and its minimum. Runbase reads the tab every hour and posts each product under its minimum to Slack. You keep updating the sheet as usual; Runbase does not write back to it.

### Can I send purchase orders to suppliers automatically from Gmail?

Yes, after one approval. The workflow drafts the orders, waits for you to approve, then sends one email per order from your connected Gmail account. Runbase cannot read your inbox, so set the order to received yourself when the supplier confirms.

### What happens if nobody approves the reorder?

After two days the pending orders from that run are cancelled and no email is sent. The products stay flagged as requested, so you are not spammed every hour. Set the reorder status back to ok to get a new alert.

## Related templates

- [Sheet Backup to Drive](https://getrunbase.com/templates/sheet-backup-drive) — keep dated copies of the stock sheet the alert relies on.
- [Weekly KPI Report](https://getrunbase.com/templates/weekly-kpi-report) — send stock and order numbers to the team each week.
- [Slack Lead Alert](https://getrunbase.com/templates/slack-lead-alert) — the same Slack alert pattern for new leads.
