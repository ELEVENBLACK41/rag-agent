CREATE TABLE "messages" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"conversation_id" varchar(64) NOT NULL,
	"run_id" varchar(64),
	"role" varchar(16) NOT NULL,
	"content" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_conversation_id_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "messages_run_id_idx" ON "messages" USING btree ("run_id");