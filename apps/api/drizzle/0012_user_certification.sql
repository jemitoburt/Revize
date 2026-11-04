ALTER TABLE "app_user" ADD COLUMN "certification" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- The authorization used to be one value for the whole company: every user starts with it.
UPDATE "app_user" u SET "certification" = o."settings"->>'certification'
FROM "organization" o
WHERE o."id" = u."organization_id" AND coalesce(o."settings"->>'certification', '') <> '';
