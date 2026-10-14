CREATE TYPE "public"."agent_event_type" AS ENUM('model_call', 'tool_call', 'fact_change', 'error');--> statement-breakpoint
CREATE TYPE "public"."diet_support" AS ENUM('great', 'some', 'limited', 'on_request', 'none', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."fact_scope" AS ENUM('user', 'conversation');--> statement-breakpoint
CREATE TYPE "public"."fact_status" AS ENUM('active', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."group_fit" AS ENUM('great', 'ok', 'small_only');--> statement-breakpoint
CREATE TYPE "public"."kid_policy" AS ENUM('welcome', 'ok', 'avoid', 'not_allowed');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."recommendation_status" AS ENUM('suggested', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "agent_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conversation_id" uuid NOT NULL,
	"turn_message_id" uuid NOT NULL,
	"type" "agent_event_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"restaurant_id" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "recommendation_status" DEFAULT 'suggested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurant_hours" (
	"restaurant_id" integer NOT NULL,
	"day" smallint NOT NULL,
	"open_minute" smallint NOT NULL,
	"close_minute" smallint NOT NULL,
	CONSTRAINT "restaurant_hours_restaurant_id_day_open_minute_pk" PRIMARY KEY("restaurant_id","day","open_minute"),
	CONSTRAINT "day_range" CHECK ("restaurant_hours"."day" between 0 and 6),
	CONSTRAINT "close_after_open" CHECK ("restaurant_hours"."close_minute" > "restaurant_hours"."open_minute")
);
--> statement-breakpoint
CREATE TABLE "restaurants" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"cuisines" text[] NOT NULL,
	"price_tier" smallint NOT NULL,
	"hours_text" text NOT NULL,
	"context" text NOT NULL,
	"vegetarian" "diet_support" NOT NULL,
	"vegan" "diet_support" NOT NULL,
	"gluten_free" "diet_support" NOT NULL,
	"kids" "kid_policy" NOT NULL,
	"groups" "group_fit" NOT NULL,
	"min_party_size" smallint NOT NULL,
	"adults_only_from_minute" smallint,
	"cash_only" boolean NOT NULL,
	"booking_lead_days" smallint NOT NULL,
	CONSTRAINT "price_tier_range" CHECK ("restaurants"."price_tier" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "user_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"source_message_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"scope" "fact_scope" NOT NULL,
	"status" "fact_status" DEFAULT 'active' NOT NULL,
	"supersedes" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_turn_message_id_messages_id_fk" FOREIGN KEY ("turn_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_hours" ADD CONSTRAINT "restaurant_hours_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_facts" ADD CONSTRAINT "user_facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_facts" ADD CONSTRAINT "user_facts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_facts" ADD CONSTRAINT "user_facts_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_facts" ADD CONSTRAINT "user_facts_supersedes_user_facts_id_fk" FOREIGN KEY ("supersedes") REFERENCES "public"."user_facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_events_conversation_idx" ON "agent_events" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "recommendations_conversation_idx" ON "recommendations" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "restaurant_hours_day_idx" ON "restaurant_hours" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "user_facts_one_active_per_key" ON "user_facts" USING btree ("user_id","key") WHERE "user_facts"."status" = 'active';