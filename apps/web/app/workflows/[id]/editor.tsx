"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "next-intl";
import { ListChecks, Pause, Play, Save, Upload } from "lucide-react";
import { Button } from "@getrunbase/ui/components/ui/button";
import {
  addEntry,
  addStep,
  lastAiConfig,
  branchesOf,
  connect,
  disconnect,
  moveNode,
  removeEntry,
  setInput,
  setTargets,
  targetsAt,
  type BlockInfo,
  type Definition,
  type ObjectInfo,
} from "../graph";
import { scopeFor, TRIGGER_RECORD, varWords } from "../variables";
import { BlockPicker } from "./block-picker";
import type { WebhookInfo } from "./webhook-trigger";
import type { ActionError } from "@/lib/action-error";
import {
  dryRunWorkflow,
  saveWorkflow,
  setStatus,
  validateWorkflow,
} from "../actions";
import { WorkflowBar } from "./workflow-bar";
import { RecordSearch, type Link } from "./record-search";
import { TriggerForm } from "./trigger-form";
import { StepPanel } from "./step-panel";
import { RunResults, type DryRun } from "./run-results";

// React Flow loaded on demand (kept out of the page's First Load JS).
const WorkflowCanvas = dynamic(
  () => import("./canvas").then((m) => m.WorkflowCanvas),
  { ssr: false, loading: () => <Skeleton className="size-full" /> },
);

// Initial input of a step: triggering record and workflow object.
function defaults(type: string, root?: string): Record<string, unknown> {
  if (type === "condition")
    return root
      ? { object: root, recordId: TRIGGER_RECORD, condition: { all: [] } }
      : {};
  if (type === "switch")
    return root
      ? { object: root, recordId: TRIGGER_RECORD, field: "", cases: [] }
      : {};
  if (type === "record.update") return { recordId: TRIGGER_RECORD, data: {} };
  if (type === "record.get") return { id: TRIGGER_RECORD };
  if (type === "record.create") return { data: {} };
  if (type === "record.map")
    return root
      ? { source: TRIGGER_RECORD, sourceObject: root, mapping: {} }
      : {};
  return {};
}

// Visual workflow editor: canvas, config panel, actions.
export function WorkflowEditor({
  workflow,
  definition: initial,
  blocks,
  objects,
  operators,
  events,
  webhooks,
  workflows,
}: {
  workflow: {
    id: string;
    name: string;
    status: string;
    version: number;
    updatedAt: string;
  };
  definition: Definition;
  blocks: BlockInfo[];
  objects: ObjectInfo[];
  operators: Record<string, string[]>;
  events: string[];
  webhooks: WebhookInfo[];
  workflows: { id: string; name: string }[];
}) {
  const router = useRouter();
  const t = useTranslations("workflows");
  const tc = useTranslations("common");
  const words = useMemo(() => varWords(t), [t]);
  const [def, setDef] = useState<Definition>(initial);
  const [name, setName] = useState(workflow.name);
  const [selected, setSelected] = useState<string | null>(null);
  const [errors, setErrors] = useState<ActionError[] | null>(null);
  const [dry, setDry] = useState<DryRun | null>(null);
  const [testRecords, setTestRecords] = useState<Link[]>([]);
  const [pending, start] = useTransition();
  const step = def.steps.find((s) => s.id === selected);
  const block = blocks.find((b) => b.type === step?.type);
  // Object of the triggering record; manual trigger: the one from a
  // condition that tests `{{record.id}}`.
  const record = (def.trigger.object ??
    def.steps.find(
      (s) =>
        s.type === "condition" &&
        (s.input as { recordId?: string } | undefined)?.recordId ===
          "{{record.id}}",
    )?.input?.object) as string | undefined;
  const scope = useMemo(
    () => scopeFor(def, blocks, objects, record, step?.id, words),
    [def, blocks, objects, record, step?.id, words],
  );
  // Input of a step; Switch: links of deleted cases are removed too.
  const updateInput = (id: string, input: Record<string, unknown>) => {
    let next = setInput(def, id, input);
    const s = next.steps.find((x) => x.id === id)!;
    const keep = branchesOf(
      s,
      blocks.find((b) => b.type === s.type),
    );
    if (s.type === "switch")
      for (const b of Object.keys(next.next?.[id] ?? {}))
        if (!keep.includes(b)) next = setTargets(next, id, b, []);
    setDef(next);
  };
  const stepLabel = (id: string) => {
    const s = def.steps.find((x) => x.id === id);
    return blocks.find((b) => b.type === s?.type)?.label ?? id;
  };

  const save = () =>
    start(async () => {
      const r = await saveWorkflow(workflow.id, name, def);
      setErrors(r.errors ?? []);
      if (!r.errors) router.refresh();
    });
  const validate = () =>
    start(async () => setErrors(await validateWorkflow(def)));
  const dryRun = () =>
    start(async () =>
      setDry(
        await dryRunWorkflow(
          def,
          testRecords.map((r) => r.id),
        ),
      ),
    );
  const toggle = () =>
    start(async () => {
      const active = workflow.status === "active";
      if (!active) {
        const s = await saveWorkflow(workflow.id, name, def);
        if (s.errors) return setErrors(s.errors);
      }
      const r = await setStatus(workflow.id, active ? "paused" : "active");
      setErrors(r.errors ?? []);
      router.refresh();
    });

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <WorkflowBar
        id={workflow.id}
        tab="editor"
        status={workflow.status}
        version={workflow.version}
        updatedAt={workflow.updatedAt}
        title={
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-foreground min-w-0 rounded-sm text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            size={Math.max(name.length, 8)}
            aria-label={t("editor.nameLabel")}
          />
        }
      >
        <Button variant="secondary" disabled={pending} onClick={dryRun}>
          <Play />
          {t("editor.test")}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={save}>
          <Save />
          {tc("save")}
        </Button>
        <Button disabled={pending} onClick={toggle}>
          {workflow.status === "active" ? <Pause /> : <Upload />}
          {workflow.status === "active"
            ? t("editor.pause")
            : t("editor.activate")}
        </Button>
      </WorkflowBar>
      <div className="flex min-h-0 flex-1">
        <div className="relative flex-1">
          {/* Barre d'outils du canvas (planche : « Ajouter une étape »). */}
          <div className="absolute top-4 left-4 z-10">
            <BlockPicker
              blocks={blocks}
              onPick={(t) => {
                let next = addStep(def, t);
                const id = next.steps.at(-1)!.id;
                // New AI block: same AI config as the last configured one.
                const ai = t.startsWith("ai.") ? lastAiConfig(def) : undefined;
                next = setInput(next, id, {
                  ...defaults(t, record),
                  ...(ai && { ai }),
                });
                // Linked to the selected step (first free branch), or to the
                // trigger if it is selected.
                const from = def.steps.find((s) => s.id === selected);
                if (from) {
                  const bs = branchesOf(
                    from,
                    blocks.find((b) => b.type === from.type),
                  );
                  const free =
                    bs.find((b) => !targetsAt(def, from.id, b).length) ?? bs[0];
                  if (free) next = connect(next, from.id, free, id);
                } else if (selected === "trigger" && def.steps.length)
                  next = addEntry(next, id);
                setDef(next);
                setSelected(id);
              }}
            />
          </div>
          {/* Validation et fiches de test, à l'opposé. */}
          <div className="absolute top-4 right-4 z-10 flex gap-2">
            <Button variant="ghost" disabled={pending} onClick={validate}>
              <ListChecks />
              {t("editor.validate")}
            </Button>
            <RecordSearch
              object={record}
              value={testRecords}
              onChange={setTestRecords}
            />
          </div>
          <WorkflowCanvas
            definition={def}
            blocks={blocks}
            selected={selected}
            onSelect={setSelected}
            onConnect={(s, b, t) => setDef(connect(def, s, b, t))}
            onDisconnect={(s, b, t) => setDef(disconnect(def, s, b, t))}
            onAddEntry={(t) => setDef(addEntry(def, t))}
            onRemoveEntry={(t) => setDef(removeEntry(def, t))}
            onMove={(id, pos) => setDef((d) => moveNode(d, id, pos))}
          />
        </div>
        <aside className="bg-background flex w-90 shrink-0 flex-col gap-4.5 overflow-y-auto border-l px-5 py-4.5">
          {selected === "trigger" && (
            <TriggerForm
              value={def.trigger}
              onChange={(trigger) => setDef({ ...def, trigger })}
              objects={objects}
              events={events}
              webhooks={webhooks}
              workflows={workflows.filter((w) => w.id !== workflow.id)}
            />
          )}
          {step && (
            <StepPanel
              step={step}
              block={block}
              def={def}
              setDef={setDef}
              objects={objects}
              operators={operators}
              scope={scope}
              updateInput={updateInput}
              stepLabel={stepLabel}
              setSelected={setSelected}
            />
          )}
          {!selected && (
            <p className="text-muted-foreground text-sm">{t("editor.help")}</p>
          )}
          <RunResults
            errors={errors}
            dry={dry}
            testRecords={testRecords}
            def={def}
            stepLabel={stepLabel}
          />
        </aside>
      </div>
    </main>
  );
}
