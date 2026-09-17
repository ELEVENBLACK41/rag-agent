CREATE TABLE "import_diagnostics" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"import_id" varchar(64) NOT NULL,
	"severity" varchar(16) NOT NULL,
	"stage" varchar(16) NOT NULL,
	"page_number" integer,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "start_line" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "end_line" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "import_diagnostics" ADD CONSTRAINT "import_diagnostics_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_diagnostics_import_id_idx" ON "import_diagnostics" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "import_diagnostics_import_page_idx" ON "import_diagnostics" USING btree ("import_id","page_number");