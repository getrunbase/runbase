ALTER TABLE "workspace_usage" ADD COLUMN "runs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_usage" ADD COLUMN "runs_month" date;