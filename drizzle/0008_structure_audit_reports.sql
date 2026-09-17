CREATE TABLE "structure_audit_reports" (
	"snapshot_id" varchar(64) PRIMARY KEY NOT NULL,
	"report" jsonb NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "structure_audit_reports" ADD CONSTRAINT "structure_audit_reports_snapshot_id_index_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."index_snapshots"("id") ON DELETE cascade ON UPDATE no action;