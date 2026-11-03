ALTER TABLE "inspection_result" ADD COLUMN "severity" text;--> statement-breakpoint
ALTER TABLE "inspection_result" ADD COLUMN "include_in_protocol" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Existing defects: taken out of service = red, any other defect = amber.
UPDATE "inspection_result" SET "severity" = CASE WHEN "taken_out_of_service" THEN 'red' ELSE 'amber' END WHERE "outcome" = 'defect';--> statement-breakpoint
ALTER TABLE "inspection_result" ADD CONSTRAINT "inspection_result_severity_check" CHECK (("inspection_result"."outcome" = 'ok' and "inspection_result"."severity" is null) or ("inspection_result"."outcome" = 'defect' and "inspection_result"."severity" in ('green', 'amber', 'red')));--> statement-breakpoint
ALTER TABLE "inspection_result" ADD CONSTRAINT "inspection_result_red_check" CHECK ("inspection_result"."severity" is distinct from 'red' or ("inspection_result"."taken_out_of_service" and "inspection_result"."include_in_protocol"));