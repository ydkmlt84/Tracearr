CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(50) NOT NULL,
	"params" jsonb NOT NULL,
	"server_user_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"username" varchar(255) NOT NULL,
	"email" varchar(255),
	"thumb_url" text,
	"is_server_admin" boolean DEFAULT false NOT NULL,
	"trust_score" integer DEFAULT 100 NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(20) NOT NULL,
	"url" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"server_user_id" uuid NOT NULL,
	"session_key" varchar(255) NOT NULL,
	"state" varchar(20) NOT NULL,
	"media_type" varchar(20) NOT NULL,
	"media_title" text NOT NULL,
	"grandparent_title" varchar(500),
	"season_number" integer,
	"episode_number" integer,
	"year" integer,
	"thumb_path" varchar(500),
	"rating_key" varchar(255),
	"external_session_id" varchar(255),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"duration_ms" integer,
	"total_duration_ms" integer,
	"progress_ms" integer,
	"last_paused_at" timestamp with time zone,
	"paused_duration_ms" integer DEFAULT 0 NOT NULL,
	"reference_id" uuid,
	"watched" boolean DEFAULT false NOT NULL,
	"ip_address" varchar(45) NOT NULL,
	"geo_city" varchar(255),
	"geo_region" varchar(255),
	"geo_country" varchar(100),
	"geo_lat" real,
	"geo_lon" real,
	"player_name" varchar(255),
	"device_id" varchar(255),
	"product" varchar(255),
	"device" varchar(255),
	"platform" varchar(100),
	"quality" varchar(100),
	"is_transcode" boolean DEFAULT false NOT NULL,
	"bitrate" integer
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"allow_guest_access" boolean DEFAULT false NOT NULL,
	"discord_webhook_url" text,
	"custom_webhook_url" text,
	"notify_on_violation" boolean DEFAULT true NOT NULL,
	"notify_on_session_start" boolean DEFAULT false NOT NULL,
	"notify_on_session_stop" boolean DEFAULT false NOT NULL,
	"notify_on_server_down" boolean DEFAULT true NOT NULL,
	"poller_enabled" boolean DEFAULT true NOT NULL,
	"poller_interval_ms" integer DEFAULT 15000 NOT NULL,
	"tautulli_url" text,
	"tautulli_api_key" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(100) NOT NULL,
	"name" varchar(255),
	"thumbnail" text,
	"email" varchar(255),
	"password_hash" text,
	"plex_account_id" varchar(255),
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"aggregate_trust_score" integer DEFAULT 100 NOT NULL,
	"total_violations" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"server_user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"severity" varchar(20) NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_server_user_id_server_users_id_fk" FOREIGN KEY ("server_user_id") REFERENCES "public"."server_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_users" ADD CONSTRAINT "server_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_users" ADD CONSTRAINT "server_users_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_server_user_id_server_users_id_fk" FOREIGN KEY ("server_user_id") REFERENCES "public"."server_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_server_user_id_server_users_id_fk" FOREIGN KEY ("server_user_id") REFERENCES "public"."server_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rules_active_idx" ON "rules" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "rules_server_user_id_idx" ON "rules" USING btree ("server_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "server_users_user_server_unique" ON "server_users" USING btree ("user_id","server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "server_users_server_external_unique" ON "server_users" USING btree ("server_id","external_id");--> statement-breakpoint
CREATE INDEX "server_users_user_idx" ON "server_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "server_users_server_idx" ON "server_users" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "server_users_username_idx" ON "server_users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "sessions_server_user_time_idx" ON "sessions" USING btree ("server_user_id","started_at");--> statement-breakpoint
CREATE INDEX "sessions_server_time_idx" ON "sessions" USING btree ("server_id","started_at");--> statement-breakpoint
CREATE INDEX "sessions_state_idx" ON "sessions" USING btree ("state");--> statement-breakpoint
CREATE INDEX "sessions_external_session_idx" ON "sessions" USING btree ("server_id","external_session_id");--> statement-breakpoint
CREATE INDEX "sessions_device_idx" ON "sessions" USING btree ("server_user_id","device_id");--> statement-breakpoint
CREATE INDEX "sessions_reference_idx" ON "sessions" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "sessions_server_user_rating_idx" ON "sessions" USING btree ("server_user_id","rating_key");--> statement-breakpoint
CREATE INDEX "sessions_geo_idx" ON "sessions" USING btree ("geo_lat","geo_lon");--> statement-breakpoint
CREATE INDEX "sessions_geo_time_idx" ON "sessions" USING btree ("started_at","geo_lat","geo_lon");--> statement-breakpoint
CREATE INDEX "sessions_media_type_idx" ON "sessions" USING btree ("media_type");--> statement-breakpoint
CREATE INDEX "sessions_transcode_idx" ON "sessions" USING btree ("is_transcode");--> statement-breakpoint
CREATE INDEX "sessions_platform_idx" ON "sessions" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "sessions_top_movies_idx" ON "sessions" USING btree ("media_type","media_title","year");--> statement-breakpoint
CREATE INDEX "sessions_top_shows_idx" ON "sessions" USING btree ("media_type","grandparent_title");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_plex_account_id_idx" ON "users" USING btree ("plex_account_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "violations_server_user_id_idx" ON "violations" USING btree ("server_user_id");--> statement-breakpoint
CREATE INDEX "violations_rule_id_idx" ON "violations" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "violations_created_at_idx" ON "violations" USING btree ("created_at");