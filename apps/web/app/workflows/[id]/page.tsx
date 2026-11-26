import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AI_PRESETS } from "@getrunbase/core/ai-providers";
import { blocksService } from "@getrunbase/core/blocks";
import { allowed } from "@getrunbase/core/filter";
import { databasesService } from "@getrunbase/core/databases";
import { eventsService } from "@getrunbase/core/events";
import { objectsService, type Field } from "@getrunbase/core/objects";
import { secretsService } from "@getrunbase/core/secrets";
import { webhooksService } from "@getrunbase/core/webhooks";
import { workflowsService } from "@getrunbase/core/workflows";
import { SecretsProvider } from "@/components/secret-select";
import { ConnectionsProvider } from "@/components/connection-select";
import { connectionsService } from "@getrunbase/core/connections";
import { AiPresetsProvider } from "./ai-config";
import { getTenant } from "@/lib/tenant";
import type { Definition } from "../graph";
import { localizeBlocks } from "../labels";
import { WorkflowEditor } from "./editor";
import { RunsTab } from "./runs-tab";
import { VersionsTab } from "./versions-tab";
import { WORKFLOW_TABS, WorkflowBar } from "./workflow-bar";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("workflow");

// Visual workflow editor.
export default async function WorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; status?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const { ctx } = await getTenant();
  const wf = await workflowsService.get(ctx, id);
  if (!wf) notFound();
  const tab = WORKFLOW_TABS.find((k) => k === q.tab) ?? "editor";
  // Runs (mTVU3) and Versions (GMnKy) tabs: bar without the editor.
  if (tab !== "editor") {
    const bar = (
      <WorkflowBar
        id={wf.id}
        tab={tab}
        title={<h1 className="text-lg font-semibold">{wf.name}</h1>}
        status={wf.status}
        version={wf.currentVersion}
        updatedAt={wf.updatedAt.toISOString()}
      />
    );
    return (
      <main className="flex min-h-0 flex-1 flex-col">
        {bar}
        {tab === "runs" ? (
          <RunsTab ctx={ctx} workflowId={wf.id} status={q.status} />
        ) : (
          <VersionsTab
            id={wf.id}
            current={wf.currentVersion}
            versions={JSON.parse(
              JSON.stringify(
                (await workflowsService.versions(ctx, id)).map((v) => ({
                  version: v.version,
                  createdAt: v.createdAt.toISOString(),
                  definition: v.definition,
                })),
              ),
            )}
          />
        )}
      </main>
    );
  }
  const [
    blocks,
    objects,
    databases,
    events,
    webhooks,
    workflows,
    secrets,
    connections,
    providers,
  ] = await Promise.all([
      getTranslations("workflows").then(async (t) =>
        localizeBlocks(await blocksService.list(ctx), t),
      ),
      objectsService.list(ctx),
      databasesService.list(ctx),
      eventsService.types(ctx),
      webhooksService.list(ctx),
      workflowsService.list(ctx),
      secretsService.list(ctx),
      connectionsService.list(ctx),
      connectionsService.providers(ctx),
    ]);
  const db = new Map(databases.map((d) => [d.id, d]));
  return (
    // Secret names only: block selectors.
    <SecretsProvider names={secrets.map((s) => s.name)}>
    <ConnectionsProvider
      value={{
        connections: connections.map((c) => ({
          provider: c.provider,
          name: c.name,
          account: c.account,
        })),
        providers: Object.fromEntries(
          providers.flatMap((p) => p.types.map((t) => [t, p.provider])),
        ),
      }}
    >
    <AiPresetsProvider
      presets={AI_PRESETS.map((p) => ({
        id: p.id,
        label: p.label,
        models: p.models.map((m) => ({ id: m.id, label: m.label })),
        keySecret: p.keySecret,
      }))}
    >
    <WorkflowEditor
      key={wf.currentVersion}
      workflow={{
        id: wf.id,
        name: wf.name,
        status: wf.status,
        version: wf.currentVersion,
        updatedAt: wf.updatedAt.toISOString(),
      }}
      definition={wf.definition as Definition}
      // JSON Schema as plain objects (Server -> Client props).
      blocks={JSON.parse(JSON.stringify(blocks)) as typeof blocks}
      objects={objects.map((o) => ({
        slug: o.slug,
        name: o.name,
        database: {
          slug: db.get(o.databaseId)?.slug ?? "",
          name: db.get(o.databaseId)?.name ?? "",
        },
        fields: o.fields as Field[],
      }))}
      operators={allowed}
      events={events}
      webhooks={webhooks.map((w) => ({
        id: w.id,
        name: w.name,
        sample: w.sample,
        sampleAt: w.sampleAt?.toISOString() ?? null,
      }))}
      workflows={workflows.map((w) => ({ id: w.id, name: w.name }))}
    />
    </AiPresetsProvider>
    </ConnectionsProvider>
    </SecretsProvider>
  );
}
