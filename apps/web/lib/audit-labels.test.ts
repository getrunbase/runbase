import assert from "node:assert/strict";
import { test } from "node:test";
import { auditLabel } from "./audit-labels";
import { translator } from "./i18n-test";

test("auditLabel: agreed human labels", () => {
  const t = translator("fr", "home");
  assert.equal(auditLabel("record.update", t), "Fiche modifiée");
  assert.equal(auditLabel("workflow.create", t), "Workflow créé");
  assert.equal(
    auditLabel("run.retry_from", t),
    "Exécution relancée depuis une étape",
  );
  assert.equal(auditLabel("page.publish", t), "Page publiée");
  assert.equal(auditLabel("run.pause", t), "Exécution mise en pause");
  assert.equal(auditLabel("workflows.activate", t), "workflows.activate");
  assert.equal(auditLabel("member.role", t), "Rôle d'un membre modifié");
});

test("auditLabel: English", () => {
  const t = translator("en", "home");
  assert.equal(auditLabel("records.update", t), "Record updated");
  assert.equal(auditLabel("member.role", t), "Member role changed");
});
