ALTER TABLE "item" ADD COLUMN "designation" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "designation_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "item_site_designation_key" ON "item" USING btree ("site_id","designation_key") WHERE "item"."designation_key" is not null and "item"."retired_at" is null;--> statement-breakpoint
-- Číslo TZ becomes unique in the whole organization (ADR-0012). Existing data may already
-- have the same number at two customers: then the per-customer index stays, a warning is
-- logged and the API still refuses new duplicates; resolve them in the office and the index
-- is created by a later migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "item" GROUP BY "organization_id", "item_number" HAVING count(*) > 1
  ) THEN
    RAISE WARNING 'Čísla TZ se opakují u více zákazníků, unikátnost v celé evidenci zatím nelze vynutit.';
  ELSE
    DROP INDEX "item_customer_number_key";
    CREATE UNIQUE INDEX "item_org_number_key" ON "item" USING btree ("organization_id","item_number");
  END IF;
END $$;
