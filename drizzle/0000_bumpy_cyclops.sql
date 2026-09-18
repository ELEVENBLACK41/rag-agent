CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"file_version_id" varchar(64) NOT NULL,
	"snapshot_id" varchar(64) NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"title" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "file_versions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"logical_file_id" varchar(64) NOT NULL,
	"version_number" integer NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"media_type" varchar(127) NOT NULL,
	"byte_size" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"file_version_id" varchar(64) NOT NULL,
	"snapshot_id" varchar(64) NOT NULL,
	"workflow_run_id" varchar(255),
	"status" varchar(16) NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "index_snapshots" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "logical_files" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "principals" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"run_id" varchar(64) NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"step_id" varchar(128),
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"conversation_id" varchar(64) NOT NULL,
	"snapshot_id" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"mode" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_snapshot_id_index_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."index_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_logical_file_id_logical_files_id_fk" FOREIGN KEY ("logical_file_id") REFERENCES "public"."logical_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_snapshot_id_index_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."index_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_snapshots" ADD CONSTRAINT "index_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logical_files" ADD CONSTRAINT "logical_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_snapshot_id_index_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."index_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_file_version_ordinal_uq" ON "chunks" USING btree ("file_version_id","ordinal");--> statement-breakpoint
CREATE INDEX "chunks_snapshot_id_idx" ON "chunks" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "conversations_workspace_id_idx" ON "conversations" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_versions_logical_file_version_uq" ON "file_versions" USING btree ("logical_file_id","version_number");--> statement-breakpoint
CREATE INDEX "file_versions_content_hash_idx" ON "file_versions" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "imports_workspace_status_idx" ON "imports" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "index_snapshots_workspace_id_idx" ON "index_snapshots" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "logical_files_workspace_id_idx" ON "logical_files" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "principals_workspace_id_idx" ON "principals" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_run_sequence_uq" ON "run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "run_events_run_id_idx" ON "run_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "runs_conversation_id_idx" ON "runs" USING btree ("conversation_id");
