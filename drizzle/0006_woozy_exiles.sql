DROP INDEX "visual_assets_file_version_page_uq";--> statement-breakpoint
ALTER TABLE "visual_assets" ALTER COLUMN "page_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "visual_assets" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "visual_assets" ADD COLUMN "source_locator" jsonb;--> statement-breakpoint
UPDATE "visual_assets"
SET
  "source_key" = CONCAT('pdf-page:', "page_number"),
  "source_locator" = jsonb_build_object('kind', 'pdf-page', 'pageNumber', "page_number");--> statement-breakpoint
ALTER TABLE "visual_assets" ALTER COLUMN "source_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "visual_assets" ALTER COLUMN "source_locator" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "visual_assets_file_version_source_uq" ON "visual_assets" USING btree ("file_version_id","source_key");
