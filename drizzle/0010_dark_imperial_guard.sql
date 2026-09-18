ALTER TABLE "import_batches" ADD COLUMN "progress_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "progress_stage" varchar(24) DEFAULT 'queued' NOT NULL;--> statement-breakpoint
UPDATE "import_batches"
SET
	"progress_percent" = CASE
		WHEN "status" = 'completed' THEN 100
		WHEN "status" = 'running' THEN 10
		ELSE 0
	END,
	"progress_stage" = CASE
		WHEN "status" = 'completed' THEN 'completed'
		WHEN "status" = 'running' THEN 'parsing'
		WHEN "status" = 'failed' THEN 'failed'
		ELSE 'queued'
	END;
