CREATE TABLE "import_batches" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"snapshot_id" varchar(64) NOT NULL,
	"workflow_run_id" varchar(255),
	"status" varchar(16) NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "index_snapshot_files" (
	"snapshot_id" varchar(64) NOT NULL,
	"file_version_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "batch_id" varchar(64);--> statement-breakpoint
ALTER TABLE "logical_files" ADD COLUMN "source_path" varchar(1024);--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_snapshot_id_index_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."index_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_snapshot_files" ADD CONSTRAINT "index_snapshot_files_snapshot_id_index_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."index_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_snapshot_files" ADD CONSTRAINT "index_snapshot_files_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_workspace_status_idx" ON "import_batches" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "index_snapshot_files_snapshot_version_uq" ON "index_snapshot_files" USING btree ("snapshot_id","file_version_id");--> statement-breakpoint
CREATE INDEX "index_snapshot_files_version_idx" ON "index_snapshot_files" USING btree ("file_version_id");--> statement-breakpoint
INSERT INTO "index_snapshot_files" ("snapshot_id", "file_version_id")
SELECT DISTINCT "snapshot_id", "file_version_id" FROM "chunks";--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "logical_files_workspace_path_idx" ON "logical_files" USING btree ("workspace_id","source_path");
