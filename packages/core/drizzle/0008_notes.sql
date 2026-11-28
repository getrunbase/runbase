CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_version" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notes_entity_title_idx" ON "notes" USING btree ("workspace_id","entity_type","entity_id","title");--> statement-breakpoint
CREATE INDEX "notes_organization_id_idx" ON "notes" USING btree ("organization_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON notes TO app_tenant;--> statement-breakpoint
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON notes TO app_tenant
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY key_workspaces ON notes AS RESTRICTIVE TO app_tenant
  USING (coalesce(current_setting('app.ws_ids', true), '') = ''
    OR workspace_id = ANY (string_to_array(current_setting('app.ws_ids', true), ',')::uuid[]))
  WITH CHECK (coalesce(current_setting('app.ws_ids', true), '') = ''
    OR workspace_id = ANY (string_to_array(current_setting('app.ws_ids', true), ',')::uuid[]));
--> statement-breakpoint
CREATE POLICY workspace_isolation ON notes AS RESTRICTIVE TO app_tenant
  USING (coalesce(current_setting('app.workspace_id', true), '') = ''
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (coalesce(current_setting('app.workspace_id', true), '') = ''
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
