CREATE TABLE "run_observations" (
	"run_id" varchar(64) NOT NULL,
	"observation_id" varchar(160) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_observations" ADD CONSTRAINT "run_observations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_observations_identity_uq" ON "run_observations" USING btree ("run_id","observation_id");