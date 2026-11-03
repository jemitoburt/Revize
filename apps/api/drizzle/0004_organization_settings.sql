ALTER TABLE "organization" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "logo_mime_type" text;