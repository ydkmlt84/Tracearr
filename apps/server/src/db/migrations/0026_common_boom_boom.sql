-- Add rule_type column (nullable initially for backfill)
-- Using IF NOT EXISTS for idempotency in case of partial migration retry
ALTER TABLE "violations" ADD COLUMN IF NOT EXISTS "rule_type" varchar(50);

-- Backfill rule_type from rules table
UPDATE "violations" v
SET "rule_type" = r."type"
FROM "rules" r
WHERE v."rule_id" = r."id";

-- P0-2: Delete orphaned violations (rule was deleted) before SET NOT NULL
-- Without this, migration fails if any violations have rule_id pointing to deleted rules
DELETE FROM "violations" WHERE "rule_type" IS NULL;

-- Make rule_type NOT NULL after backfill
ALTER TABLE "violations" ALTER COLUMN "rule_type" SET NOT NULL;

-- Deduplicate unacknowledged violations before creating unique index
-- Keep the oldest violation per (server_user_id, session_id, rule_type)
DELETE FROM "violations"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "server_user_id", "session_id", "rule_type"
      ORDER BY "created_at"
    ) as rn
    FROM "violations"
    WHERE "acknowledged_at" IS NULL
  ) ranked
  WHERE rn > 1
);

-- Add partial unique index for unacknowledged violations
-- Defense-in-depth: prevents duplicate violations at database level
CREATE UNIQUE INDEX IF NOT EXISTS "violations_unique_active_user_session_type"
ON "violations" USING btree ("server_user_id", "session_id", "rule_type")
WHERE "acknowledged_at" IS NULL;
