import { slugify } from "../lib/slug";
// Mock data for the examples (fictional CRM: companies, deals, timeline): deterministic, dated relative
// to now so that screenshots stay credible.
const DAY = 86_400_000;
// Record ids in uuid format (as in real use: record, update, delete and
// timeline require a uuid). c/p/d/m/e prefix kept in the last group.
const uid = (kind: string, n: number) =>
  `00000000-0000-4000-8000-${(kind.charCodeAt(0).toString(16) + String(n).padStart(10, "0")).slice(0, 12)}`;
export const COMPANY_1 = uid("c", 1);

export function seed(now = Date.now()) {
  let s = 42;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
  const iso = (t: number) => new Date(t).toISOString();
  const rec = <T extends object>(
    objectId: string,
    id: string,
    data: T,
    ago = 0,
  ) => ({
    id,
    objectId,
    data,
    createdAt: iso(now - ago),
  });

  const names = [
    ["Aurora Energy", "Energy", "Lyon"],
    ["Nordlys Logistics", "Logistics", "Lille"],
    ["Mistral Works", "Manufacturing", "Marseille"],
    ["Saint Roch Clinic", "Healthcare", "Montpellier"],
    ["Mist Studio", "Media", "Paris"],
    ["Bright Farm", "Food", "Rennes"],
    ["Okapi Insurance", "Insurance", "Nantes"],
    ["Helio Mobility", "Transport", "Bordeaux"],
  ] as const;
  const companies = names.map(([name, industry, city], i) =>
    rec(
      "companies",
      uid("c", i + 1),
      {
        name,
        status: i < 3 ? "Customer" : "Prospect",
        industry,
        city,
        domain: slugify(name, { separator: "-" }) + ".com",
        employees: [420, 1200, 85, 310, 24, 60, 900, 150][i],
        revenue: [
          38_000_000, 140_000_000, 9_500_000, 41_000_000, 2_100_000, 6_800_000,
          210_000_000, 17_000_000,
        ][i],
        founded: String([2009, 1998, 2015, 1987, 2019, 2012, 1974, 2016][i]),
        since: i < 3 ? iso(now - (420 + i * 200) * DAY) : null,
      },
      400 * DAY,
    ),
  );

  const owners = [
    "Camille Martin",
    "Hugo Bernard",
    "Nina Petit",
    "Yanis Robert",
    "Chloe Durand",
  ];
  const products = [
    "Pro License",
    "Rollout",
    "Audit",
    "Premium Support",
    "Extension",
    "Training",
    "Renewal",
  ];
  const stages = [
    "lead",
    "qualified",
    "proposal",
    "negotiation",
    "won",
    "lost",
  ];
  const deals = Array.from({ length: 64 }, (_, i) => {
    const c = i < 6 ? companies[0]! : pick(companies);
    const stage =
      i < 6
        ? stages[i]!
        : rnd() < 0.55
          ? pick(stages.slice(4))
          : pick(stages.slice(0, 4));
    const closed = stage === "won" || stage === "lost";
    // Visible growth: more deals won recently.
    const age = Math.floor(Math.pow(rnd(), 1.4) * 360);
    return rec(
      "deals",
      uid("d", i + 1),
      {
        name: `${pick(products)} ${c.data.name.split(" ")[0]}`,
        company: c.id,
        company_name: c.data.name,
        stage,
        amount: Math.round((4 + rnd() * 90) * 10) * 100,
        owner: pick(owners),
        close_date: iso(now + Math.round((rnd() * 60 - 15) * DAY)),
        closed_at: closed ? iso(now - age * DAY) : null,
      },
      (age + 20) * DAY,
    );
  });

  const ev = (h: number, type: string, payload: object) => ({
    id: uid("e", h),
    recordId: COMPANY_1,
    type,
    payload,
    occurredAt: iso(now - h * 3_600_000),
  });
  const timeline = {
    [COMPANY_1]: [
      ev(500, "meeting.done", {
        title: "Scoping workshop",
        body: "Scope approved with IT and procurement. 3 pilot sites.",
        by: "Camille Martin",
      }),
      ev(330, "email.sent", {
        title: "Commercial proposal v2 sent",
        by: "Camille Martin",
      }),
      ev(260, "call.logged", {
        title: "Call with Paul Garnier (CFO)",
        body: "Budget confirmed for the current fiscal year, waiting on the committee.",
        by: "Hugo Bernard",
      }),
      ev(140, "stage.changed", {
        title: "Renewal Aurora → negotiation",
        by: "Camille Martin",
      }),
      ev(76, "note.added", {
        title: "Note",
        body: "Competitor in the running for phase 2, stress Premium support and rollout time.",
        by: "Nina Petit",
      }),
      ev(50, "email.received", {
        title: "Reply from Lea Fontaine",
        body: "The committee approved the budget. We'd like to start with the Lyon site.",
      }),
      ev(28, "meeting.planned", {
        title: "Steering committee",
        body: "Thursday 10am, video call. Agenda: schedule and pilot phase.",
        by: "Camille Martin",
      }),
      ev(5, "email.sent", {
        title: "Commercial proposal v3 sent",
        by: "Camille Martin",
      }),
      ev(2, "call.logged", {
        title: "Quick sync with Ines Haddad",
        body: "Positive feedback on v3, signature targeted for month end.",
        by: "Camille Martin",
      }),
    ],
  };

  const f = (key: string, label: string, type: string, extra = {}) => ({
    key,
    label,
    type,
    ...extra,
  });
  const objects = {
    companies: {
      id: "companies",
      slug: "companies",
      name: "Companies",
      fields: [
        f("name", "Name", "text", { title: true }),
        f("status", "Status", "select", { options: ["Prospect", "Customer"] }),
        f("industry", "Industry", "text"),
        f("city", "City", "text"),
        f("employees", "Employees", "number"),
        f("revenue", "Annual revenue (€)", "number"),
        f("founded", "Founded", "text"),
        f("since", "Customer since", "date"),
      ],
    },
    deals: {
      id: "deals",
      slug: "deals",
      name: "Deals",
      fields: [
        f("name", "Name", "text", { title: true }),
        f("stage", "Stage", "select", { options: stages }),
        f("amount", "Amount", "number"),
        f("owner", "Owner", "text"),
        f("close_date", "Expected close", "date"),
        f("closed_at", "Closed on", "date"),
        f("company", "Company", "ref", { object: "companies" }),
      ],
    },
  };

  return {
    companies,
    deals,
    timeline,
    objects,
    user: { id: "u-1", name: "Camille Martin", email: "camille@example.com" },
  };
}
