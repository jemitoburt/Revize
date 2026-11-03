-- Rack types created from the library before `defaultProduct` existed: prefill the bay load
-- as level load × levels (pallet racks) or shelf load × shelves (shelf racks). Types whose
-- bay load field already has a default product, or lacks the input fields, stay unchanged.
UPDATE "equipment_type" SET
  "field_definitions" = (
    SELECT jsonb_agg(
      CASE WHEN f->>'key' = 'bay_load_kg' AND NOT f ? 'defaultProduct'
        THEN f || '{"defaultProduct": ["level_load_kg", "levels"]}'::jsonb
        ELSE f END
      ORDER BY ord)
    FROM jsonb_array_elements("field_definitions") WITH ORDINALITY AS t(f, ord)
  ),
  "version" = "version" + 1,
  "updated_at" = now()
WHERE "field_definitions" @> '[{"key": "bay_load_kg"}, {"key": "level_load_kg"}, {"key": "levels"}]'::jsonb
  AND NOT "field_definitions" @> '[{"key": "bay_load_kg", "defaultProduct": []}]'::jsonb;
--> statement-breakpoint
UPDATE "equipment_type" SET
  "field_definitions" = (
    SELECT jsonb_agg(
      CASE WHEN f->>'key' = 'bay_load_kg' AND NOT f ? 'defaultProduct'
        THEN f || '{"defaultProduct": ["shelf_load_kg", "shelves"]}'::jsonb
        ELSE f END
      ORDER BY ord)
    FROM jsonb_array_elements("field_definitions") WITH ORDINALITY AS t(f, ord)
  ),
  "version" = "version" + 1,
  "updated_at" = now()
WHERE "field_definitions" @> '[{"key": "bay_load_kg"}, {"key": "shelf_load_kg"}, {"key": "shelves"}]'::jsonb
  AND NOT "field_definitions" @> '[{"key": "bay_load_kg", "defaultProduct": []}]'::jsonb;
