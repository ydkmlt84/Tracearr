DROP INDEX "users_username_unique";--> statement-breakpoint
CREATE INDEX "users_username_idx" ON "users" USING btree ("username");