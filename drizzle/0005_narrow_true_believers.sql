CREATE TABLE "visual_assets" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"import_id" varchar(64) NOT NULL,
	"file_version_id" varchar(64) NOT NULL,
	"page_number" integer NOT NULL,
	"media_type" varchar(127) NOT NULL,
	"storage_key" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"status" varchar(16) NOT NULL,
	"model_id" varchar(127),
	"prompt_version" varchar(32),
	"analysis" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "import_diagnostics" ADD COLUMN "code" varchar(32) DEFAULT 'text-extraction-failed' NOT NULL;--> statement-breakpoint
ALTER TABLE "visual_assets" ADD CONSTRAINT "visual_assets_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_assets" ADD CONSTRAINT "visual_assets_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visual_assets_file_version_page_uq" ON "visual_assets" USING btree ("file_version_id","page_number");--> statement-breakpoint
CREATE INDEX "visual_assets_import_id_idx" ON "visual_assets" USING btree ("import_id");