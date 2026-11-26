import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Every exported server action ("use server" files) returns its expected
// errors instead of throwing them: a thrown AppError (permission, quota,
// validation) renders Next's generic error page. Each awaited call, each
// parseInput and each throw in an action must sit inside runAction(...)
// (or the local run(...) helper), or inside a try whose catch returns
// actionError(e) / errorsOf(e) without rethrowing.
const app = fileURLToPath(new URL(".", import.meta.url));
const HELPERS = new Set(["runAction", "run"]);
// Session and request reads: auth control flow (redirect to /login).
const ALLOWED_AWAITS = new Set([
  "getTenant",
  "getTranslations",
  "headers",
  "cookies",
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

const calleeName = (e: ts.Expression): string | undefined =>
  ts.isIdentifier(e)
    ? e.text
    : ts.isPropertyAccessExpression(e)
      ? e.name.text
      : undefined;

// Node protected by a helper callback or a converting try/catch.
function isProtected(node: ts.Node, stop: ts.Node): boolean {
  for (let n: ts.Node = node; n !== stop; n = n.parent) {
    const p = n.parent;
    if (
      (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
      ts.isCallExpression(p) &&
      p.arguments.includes(n as ts.Expression) &&
      HELPERS.has(calleeName(p.expression) ?? "")
    )
      return true;
    if (ts.isTryStatement(p) && p.tryBlock === n && p.catchClause) {
      const c = p.catchClause.block.getText();
      if (/\b(actionError|errorsOf)\(/.test(c) && !/\bthrow\b/.test(c))
        return true;
    }
  }
  return false;
}

function violations(file: string, text = readFileSync(file, "utf8")) {
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const first = src.statements[0];
  if (
    !first ||
    !ts.isExpressionStatement(first) ||
    !ts.isStringLiteral(first.expression) ||
    first.expression.text !== "use server"
  )
    return [];
  const out: string[] = [];
  for (const s of src.statements) {
    if (
      !ts.isFunctionDeclaration(s) ||
      !s.body ||
      !s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      continue;
    const name = s.name?.text ?? "default";
    const body = s.body;
    const visit = (n: ts.Node) => {
      let bad: string | undefined;
      if (ts.isThrowStatement(n)) bad = "throw";
      if (ts.isAwaitExpression(n)) {
        const e = n.expression;
        const callee = ts.isCallExpression(e)
          ? calleeName(e.expression)
          : undefined;
        if (!ALLOWED_AWAITS.has(callee ?? "")) bad = `await ${callee ?? "?"}`;
      }
      if (ts.isCallExpression(n) && calleeName(n.expression) === "parseInput")
        bad = "parseInput";
      if (bad && !isProtected(n, body)) {
        const { line } = src.getLineAndCharacterOfPosition(n.getStart());
        out.push(
          `${relative(app, file)}:${line + 1} ${name}: ${bad} outside runAction`,
        );
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(body, visit);
  }
  return out;
}

test("server actions return expected errors instead of throwing", () => {
  const all = files(app);
  const scanned = all.filter((f) =>
    /^\s*["']use server["']/.test(readFileSync(f, "utf8")),
  );
  assert.ok(scanned.length >= 10, "use server files found");
  assert.deepEqual(
    scanned.flatMap((f) => violations(f)),
    [],
  );
});

test("the scan flags an action that lets an AppError escape", () => {
  const src = `"use server";
export async function bad(f: FormData) {
  const { ctx } = await getTenant();
  await service.remove(ctx, parseInput(x, f));
}
export async function good(f: FormData) {
  return runAction(async () => { await service.remove(parseInput(x, f)); });
}`;
  const v = violations(join(app, "example/actions.ts"), src);
  assert.equal(v.length, 2);
  assert.ok(v.every((l) => l.includes(" bad: ")));
});
