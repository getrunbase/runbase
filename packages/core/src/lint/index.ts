// Definition lint: platform conventions checked on save (objects, functions,
// workflows). Returns structured warnings for agents; a workspace setting
// (`lintStrict`) turns them into a blocking error.
import { appError } from "../errors/app-error";

export type LintWarning = {
  code: string;
  // Where: field key, option, step id, `code`…
  path: string;
  message: string;
  hint: string;
};

// Above this many non-blank lines, a function probably holds a whole workflow.
export const MAX_FUNCTION_LINES = 80;

const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
// Common non-English identifier tokens seen in agent-built workspaces
// (French, Spanish, German), matched on whole snake_case tokens.
const NON_ENGLISH = new Set([
  "nom",
  "prenom",
  "societe",
  "entreprise",
  "adresse",
  "ville",
  "pays",
  "telephone",
  "courriel",
  "statut",
  "montant",
  "prix",
  "derniere",
  "dernier",
  "contacte",
  "relance",
  "commentaire",
  "commentaires",
  "fournisseur",
  "facture",
  "devis",
  "commande",
  "produit",
  "quantite",
  "taille",
  "secteur",
  "entrepot",
  "chiffre",
  "affaires",
  "salarie",
  "salaries",
  "responsable",
  "etape",
  "etat",
  "nombre",
  "numero",
  "libelle",
  "debut",
  "echeance",
  "priorite",
  "categorie",
  "remarque",
  "empresa",
  "ciudad",
  "telefono",
  "estado",
  "strasse",
  "stadt",
  "anzahl",
]);
const EMOJI = /\p{Extended_Pictographic}/u;
// "1. New", "2) Won", "03 - Lost", "A. Hot".
const NUMBERED = /^\s*(\d+|[A-Za-z])\s*[.)\-:]\s+/;

const w = (
  code: string,
  path: string,
  message: string,
  hint: string,
): LintWarning => ({ code, path, message, hint });

// snake_case, ASCII, English key or slug.
export function lintKey(kind: string, key: string): LintWarning[] {
  if (!SNAKE.test(key))
    return [
      w(
        "key.notSnakeCase",
        key,
        `${kind} "${key}" is not snake_case ASCII.`,
        `Rename it to ${toSnake(key) || "an English snake_case name"} (a-z, 0-9, single underscores).`,
      ),
    ];
  const bad = key.split("_").filter((t) => NON_ENGLISH.has(t));
  if (bad.length)
    return [
      w(
        "key.notEnglish",
        key,
        `${kind} "${key}" is not in English (${bad.join(", ")}).`,
        "Use English names for keys and slugs (e.g. first_name, company, status, amount).",
      ),
    ];
  return [];
}

const toSnake = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1");

// Singular words ending in "s" (last token of a slug).
const SINGULAR_S = new Set([
  "status",
  "address",
  "news",
  "series",
  "species",
  "canvas",
  "alias",
  "atlas",
  "gas",
  "lens",
  "chassis",
  "kudos",
  "settings",
  "analytics",
  "metrics",
  "economics",
  "logistics",
  "sales",
]);
const isPlural = (slug: string) => {
  const last = slug.split("_").pop() ?? "";
  return (
    last.length > 2 &&
    last.endsWith("s") &&
    !/(ss|us|is)$/.test(last) &&
    !SINGULAR_S.has(last)
  );
};
const singular = (slug: string) =>
  slug
    .replace(/ies$/, "y")
    .replace(/(x|ch|sh)es$/, "$1")
    .replace(/s$/, "");

type FieldLike = { key?: unknown; type?: unknown; options?: unknown };

export function lintObject(input: {
  slug?: string;
  fields?: FieldLike[];
}): LintWarning[] {
  const out: LintWarning[] = [];
  if (input.slug) {
    const key = lintKey("Object slug", input.slug);
    out.push(...key);
    if (!key.length && isPlural(input.slug))
      out.push(
        w(
          "key.pluralSlug",
          input.slug,
          `Object slug "${input.slug}" looks plural.`,
          `Use the singular: ${singular(input.slug)} (one record = one ${singular(input.slug)}).`,
        ),
      );
  }
  for (const f of input.fields ?? []) {
    if (typeof f.key === "string") out.push(...lintKey("Field key", f.key));
    if (!Array.isArray(f.options)) continue;
    for (const o of f.options) {
      if (typeof o !== "string") continue;
      if (EMOJI.test(o))
        out.push(
          w(
            "option.emoji",
            `${String(f.key)}.${o}`,
            `Select option "${o}" contains an emoji.`,
            "Use plain text options; colours and icons belong to the page, not the data.",
          ),
        );
      else if (NUMBERED.test(o))
        out.push(
          w(
            "option.numbered",
            `${String(f.key)}.${o}`,
            `Select option "${o}" starts with a numbering prefix.`,
            `Use "${o.replace(NUMBERED, "")}": the order of the options list is the order.`,
          ),
        );
    }
  }
  return out;
}

const isEmptySchema = (s: unknown) =>
  !s ||
  typeof s !== "object" ||
  Object.keys(s).length === 0 ||
  ((s as { type?: unknown }).type === "object" &&
    !Object.keys((s as { properties?: object }).properties ?? {}).length);

// Error text written into a record instead of failing the step.
const ERROR_WRITE = [
  /catch\s*(\(\s*\w*\s*\))?\s*\{[^}]*records\.(update|upsert|transact)\s*\(/s,
  /records\.(update|upsert)\s*\([^;]*\b(e|err|error)\.message/s,
  /records\.(update|upsert)\s*\([^;]*String\(\s*(e|err|error)\s*\)/s,
];

// Boolean outputs that are really outcomes (should be branches).
const BOOL_OUTCOME = /^(found|ok|success|succeeded|exists|is_[a-z0-9_]+)$/;

export function lintFunction(input: {
  code?: string;
  outputSchema?: unknown;
  permissions?: { domains?: string[] };
}): LintWarning[] {
  const out: LintWarning[] = [];
  if (input.permissions?.domains?.includes("*"))
    out.push(
      w(
        "function.wildcardDomain",
        "permissions.domains",
        'permissions.domains contains "*" (whole internet).',
        "List the exact hostnames the function calls (e.g. api.hubapi.com).",
      ),
    );
  if (isEmptySchema(input.outputSchema))
    out.push(
      w(
        "function.emptyOutputSchema",
        "outputSchema",
        "outputSchema is empty: later steps cannot reference its fields.",
        'Declare the returned fields, e.g. { "type": "object", "properties": { "score": { "type": "number" } } }.',
      ),
    );
  const props = ((input.outputSchema as { properties?: unknown } | null)
    ?.properties ?? {}) as Record<string, { type?: unknown; enum?: unknown }>;
  if (!Array.isArray(props.branch?.enum))
    for (const [k, v] of Object.entries(props))
      if (BOOL_OUTCOME.test(k) && v?.type === "boolean")
        out.push(
          w(
            "function.booleanOutcome",
            `outputSchema.properties.${k}`,
            `Output "${k}" is a boolean outcome: the workflow cannot branch on it.`,
            'Declare a "branch" output with an enum (e.g. { "type": "string", "enum": ["found", "not_found"] }) and connect each branch in next.',
          ),
        );
  const code = input.code ?? "";
  const lines = code.split("\n").filter((l) => l.trim()).length;
  if (lines > MAX_FUNCTION_LINES)
    out.push(
      w(
        "function.tooLong",
        "code",
        `Function has ${lines} lines (max ${MAX_FUNCTION_LINES}).`,
        "Split it into small functions and chain them as workflow steps (fn.*, condition, records.*).",
      ),
    );
  if (ERROR_WRITE.some((r) => r.test(code)))
    out.push(
      w(
        "function.errorInRecord",
        "code",
        "Function writes an error into a record field instead of failing.",
        "Throw (or return { ok: false, error }) so the step fails, retries and shows in errors.list.",
      ),
    );
  return out;
}

type StepLike = {
  id?: unknown;
  type?: unknown;
  input?: unknown;
  retry?: { continueOnFail?: boolean };
};
type NextLike = Record<string, Record<string, unknown> | undefined>;

// `{{steps.X.output.error}}`, `{{steps.X.error.message}}`...
const ERROR_REF = /\{\{\s*steps\.[\w-]+\.(output\.)?error(\.message)?\s*\}\}/;
// Steps that change state (a write, an event, a failure, a call).
const STATEFUL =
  /^(record\.(update|create|upsert|delete|merge|transact)|event\.emit|webhook\.emit|workflow\.run|stop\.error|http\.request|fn\.)/;
const targets = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : [];

export function lintWorkflow(definition: {
  steps?: StepLike[];
  next?: unknown;
}): LintWarning[] {
  const steps = definition.steps ?? [];
  const next = (definition.next ?? {}) as NextLike;
  const out: LintWarning[] = [];
  const only = steps[0];
  if (
    steps.length === 1 &&
    typeof only?.type === "string" &&
    only.type.startsWith("fn.")
  )
    out.push(
      w(
        "workflow.singleFunction",
        String(only.id ?? "steps[0]"),
        `Workflow is a single ${only.type} step: the function holds the whole workflow.`,
        "Model the steps in the workflow (records.*, condition, ai.*, small fn.* steps) so each one is visible, retried and testable.",
      ),
    );
  const byId = new Map(steps.map((s) => [String(s.id), s]));
  // The path after `id` reaches stop.error: the run still fails visibly,
  // so recording the error on the record first is deliberate.
  const endsInStopError = (id: string) => {
    const seen = new Set<string>();
    const queue = Object.values(next[id] ?? {}).flatMap(targets);
    while (queue.length) {
      const x = queue.shift()!;
      if (seen.has(x)) continue;
      seen.add(x);
      if (byId.get(x)?.type === "stop.error") return true;
      queue.push(...Object.values(next[x] ?? {}).flatMap(targets));
    }
    return false;
  };
  for (const s of steps) {
    const id = String(s.id ?? "?");
    const type = typeof s.type === "string" ? s.type : "";
    const out_ = next[id] ?? {};
    if (
      type.startsWith("record.") &&
      ERROR_REF.test(JSON.stringify(s.input ?? {})) &&
      !endsInStopError(id)
    )
      out.push(
        w(
          "workflow.errorInRecord",
          id,
          `Step ${id} writes a step error into a record field.`,
          "Let the run fail (errors.list shows it), or connect the error branch to stop.error or a notification, not to a record write.",
        ),
      );
    if (s.retry?.continueOnFail && !("error" in out_))
      out.push(
        w(
          "workflow.continueOnFailNoErrorBranch",
          id,
          `Step ${id} has continueOnFail but no error branch in next.`,
          `Connect next.${id}.error to the step that handles the failure, or remove continueOnFail so the run fails.`,
        ),
      );
    if (
      type === "human.approve" &&
      "expired" in out_ &&
      !targets(out_.expired).some((x) =>
        STATEFUL.test(String(byId.get(x)?.type ?? "")),
      )
    )
      out.push(
        w(
          "workflow.approveExpiredNoop",
          id,
          `Step ${id}: the expired branch changes nothing.`,
          "On expiry, record the outcome (record.update a status, event.emit) or fail the run with stop.error, so the request does not vanish silently.",
        ),
      );
  }
  return out;
}

// Strict mode: lint warnings become a blocking error.
export function enforceLint(warnings: LintWarning[], strict: boolean) {
  if (strict && warnings.length)
    throw appError(
      "lint.failed",
      "Definition rejected by workspace standards: {issues}",
      { issues: warnings.map((x) => `${x.message} ${x.hint}`).join(" | ") },
      { kind: "invalid_input" },
    );
}
