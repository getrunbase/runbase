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

export const toSnake = (s: string) =>
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
export const isPlural = (slug: string) => {
  const last = slug.split("_").pop() ?? "";
  return (
    last.length > 2 &&
    last.endsWith("s") &&
    !/(ss|us|is)$/.test(last) &&
    !SINGULAR_S.has(last)
  );
};
export const singular = (slug: string) =>
  slug
    .replace(/ies$/, "y")
    .replace(/(x|ch|sh)es$/, "$1")
    .replace(/s$/, "");

// Object slugs are singular (one record = one contact): a plural slug is
// refused at creation, with the singular as suggestion.
export function assertSingularSlug(slug: string) {
  if (SNAKE.test(slug) && isPlural(slug))
    throw appError(
      "objects.pluralSlug",
      "Object slug {slug} looks plural: slugs are singular. Use {suggestion}",
      { slug, suggestion: singular(slug) },
      { kind: "invalid_input" },
    );
}

// Trailing punctuation or surrounding spaces in a select option.
const PUNCT = /^\s|\s$|[!?.;:,…]$/;
const caseClass = (o: string) =>
  !/\p{L}/u.test(o)
    ? null
    : o === o.toLowerCase()
      ? "lower"
      : o.length >= 4 && o === o.toUpperCase()
        ? "upper"
        : "capitalized";
// Option words that reveal a language (whole words, lowercase, no accents).
const FR_WORDS = new Set(
  "nouveau nouvelle gagne perdu perdue en cours termine terminee annule annulee oui non qualifie contacte a faire fait ouvert ouverte ferme fermee attente brouillon envoye envoyee paye payee refuse accepte valide haute basse moyenne relance".split(
    " ",
  ),
);
const EN_WORDS = new Set(
  "new won lost in progress done open closed yes no qualified contacted todo to do pending draft sent paid refused accepted approved rejected high low medium waiting active inactive cancelled canceled lead customer".split(
    " ",
  ),
);
const words = (o: string) =>
  o
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
const language = (o: string): "fr" | "en" | null => {
  if (/[àâçéèêëîïôûùüÿœ]/i.test(o)) return "fr";
  const ws = words(o);
  const fr = ws.some((x) => FR_WORDS.has(x) && !EN_WORDS.has(x));
  const en = ws.some((x) => EN_WORDS.has(x) && !FR_WORDS.has(x));
  return fr && !en ? "fr" : en && !fr ? "en" : null;
};

// Lint of the option list as a whole: one style, one language.
function lintOptions(key: string, options: string[]): LintWarning[] {
  const out: LintWarning[] = [];
  const classes = new Set(options.map(caseClass).filter(Boolean));
  if (classes.size > 1)
    out.push(
      w(
        "option.mixedCase",
        key,
        `Select options of "${key}" mix capitalisation styles (${options.join(", ")}).`,
        'Use one style for every option, e.g. "New", "In progress", "Won".',
      ),
    );
  const langs = options.map((o) => [o, language(o)] as const);
  const fr = langs.filter(([, l]) => l === "fr").map(([o]) => o);
  if (fr.length && langs.some(([, l]) => l === "en"))
    out.push(
      w(
        "option.mixedLanguage",
        key,
        `Select options of "${key}" mix languages (${fr.join(", ")} next to English options).`,
        "Write every option in English; the interface translates labels, not the data.",
      ),
    );
  return out;
}

// Casing family of an option value; null when it has no letters.
const casingOf = (o: string): string | null => {
  if (!/[a-z]/i.test(o)) return null;
  if (o === o.toLowerCase()) return "lowercase";
  if (o === o.toUpperCase()) return "UPPERCASE";
  return "Capitalized";
};

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
  const casings = new Map<string, string>();
  for (const f of input.fields ?? [])
    if (Array.isArray(f.options))
      for (const o of f.options)
        if (typeof o === "string" && casingOf(o) && !casings.has(casingOf(o)!))
          casings.set(casingOf(o)!, `${String(f.key)}.${o}`);
  // A single field that mixes casings is reported by option.mixedCase;
  // option.mixedCasing only covers mixes across fields.
  const fieldMixes = (input.fields ?? []).some(
    (f) =>
      Array.isArray(f.options) &&
      new Set(
        f.options
          .map((o) => (typeof o === "string" ? casingOf(o) : null))
          .filter(Boolean),
      ).size > 1,
  );
  if (casings.size > 1 && !fieldMixes)
    out.push(
      w(
        "option.mixedCasing",
        [...casings.values()].join(", "),
        `Select option values mix casings (${[...casings.keys()].join(", ")}).`,
        "Use one casing for every option value of the object (e.g. snake_case: new, in_progress, won); filters and conditions compare exact values.",
      ),
    );
  for (const f of input.fields ?? []) {
    if (typeof f.key === "string") out.push(...lintKey("Field key", f.key));
    if (!Array.isArray(f.options)) continue;
    for (const o of f.options) {
      if (typeof o !== "string") continue;
      if (PUNCT.test(o))
        out.push(
          w(
            "option.punctuation",
            `${String(f.key)}.${o}`,
            `Select option "${o}" has surrounding spaces or trailing punctuation.`,
            `Use "${o.trim().replace(/[!?.;:,…]+$/, "")}".`,
          ),
        );
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
    out.push(
      ...lintOptions(
        String(f.key),
        f.options.filter((o): o is string => typeof o === "string"),
      ),
    );
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
  permissions?: { domains?: string[]; secrets?: string[] };
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
      if (
        BOOL_OUTCOME.test(k) &&
        v?.type === "boolean" &&
        // { ok: false, error } is the failure convention, not an outcome.
        !(k === "ok" && "error" in props)
      )
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
        'Do not catch the error into a field: return { ok: false, error: "message" } or throw, so the step fails, retries and shows in errors.list.',
      ),
    );
  // Skipping an external side effect (Slack post, email) in a test run is
  // the documented pattern; without any external call there is nothing to
  // skip, so the branch only fakes the result.
  const external =
    !!input.permissions?.domains?.length ||
    !!input.permissions?.secrets?.length;
  if (!external && CTX_TEST.some((r) => r.test(code)))
    out.push(
      w(
        "function.branchesOnTest",
        "code",
        "Function branches on the test flag but makes no external call: test runs do not exercise the real code path.",
        "Run the same code in test and live runs (test records are flagged automatically); use functions.test { dryRun: true } to simulate writes. Reserve if (test) for skipping an external side effect.",
      ),
    );
  return out;
}

// `ctx.test`, or a destructured `test` used as a condition.
const CTX_TEST = [
  /\bctx\.test\b/,
  /\bif\s*\(\s*!?\s*test\b|\btest\s*\?[^.?]|\btest\s*(&&|\|\|)/,
];

// Missing note: the next agent has no record of the decisions.
export function lintNote(
  kind: "workflow" | "function",
  name: string,
  hasNote: boolean,
): LintWarning[] {
  return hasNote
    ? []
    : [
        w(
          `${kind}.noNote`,
          name,
          `The ${kind} "${name}" has no note.`,
          `Call notes.save on the ${kind} with the why (decisions, local conventions, known pitfalls), not the structure.`,
        ),
      ];
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

// Select fields that hold a pipeline stage (heuristic on the key).
const STAGE_KEY = /(^|_)(stage|status|state|step|phase)$/;
const dataKeys = (s: StepLike): string[] => {
  const data = (s.input as { data?: unknown } | undefined)?.data;
  return data && typeof data === "object" ? Object.keys(data) : [];
};

export function lintWorkflow(definition: {
  trigger?: unknown;
  steps?: StepLike[];
  next?: unknown;
  concurrencyKey?: unknown;
}): LintWarning[] {
  const steps = definition.steps ?? [];
  const next = (definition.next ?? {}) as NextLike;
  const out: LintWarning[] = [];
  const trigger = (definition.trigger ?? {}) as {
    type?: unknown;
    fields?: unknown;
  };
  const updates = steps.filter((s) => s.type === "record.update");
  if (trigger.type === "trigger.record_updated") {
    const watched = Array.isArray(trigger.fields)
      ? trigger.fields.map(String)
      : [];
    // Only writes to the trigger record itself loop.
    const self = updates.filter((s) =>
      /\{\{\s*record\.id\s*\}\}/.test(
        String((s.input as { recordId?: unknown } | undefined)?.recordId),
      ),
    );
    for (const s of self) {
      const loop = dataKeys(s).filter(
        (k) => !watched.length || watched.includes(k),
      );
      if (loop.length)
        out.push(
          w(
            "workflow.writesTriggerField",
            String(s.id ?? "?"),
            `Step ${String(s.id ?? "?")} writes ${loop.join(", ")}, which the record_updated trigger watches: the workflow retriggers itself.`,
            "Set trigger.fields to the fields that should start the run, and do not write them back in the workflow.",
          ),
        );
    }
  }
  if (
    trigger.type === "trigger.event" &&
    !(
      typeof definition.concurrencyKey === "string" && definition.concurrencyKey
    )
  )
    for (const s of updates) {
      const stage = dataKeys(s).filter((k) => STAGE_KEY.test(k));
      if (stage.length)
        out.push(
          w(
            "workflow.stageRaceNoConcurrencyKey",
            String(s.id ?? "?"),
            `Step ${String(s.id ?? "?")} updates ${stage.join(", ")} from an event trigger without concurrencyKey: concurrent events race on the same record.`,
            'Set concurrencyKey (e.g. "{{event.recordId}}") so runs on one record wait their turn.',
          ),
        );
    }
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
          "Let the step fail (remove continueOnFail): the run fails and errors.list shows it. To handle it, connect the error branch to a notification or event.emit, not to a record write; test that branch with a pin { error } in workflows.dry_run.",
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
