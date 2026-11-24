import assert from "node:assert/strict";
import { test } from "node:test";
import { appError, errorItem } from "@getrunbase/core/app-error";
import { actionError } from "./action-error";
import { errorText } from "./error-text";

test("errorText: French if the code is known, otherwise the English message", () => {
  const e = appError(
    "functions.notFound",
    "Function {name} not found. See functions.list.",
    { name: "geo" },
  );
  assert.equal(e.message, "Function geo not found. See functions.list.");
  assert.equal(errorText(e, "en"), e.message);
  assert.equal(
    errorText(e, "fr"),
    "Fonction geo introuvable. Voir functions.list.",
  );
  // Serialized by a server action: same rendering.
  assert.equal(errorText(actionError(e), "fr"), errorText(e, "fr"));
  assert.equal(errorText(new Error("boom"), "fr"), "boom");
  assert.equal(errorText("brut", "fr"), "brut");
});

test("errorText: `{details}` rebuilt from the translated items", () => {
  const items = [
    errorItem("templates.issue", "{path}: {message}", {
      path: "version",
      message: "Invalid input: expected 1",
    }),
  ];
  const e = appError(
    "templates.invalid",
    "Invalid template ({count} error(s)):\n{details}",
    { count: 1, details: items.map((i) => i.message).join("\n") },
    { items },
  );
  assert.equal(
    errorText(actionError(e), "fr"),
    "Template invalide (1 erreur(s)) :\nversion : Invalid input: expected 1",
  );
  assert.equal(errorText(actionError(e), "en"), e.message);
});
