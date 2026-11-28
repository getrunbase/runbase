// Single service registry. Each public method of a service
// is mapped to its MCP tool. `null` = explicit exclusion: the method is
// deliberately not exposed over MCP, with its reason in a comment.
// Every `*Service` export of @getrunbase/core must appear here (exhaustiveness test).
// The typing requires one entry per method, the parity test (apps/web) checks
// that each named tool is registered on the MCP server.
import { workspacesService } from "../workspaces";
import { membersService } from "../members";
import { databasesService } from "../databases";
import { objectsService } from "../objects";
import { recordsService } from "../records";
import { eventsService } from "../events";
import { apiKeysService } from "../api-keys";
import { auditService } from "../audit";
import { feedbackService } from "../feedback";
import { workflowsService } from "../workflows";
import { blocksService } from "../blocks";
import { runsService } from "../runs";
import { errorsService } from "../errors";
import { triggersService } from "../triggers";
import { functionsService } from "../functions";
import { secretsService } from "../secrets";
import { connectionsService } from "../connections";
import { queryService } from "../query";
import { pagesService } from "../pages";
import { componentsService } from "../components";
import { webhooksService } from "../webhooks";
import { viewsService } from "../views";
import { notesService } from "../notes";
import { filesService } from "../files";
import { billingService, quotasService, usageService } from "../quotas";
import { overviewService } from "../overview";
import { templatesService } from "../templates";
import { catalogService } from "../catalog/service";
import { secretUsageService } from "../secrets/usage";

export const services = {
  workspaces: workspacesService,
  members: membersService,
  databases: databasesService,
  objects: objectsService,
  records: recordsService,
  events: eventsService,
  apiKeys: apiKeysService,
  audit: auditService,
  feedback: feedbackService,
  workflows: workflowsService,
  blocks: blocksService,
  runs: runsService,
  errors: errorsService,
  triggers: triggersService,
  functions: functionsService,
  secrets: secretsService,
  connections: connectionsService,
  query: queryService,
  pages: pagesService,
  components: componentsService,
  webhooks: webhooksService,
  views: viewsService,
  notes: notesService,
  files: filesService,
  quotas: quotasService,
  billing: billingService,
  usage: usageService,
  overview: overviewService,
  templates: templatesService,
  catalog: catalogService,
  secretUsage: secretUsageService,
};

type Services = typeof services;

export const mcpTools: {
  [S in keyof Services]: Record<keyof Services[S], string | null>;
} = {
  workspaces: {
    list: "workspaces.list",
    create: "workspaces.create",
    rename: "workspaces.rename",
    remove: "workspaces.delete",
    getSettings: "workspace.settings",
    // Excluded: carries secrets, set by an admin outside MCP.
    setSettings: null,
  },
  members: {
    invite: "members.invite",
    list: "members.list",
    setRole: "members.set_role",
    setWorkspaces: "members.set_workspaces",
    remove: "members.remove",
  },
  quotas: { get: "quotas.get", set: "quotas.set" },
  // Settings › Plan and usage page (UI): agents read quotas.get.
  billing: { enabled: null, get: null, plans: null },
  // Settings › Usage: web page only.
  usage: { get: null },
  // runbase-template.json format.
  templates: { export: "template.export", import: "template.import" },
  // Public catalog: read through /api/catalog, without MCP.
  catalog: {
    searchTemplates: null,
    getTemplate: null,
    listConnectors: null,
    getConnector: null,
    getCreator: null,
    submit: "templates.submit",
  },
  overview: {
    describe: "workspace.describe",
    purgeTest: "workspace.purge_test",
    dependencies: "workspace.dependencies",
  },
  databases: {
    list: "databases.list",
    get: "databases.get",
    create: "databases.create",
    rename: "databases.rename",
    remove: "databases.delete",
  },
  objects: {
    list: "objects.list",
    get: "objects.get",
    create: "objects.create",
    update: "objects.update_schema",
    remove: "objects.delete",
    export: "objects.export",
    migrate: "objects.migrate",
    index: "objects.index",
    // Excluded: internal helper (zod validator of the schema), no effect or data.
    validator: null,
  },
  records: {
    get: "records.get",
    // Excluded: internal evaluation of the condition block, records.search covers it.
    matches: null,
    // Excluded: internal resolution of run templates, records.get covers it.
    resolvePaths: null,
    // Excluded: variant of searchPage without metadata, records.search covers it.
    search: null,
    searchPage: "records.search",
    remove: "records.delete",
    update: "records.update",
    upsert: "records.upsert",
    upsertBatch: "records.upsert_batch",
    merge: "records.merge",
    transact: "records.transact",
    trash: "records.trash",
    restore: "records.restore",
    purge: "records.purge",
    history: "records.history",
    revert: "records.revert",
    updateWhere: "records.update_where",
    deleteWhere: "records.delete_where",
    importCsv: "records.import_csv",
    // Excluded: counter for the front-end home KPIs.
    count: null,
    // Excluded: aggregation for page queries; query.sql covers it on the MCP side.
    aggregate: null,
  },
  events: {
    insert: "events.push",
    timeline: "events.list",
    list: "events.list",
    funnel: "events.funnel",
    types: "events.types",
  },
  apiKeys: {
    create: "api_keys.create",
    list: "api_keys.list",
    revoke: "api_keys.revoke",
  },
  audit: { history: "audit.list", list: "audit.list" },
  feedback: {
    send: "feedback.send",
    // Excluded: reading and triage reserved to platform admins (/admin/feedback).
    list: null,
    resolve: null,
  },
  workflows: {
    list: "workflows.list",
    get: "workflows.get",
    versions: "workflows.versions",
    create: "workflows.create",
    update: "workflows.update",
    restore: "workflows.restore",
    validate: "workflows.validate",
    definitionOf: "workflows.validate",
    updateTested: "workflows.update",
    validateItems: "workflows.validate",
    check: "workflows.validate",
    dryRun: "workflows.dry_run",
    testStep: "workflows.test_step",
    activate: "workflows.activate",
    dryRunWorkflow: "workflows.dry_run",
    requireTested: "workflows.activate",
    activateTested: "workflows.activate",
    deactivate: "workflows.deactivate",
    remove: "workflows.delete",
  },
  blocks: {
    // Excluded: editor catalog (deprecated blocks included), blocks.list = catalog.
    list: null,
    catalog: "blocks.list",
    // Excluded: step form dropdowns of the editor.
    options: null,
  },
  runs: {
    start: "runs.start",
    get: "runs.get",
    // Excluded: full rows for the front end; runs.waiting is the compact form.
    waiting: null,
    waitingCompact: "runs.waiting",
    list: "runs.list",
    // Excluded: front-end record page view, runs.get covers the detail.
    forRecord: null,
    // Excluded: counter for the front-end home KPIs.
    countSince: null,
    statusCounts: null,
    decide: "runs.decide",
    cancel: "runs.cancel",
    cancelBulk: "runs.cancel_bulk",
    pause: "runs.pause",
    resume: "runs.resume",
    retryFrom: "runs.retry_from",
    replay: "runs.replay",
    budget: "workspaces.ai_budget",
    setBudget: "workspaces.set_ai_budget",
    resumeBudget: null,
  },
  errors: {
    list: "errors.list",
    get: "errors.get",
    retry: "errors.retry",
    resolve: "errors.resolve",
    // Excluded: called by the browser (failing code block), not by an agent.
    reportComponent: null,
    // Excluded: sidebar badge counter, derivable from errors.list.
    openCount: null,
  },
  triggers: { manual: "workflows.run_manual" },
  functions: {
    list: "functions.list",
    get: "functions.get",
    versions: "functions.versions",
    save: "functions.save",
    create: "functions.create",
    update: "functions.update",
    remove: "functions.delete",
    restore: "functions.restore",
    test: "functions.test",
    logs: "functions.logs",
    // Excluded: call from a page, functions.test covers it.
    call: null,
  },
  // Names only; the value is written but never read back.
  webhooks: {
    list: "webhooks.list",
    create: "webhooks.create",
    update: "webhooks.update",
    clearSample: "webhooks.clear_sample",
    sendTest: "webhooks.test",
    remove: "webhooks.delete",
  },
  views: {
    list: "views.list",
    get: "views.get",
    save: "views.save",
    remove: "views.delete",
  },
  notes: {
    list: "notes.list",
    get: "notes.get",
    save: "notes.save",
    remove: "notes.delete",
  },
  files: {
    upload: "files.upload",
    download: "files.download",
    remove: "files.delete",
    // Excluded: presigned URLs for the browser (web), no agent use.
    direct: null,
    uploadUrl: null,
    downloadUrl: null,
  },
  secrets: {
    list: "secrets.list",
    set: "secrets.set",
    remove: "secrets.delete",
  },
  connections: {
    list: "connections.list",
    providers: "connections.providers",
    // Excluded: the OAuth flow needs a browser and a signed-in user.
    authorizeUrl: null,
    complete: null,
    // Excluded: hands a token to the browser (Google Picker), never to agents.
    accessToken: null,
    remove: "connections.delete",
  },
  // Excluded: helper of the secrets UI (deletion confirmation).
  secretUsage: { all: null },
  // Read-only SQL, executed on the isolated runbase_query role.
  query: {
    sql: "query.sql",
    saved: "query.saved",
    save: "query.save",
    remove: "query.delete",
    // Exposed by workspace.describe (sqlViews).
    views: "workspace.describe",
  },
  // Pages: page.update also accepts a partial patch of the tree.
  pages: {
    list: "page.list",
    get: "page.get",
    versions: "page.versions",
    create: "page.create",
    update: "page.update",
    remove: "page.delete",
    restore: "page.restore",
    publish: "page.publish",
    discard: "page.discard",
    patchFiles: "page.update",
    errors: "page.errors",
    // Helpers of every page.* tool (id or name, compile status).
    resolveId: null,
    bundleStatus: null,
    // Called by the page iframe (server action), not by an agent.
    reportError: null,
    // Excluded: rendering of /p/[slug] (iframe), not an MCP tool.
    bundle: null,
    call: null,
  },
  components: {
    test: "page.test",
    // Excluded: used by page.test (screenshot).
    prepare: null,
    previewCall: null,
  },
};
