// Reference workflows served by workflows.examples: each example is a full
// set (objects, webhook, functions, workflow definition) that follows
// WORKFLOWS_GUIDE. Checked by examples.test.ts against the real schemas.

export type WorkflowExample = {
  name: string;
  description: string;
  // Order to create them in: secrets, objects, webhooks, functions, workflow.
  secrets: string[];
  objects: {
    slug: string;
    name: string;
    fields: Record<string, unknown>[];
  }[];
  webhooks: {
    name: string;
    eventType: string;
    secretName: string;
    config: Record<string, unknown>;
  }[];
  functions: {
    name: string;
    code: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    permissions: {
      domains: string[];
      secrets: string[];
      records?: "read" | "write";
      events?: "read" | "write";
    };
    limits: { timeoutMs: number };
  }[];
  workflow: { name: string; definition: Record<string, unknown> };
};

const scoreLead = `export default async (input) => {
  const email = String(input.email ?? "").toLowerCase();
  if (!email.includes("@")) return { ok: false, error: "Invalid email: " + email };
  const domain = email.split("@")[1];
  const free = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"];
  const reasons = [];
  let score = 0;
  if (!free.includes(domain)) { score += 40; reasons.push("business_email"); }
  if (input.company_size >= 50) { score += 30; reasons.push("company_size"); }
  if (input.message && input.message.length > 80) { score += 20; reasons.push("detailed_request"); }
  return { score, reasons };
};`;

const fetchCompanyProfile = `export default async (input, { secrets }) => {
  const url = "https://api.peopledatalabs.com/v5/company/enrich?website=" + encodeURIComponent(input.domain);
  const res = await fetch(url, { headers: { "X-Api-Key": secrets.PDL_API_KEY } });
  if (res.status === 404) return { branch: "not_found" };
  if (!res.ok) return { ok: false, error: "Enrichment API returned " + res.status };
  const body = await res.json();
  return {
    branch: "found",
    industry: body.industry ?? null,
    employee_count: body.employee_count ?? null,
    country: body.location?.country ?? null,
  };
};`;

const postDigest = `export default async (input, { secrets, test }) => {
  const lines = input.deals.slice(0, 20).map((d) => "- " + d.data.name + ": " + d.data.amount + " EUR (" + d.data.stage + ")");
  const text = "Open pipeline: " + input.total + " EUR across " + input.deals.length + " deals\\n" + lines.join("\\n");
  if (test) return { posted: false, lines: lines.length };
  const res = await fetch(secrets.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) return { ok: false, error: "Slack returned " + res.status };
  return { posted: true, lines: lines.length };
};`;

export const WORKFLOW_EXAMPLES: WorkflowExample[] = [
  {
    name: "inbound-lead",
    description:
      "Inbound webhook to CRM: a signed form webhook upserts a contact by email, a function scores it, a condition routes it to sales_ready or nurture.",
    secrets: ["FORM_WEBHOOK_SECRET"],
    objects: [
      {
        slug: "contact",
        name: "Contact",
        fields: [
          {
            key: "email",
            label: "Email",
            type: "email",
            unique: true,
            title: true,
          },
          { key: "full_name", label: "Full name", type: "text" },
          { key: "company_size", label: "Company size", type: "number" },
          { key: "message", label: "Message", type: "text" },
          { key: "lead_score", label: "Lead score", type: "number" },
          {
            key: "stage",
            label: "Stage",
            type: "select",
            options: ["new", "sales_ready", "nurture"],
            default: "new",
          },
        ],
      },
    ],
    webhooks: [
      {
        name: "form-submissions",
        eventType: "form.submitted",
        secretName: "FORM_WEBHOOK_SECRET",
        config: {
          format: "hmac",
          header: "x-signature",
          prefix: "sha256=",
          idPath: "id",
        },
      },
    ],
    functions: [
      {
        name: "score-lead",
        code: scoreLead,
        inputSchema: {
          type: "object",
          properties: {
            email: { type: "string" },
            company_size: { type: "number" },
            message: { type: "string" },
          },
          required: ["email"],
        },
        outputSchema: {
          type: "object",
          properties: {
            score: { type: "number" },
            reasons: { type: "array", items: { type: "string" } },
          },
          required: ["score", "reasons"],
        },
        permissions: { domains: [], secrets: [] },
        limits: { timeoutMs: 5000 },
      },
    ],
    workflow: {
      name: "Score inbound leads",
      definition: {
        trigger: {
          type: "trigger.webhook",
          webhook: "form-submissions",
          object: "contact",
          match: "email",
          mapping: {
            email: "email",
            full_name: "name",
            company_size: "company.size",
            message: "message",
          },
        },
        concurrencyKey: "{{record.id}}",
        steps: [
          {
            id: "score",
            type: "fn.score-lead",
            input: {
              email: "{{record.email}}",
              company_size: "{{record.company_size}}",
              message: "{{record.message}}",
            },
          },
          {
            id: "save_score",
            type: "record.update",
            input: {
              recordId: "{{record.id}}",
              data: { lead_score: "{{steps.score.output.score}}" },
            },
          },
          {
            id: "is_qualified",
            type: "condition",
            input: {
              left: "{{steps.score.output.score}}",
              op: "gte",
              right: 60,
            },
          },
          {
            id: "mark_sales_ready",
            type: "record.update",
            input: {
              recordId: "{{record.id}}",
              data: { stage: "sales_ready" },
            },
          },
          {
            id: "mark_nurture",
            type: "record.update",
            input: { recordId: "{{record.id}}", data: { stage: "nurture" } },
          },
        ],
        next: {
          score: { ok: ["save_score"] },
          save_score: { ok: ["is_qualified"] },
          is_qualified: { true: ["mark_sales_ready"], false: ["mark_nurture"] },
        },
      },
    },
  },
  {
    name: "company-enrichment",
    description:
      "Enrichment pipeline with an external API: each new company is enriched by domain through one function (explicit domain, declared secret, found/not_found branches, retry on API errors), then a native step writes the fields.",
    secrets: ["PDL_API_KEY"],
    objects: [
      {
        slug: "company",
        name: "Company",
        fields: [
          {
            key: "domain",
            label: "Domain",
            type: "text",
            unique: true,
            title: true,
          },
          { key: "industry", label: "Industry", type: "text" },
          { key: "employee_count", label: "Employee count", type: "number" },
          { key: "country", label: "Country", type: "text" },
          {
            key: "enrichment_status",
            label: "Enrichment status",
            type: "select",
            options: ["pending", "enriched", "not_found"],
            default: "pending",
          },
        ],
      },
    ],
    webhooks: [],
    functions: [
      {
        name: "fetch-company-profile",
        code: fetchCompanyProfile,
        inputSchema: {
          type: "object",
          properties: { domain: { type: "string" } },
          required: ["domain"],
        },
        outputSchema: {
          type: "object",
          properties: {
            branch: { type: "string", enum: ["found", "not_found"] },
            industry: { type: ["string", "null"] },
            employee_count: { type: ["number", "null"] },
            country: { type: ["string", "null"] },
          },
          required: ["branch"],
        },
        permissions: {
          domains: ["api.peopledatalabs.com"],
          secrets: ["PDL_API_KEY"],
        },
        limits: { timeoutMs: 10000 },
      },
    ],
    workflow: {
      name: "Enrich new companies",
      definition: {
        trigger: { type: "trigger.record_created", object: "company" },
        steps: [
          {
            id: "fetch_profile",
            type: "fn.fetch-company-profile",
            input: { domain: "{{record.domain}}" },
            timeout: "15s",
            retry: { attempts: 3, backoff: "5s" },
          },
          {
            id: "save_profile",
            type: "record.update",
            input: {
              recordId: "{{record.id}}",
              data: {
                industry: "{{steps.fetch_profile.output.industry}}",
                employee_count: "{{steps.fetch_profile.output.employee_count}}",
                country: "{{steps.fetch_profile.output.country}}",
                enrichment_status: "enriched",
              },
            },
          },
          {
            id: "mark_not_found",
            type: "record.update",
            input: {
              recordId: "{{record.id}}",
              data: { enrichment_status: "not_found" },
            },
          },
        ],
        next: {
          fetch_profile: {
            found: ["save_profile"],
            not_found: ["mark_not_found"],
          },
        },
      },
    },
  },
  {
    name: "weekly-digest",
    description:
      "Scheduled digest: every Monday at 08:00 (time zone set), native steps search open deals and sum their amount, one function formats and posts the digest to Slack (skips the post in test runs).",
    secrets: ["SLACK_WEBHOOK_URL"],
    objects: [
      {
        slug: "deal",
        name: "Deal",
        fields: [
          { key: "name", label: "Name", type: "text", title: true },
          { key: "amount", label: "Amount", type: "currency", currency: "EUR" },
          {
            key: "stage",
            label: "Stage",
            type: "select",
            options: ["open", "negotiation", "won", "lost"],
          },
        ],
      },
    ],
    webhooks: [],
    functions: [
      {
        name: "post-pipeline-digest",
        code: postDigest,
        inputSchema: {
          type: "object",
          properties: { deals: { type: "array" }, total: { type: "number" } },
          required: ["deals", "total"],
        },
        outputSchema: {
          type: "object",
          properties: {
            posted: { type: "boolean" },
            lines: { type: "number" },
          },
          required: ["posted", "lines"],
        },
        permissions: {
          domains: ["hooks.slack.com"],
          secrets: ["SLACK_WEBHOOK_URL"],
        },
        limits: { timeoutMs: 10000 },
      },
    ],
    workflow: {
      name: "Weekly pipeline digest",
      definition: {
        trigger: {
          type: "trigger.schedule",
          cron: "0 8 * * 1",
          timezone: "Europe/Paris",
        },
        steps: [
          {
            id: "open_deals",
            type: "record.search",
            input: {
              object: "deal",
              filter: {
                field: "stage",
                op: "in",
                value: ["open", "negotiation"],
              },
              limit: 500,
            },
          },
          {
            id: "pipeline_total",
            type: "list.aggregate",
            input: {
              items: "{{steps.open_deals.output.records}}",
              op: "sum",
              path: "data.amount",
            },
          },
          {
            id: "post_digest",
            type: "fn.post-pipeline-digest",
            input: {
              deals: "{{steps.open_deals.output.records}}",
              total: "{{steps.pipeline_total.output.value}}",
            },
          },
        ],
        next: {
          open_deals: { found: ["pipeline_total"] },
          pipeline_total: { ok: ["post_digest"] },
        },
      },
    },
  },
];
