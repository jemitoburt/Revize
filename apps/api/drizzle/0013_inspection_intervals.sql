ALTER TABLE "item" ADD COLUMN "inspection_interval_months" integer;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "inspection_interval_months" integer;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "inspection_interval_months" integer;