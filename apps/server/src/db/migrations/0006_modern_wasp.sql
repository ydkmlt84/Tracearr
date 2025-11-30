ALTER TABLE "sessions" ADD COLUMN "last_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "paused_duration_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "reference_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "watched" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_reference_idx" ON "sessions" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "sessions_user_rating_idx" ON "sessions" USING btree ("user_id","rating_key");