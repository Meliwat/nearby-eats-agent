CREATE TABLE "group_poll_options" (
	"poll_id" uuid NOT NULL,
	"restaurant_id" integer NOT NULL,
	"position" smallint NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "group_poll_options_poll_id_restaurant_id_pk" PRIMARY KEY("poll_id","restaurant_id")
);
--> statement-breakpoint
CREATE TABLE "group_polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"restaurant_id" integer NOT NULL,
	"voter_id" uuid NOT NULL,
	"voter_name" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_poll_options" ADD CONSTRAINT "group_poll_options_poll_id_group_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."group_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_poll_options" ADD CONSTRAINT "group_poll_options_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_polls" ADD CONSTRAINT "group_polls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_votes" ADD CONSTRAINT "group_votes_voter_id_users_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_votes" ADD CONSTRAINT "group_votes_option_fk" FOREIGN KEY ("poll_id","restaurant_id") REFERENCES "public"."group_poll_options"("poll_id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_polls_conversation_idx" ON "group_polls" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_votes_one_per_voter" ON "group_votes" USING btree ("poll_id","voter_id");