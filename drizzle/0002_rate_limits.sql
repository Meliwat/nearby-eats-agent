CREATE TABLE "rate_limit_counters" (
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limit_counters_bucket_key_window_start_pk" PRIMARY KEY("bucket","key","window_start")
);
