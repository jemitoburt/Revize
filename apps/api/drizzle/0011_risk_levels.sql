ALTER TABLE "equipment_type" ADD COLUMN "risk_levels" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inspection_result" ADD COLUMN "photos_in_protocol" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Racks (ČSN EN 15635) keep the green/yellow/red risk levels; other types become fit / unfit.
UPDATE "equipment_type" SET "risk_levels" = true
WHERE "name" ILIKE '%regál%' OR "field_definitions" @> '[{"key": "rack_type"}]'::jsonb;
