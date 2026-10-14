ALTER TABLE "user_facts" DROP CONSTRAINT "user_facts_supersedes_user_facts_id_fk";
--> statement-breakpoint
ALTER TABLE "user_facts" ADD CONSTRAINT "user_facts_supersedes_user_facts_id_fk" FOREIGN KEY ("supersedes") REFERENCES "public"."user_facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_events_turn_idx" ON "agent_events" USING btree ("turn_message_id");