ALTER TABLE "deployments" ALTER COLUMN "repo_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "notes" text;