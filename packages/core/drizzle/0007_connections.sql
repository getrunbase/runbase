CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"account" text,
	"scopes" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connections_workspace_name_idx" ON "connections" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "connections_organization_id_idx" ON "connections" USING btree ("organization_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON connections TO app_tenant;--> statement-breakpoint
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON connections TO app_tenant
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY key_workspaces ON connections AS RESTRICTIVE TO app_tenant
  USING (coalesce(current_setting('app.ws_ids', true), '') = ''
    OR workspace_id = ANY (string_to_array(current_setting('app.ws_ids', true), ',')::uuid[]))
  WITH CHECK (coalesce(current_setting('app.ws_ids', true), '') = ''
    OR workspace_id = ANY (string_to_array(current_setting('app.ws_ids', true), ',')::uuid[]));
--> statement-breakpoint
CREATE POLICY workspace_isolation ON connections AS RESTRICTIVE TO app_tenant
  USING (coalesce(current_setting('app.workspace_id', true), '') = ''
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (coalesce(current_setting('app.workspace_id', true), '') = ''
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
