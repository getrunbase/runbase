Every new lead lands in a Runbase table, gets a hot, warm or cold tier from AI with a one-line reason, and only the hot ones trigger a Slack lead alert for your sales team. Warm and cold leads get a polite nurture email sent from your Gmail account, so nobody is left without a reply.

It replaces the muted "new sign-up" channel and the morning spent sorting form fills by hand.

## Key benefits

- **A Slack channel reps actually read**: only leads the AI tags hot post a message, so a demo request from a VP is not buried under students and newsletter readers.
- **Context in the alert itself**: title, company, size, source, the lead's message and the AI's reason, so a rep can call right away.
- **No lead left unanswered**: warm and cold leads get a Gmail reply within seconds of being created instead of silence.
- **Scoring you can read and edit**: tier, AI confidence and "Why this tier" are stored on each record, and the rules live in one plain-English prompt.

## How it works

The workflow **Score new leads and alert Slack on hot ones** runs these steps:

1. **Trigger**: a record is created in the **Leads** object.
2. **score** (AI decision): a prompt defines hot (clear buying intent, decision maker or team lead, company of 11+ people), warm (good fit, no clear intent) and cold (student, competitor, personal email, no real need). It returns a branch, a reason and a confidence.
3. **Hot branch**: **mark-hot** sets `tier` to hot, `score` to the confidence, `score_reason` to the reason and `status` to alerted. Then **alert** posts the lead details and reason to Slack through `SLACK_WEBHOOK_URL`.
4. **Warm or cold branch**: **mark-warm** or **mark-cold** stores the tier, score and reason, and sets `status` to nurturing.
5. **nurture** (warm and cold only): Gmail sends "Thanks for reaching out, {name}" to the lead's `email`.

## Who it's for

- **SDR and sales leads** — reps see the few leads worth a call today, with the reason already written.
- **RevOps** — one editable prompt replaces a points-based lead scoring model that takes a quarter to tune.
- **Growth and marketing teams** — every form fill, webinar sign-up or guide download gets a tier you can count per source.
- **Founders who still sell** — real buyers ping your phone, everyone else gets a reply.

## The problem

Your demo form, webinar tool and content downloads all feed one Slack channel. On Tuesday it shows twenty-three sign-ups: a student, two competitors, a dozen ebook readers, and one Head of Operations who wrote "we run dispatch on three spreadsheets and want a demo this week." By the time someone finds her, she has booked another vendor.

The other twenty-two never hear back at all.

## What it does

- **Database and object**: an **Inbound leads** database with a **Leads** object. Fields: Name, Email (unique), Company, Job title, Company size (1-10 to 1000+), Source (website form, demo request, content download, webinar, referral, other), Message, Tier (hot, warm, cold), AI confidence, Why this tier, and Status (new, alerted, nurturing, contacted, disqualified).
- **Saved views**: **Hot leads to call** (tier is hot), **In nurture** (status is nurturing) and **All leads by tier**.
- **Secret**: `SLACK_WEBHOOK_URL`, the channel that receives each lead.
- **Sample data**: four leads covering each path, two hot, one warm, one cold. Delete them when you go live.

## Setup

1. Ask your AI agent to run `template.import`, or use **Import template** on the Databases page, to add the **Inbound leads** database.
2. In Slack, create an incoming webhook for the channel that should receive hot leads, and save its URL as the secret `SLACK_WEBHOOK_URL`.
3. Connect your Google account so the **nurture** step can send from Gmail.
4. Make sure an AI provider is configured in your workspace, because the **score** step needs one. Runbase does not pick one for you.
5. Send leads in: a Runbase page form, an inbound webhook, a CSV import or your agent through MCP.
6. Create one test lead with your own email, a demo-request source and a clear need. Check Slack, then try a weak lead and check Gmail.
7. Activate the workflow.

## Customize it

- Rewrite the **score** prompt with your ideal customer profile: target industries, minimum company size, titles that count as buyers.
- Split **nurture** into two Gmail steps so warm leads get a case study and cold leads a lighter note.
- Add a Slack step after **mark-warm** that posts warm leads to a separate `#warm-leads` webhook.
- Add a view that filters `tier` is hot and `status` is alerted, so you see hot leads nobody has contacted yet.
- Mention a rep in the alert text, for example `<@U123>`.

## FAQ

### How do I send a Slack alert for new leads only when they are qualified?

Only the hot branch of the AI step reaches Slack, so warm and cold leads never post. You control what "qualified" means by editing the prompt.

### Can AI score leads automatically without a paid lead scoring tool?

Yes. The AI step reads the full record and returns a tier, a confidence and a reason. Cost depends on your AI provider. It only sees what is in the record and does not research the company.

### Will leads get an automatic reply from my Gmail?

Warm and cold leads do, from the connected Google account. Hot leads get none, since a rep reaches out personally. Runbase cannot read your inbox, so replies to the nurture email do not update the lead's status; set it to contacted by hand or from another workflow.

### Does it work with leads I already have?

No, the trigger fires on record creation only. A CSV import creates new records, so each row is scored and may get an email. Test with a few rows first.

## Related templates

- [Lead Capture to Sheets](https://getrunbase.com/templates/lead-capture-to-sheets) — capture form leads and mirror them to Google Sheets.
- [Gmail Follow-up Sequence](https://getrunbase.com/templates/gmail-follow-up-sequence) — turn the single nurture email into a timed series.
- [CRM Light](https://getrunbase.com/templates/crm-light) — track hot leads through deals once a rep picks them up.
