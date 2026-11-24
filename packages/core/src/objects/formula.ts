// Field formulas: small expression language evaluated by an interpreter
// (no eval, no access beyond the record values).
//   numbers, "strings", true/false/null, field keys (prix, qte)
//   + - * / %, comparisons (= != < <= > >=), and, or, not, ( )
//   functions: if, concat, round, abs, min, max, upper, lower, len,
//   coalesce, empty, days_between, today
// `+` concatenates as soon as one side is a string.
import { appError } from "../errors/app-error";

type Node =
  | { k: "lit"; v: unknown }
  | { k: "ref"; name: string }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

const TOKEN =
  /\s*(?:(\d+(?:\.\d+)?)|"((?:[^"\\]|\\.)*)"|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|!=|==|[-+*/%()<>=,]))/y;

function tokenize(src: string) {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(TOKEN.lastIndex))) break;
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(src);
    if (!m)
      throw appError(
        "objects.formulaUnexpectedChar",
        "Formula: unexpected character at position {at}",
        { at },
      );
    out.push(
      m[1] !== undefined
        ? `n:${m[1]}`
        : m[2] !== undefined
          ? `s:${m[2].replace(/\\(.)/g, "$1")}`
          : m[3] !== undefined
            ? `i:${m[3]}`
            : m[4]!,
    );
  }
  return out;
}

const FNS: Record<string, (...a: unknown[]) => unknown> = {
  concat: (...a) => a.map((x) => (x == null ? "" : String(x))).join(""),
  round: (x, d = 0) =>
    x == null ? null : Math.round(num(x) * 10 ** num(d)) / 10 ** num(d),
  abs: (x) => (x == null ? null : Math.abs(num(x))),
  min: (...a) => Math.min(...a.filter((x) => x != null).map(num)),
  max: (...a) => Math.max(...a.filter((x) => x != null).map(num)),
  upper: (x) => (x == null ? null : String(x).toUpperCase()),
  lower: (x) => (x == null ? null : String(x).toLowerCase()),
  len: (x) => (x == null ? 0 : Array.isArray(x) ? x.length : String(x).length),
  coalesce: (...a) => a.find((x) => x != null && x !== "") ?? null,
  empty: (x) => x == null || x === "" || (Array.isArray(x) && !x.length),
  today: () => new Date().toISOString().slice(0, 10),
  days_between: (a, b) =>
    a == null || b == null
      ? null
      : Math.round(
          (Date.parse(String(b)) - Date.parse(String(a))) / 86_400_000,
        ),
};

function num(x: unknown): number {
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n))
    throw appError("objects.formulaNumberExpected", "Formula: number expected");
  return n;
}

export function parseFormula(src: string): Node {
  const t = tokenize(src);
  let i = 0;
  const peek = () => t[i];
  const eat = (s?: string) => {
    const x = t[i++];
    if (x === undefined || (s && x !== s))
      throw s
        ? appError("objects.formulaExpected", "Formula: “{token}” expected", {
            token: s,
          })
        : appError("objects.formulaUnexpectedEnd", "Formula: unexpected end");
    return x;
  };
  const binary = (ops: string[], next: () => Node) => (): Node => {
    let a = next();
    while (ops.includes(peek() ?? "")) {
      const op = eat();
      a = { k: "bin", op: op.replace(/^i:/, ""), a, b: next() };
    }
    return a;
  };
  const primary = (): Node => {
    const x = eat();
    if (x === "(") {
      const e = or();
      eat(")");
      return e;
    }
    if (x === "-") return { k: "un", op: "-", a: primary() };
    if (x.startsWith("n:")) return { k: "lit", v: Number(x.slice(2)) };
    if (x.startsWith("s:")) return { k: "lit", v: x.slice(2) };
    if (!x.startsWith("i:"))
      throw appError(
        "objects.formulaUnexpected",
        "Formula: unexpected “{token}”",
        { token: x },
      );
    const name = x.slice(2);
    if (name === "true" || name === "false")
      return { k: "lit", v: name === "true" };
    if (name === "null") return { k: "lit", v: null };
    if (name === "not") return { k: "un", op: "not", a: primary() };
    if (peek() !== "(") return { k: "ref", name };
    if (!Object.hasOwn(FNS, name) && name !== "if")
      throw appError(
        "objects.formulaUnknownFunction",
        "Formula: unknown function {name}",
        { name },
      );
    eat("(");
    const args: Node[] = [];
    while (peek() !== ")") {
      args.push(or());
      if (peek() === ",") eat(",");
      else break;
    }
    eat(")");
    return { k: "call", fn: name, args };
  };
  const mul = binary(["*", "/", "%"], primary);
  const add = binary(["+", "-"], mul);
  const cmp = binary(["=", "==", "!=", "<", "<=", ">", ">="], add);
  const and = binary(["i:and"], cmp);
  const or = binary(["i:or"], and);
  const tree = or();
  if (i < t.length)
    throw appError(
      "objects.formulaUnexpected",
      "Formula: unexpected “{token}”",
      { token: String(t[i]) },
    );
  return tree;
}

function evalNode(n: Node, data: Record<string, unknown>): unknown {
  switch (n.k) {
    case "lit":
      return n.v;
    case "ref":
      return Object.hasOwn(data, n.name) ? (data[n.name] ?? null) : null;
    case "un": {
      const a = evalNode(n.a, data);
      return n.op === "not" ? !a : a == null ? null : -num(a);
    }
    case "call": {
      if (n.fn === "if")
        return evalNode(n.args[0]!, data)
          ? evalNode(n.args[1]!, data)
          : n.args[2]
            ? evalNode(n.args[2], data)
            : null;
      return FNS[n.fn]!(...n.args.map((a) => evalNode(a, data)));
    }
    case "bin": {
      if (n.op === "and") return !!evalNode(n.a, data) && !!evalNode(n.b, data);
      if (n.op === "or") return !!evalNode(n.a, data) || !!evalNode(n.b, data);
      const a = evalNode(n.a, data);
      const b = evalNode(n.b, data);
      switch (n.op) {
        case "=":
        case "==":
          return a === b;
        case "!=":
          return a !== b;
      }
      if (a == null || b == null) return null;
      if (n.op === "+" && (typeof a === "string" || typeof b === "string"))
        return String(a) + String(b);
      if (["<", "<=", ">", ">="].includes(n.op)) {
        const [x, y] =
          typeof a === "string" && typeof b === "string"
            ? [a, b]
            : [num(a), num(b)];
        return n.op === "<"
          ? x < y
          : n.op === "<="
            ? x <= y
            : n.op === ">"
              ? x > y
              : x >= y;
      }
      const [x, y] = [num(a), num(b)];
      if ((n.op === "/" || n.op === "%") && y === 0) return null;
      return n.op === "+"
        ? x + y
        : n.op === "-"
          ? x - y
          : n.op === "*"
            ? x * y
            : n.op === "/"
              ? x / y
              : x % y;
    }
  }
}

// Field keys read by a formula (schema validation).
export function formulaRefs(src: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node): void => {
    if (n.k === "ref") out.add(n.name);
    else if (n.k === "un") walk(n.a);
    else if (n.k === "bin") [n.a, n.b].forEach(walk);
    else if (n.k === "call") n.args.forEach(walk);
  };
  walk(parseFormula(src));
  return [...out];
}

// Value of a formula; an evaluation error (text instead of a number…)
// gives null rather than blocking the record write.
export function evalFormula(src: string, data: Record<string, unknown>) {
  try {
    const v = evalNode(parseFormula(src), data);
    return typeof v === "number" && !Number.isFinite(v) ? null : (v ?? null);
  } catch {
    return null;
  }
}
