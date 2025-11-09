CREATE TABLE "ci_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" varchar(255) NOT NULL,
	"workflow_name" varchar(255) NOT NULL,
	"repo_name" varchar(255) NOT NULL,
	"org_name" varchar(255) NOT NULL,
	"project_name" varchar(255) NOT NULL,
	"branch" varchar(255),
	"pr_number" integer,
	"status" varchar(50) NOT NULL,
	"conclusion" varchar(50),
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"is_flaky" boolean DEFAULT false,
	"failure_reason" text,
	"jobs_count" integer DEFAULT 0,
	"failed_jobs_count" integer DEFAULT 0,
	"ingested_at" timestamp DEFAULT now(),
	CONSTRAINT "ci_runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"deployment_id" varchar(255) NOT NULL,
	"environment" varchar(100) NOT NULL,
	"repo_name" varchar(255) NOT NULL,
	"org_name" varchar(255) NOT NULL,
	"project_name" varchar(255) NOT NULL,
	"commit_sha" varchar(40) NOT NULL,
	"deployed_by" varchar(255),
	"status" varchar(50) NOT NULL,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"is_failed" boolean DEFAULT false,
	"failure_reason" text,
	"is_rollback" boolean DEFAULT false,
	"rollback_of" integer,
	"recovered_at" timestamp,
	"related_prs" jsonb DEFAULT '[]'::jsonb,
	"ingested_at" timestamp DEFAULT now(),
	CONSTRAINT "deployments_deployment_id_unique" UNIQUE("deployment_id")
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"pr_number" integer NOT NULL,
	"repo_name" varchar(255) NOT NULL,
	"org_name" varchar(255) NOT NULL,
	"project_name" varchar(255) NOT NULL,
	"title" text NOT NULL,
	"author" varchar(255) NOT NULL,
	"state" varchar(50) NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"closed_at" timestamp,
	"merged_at" timestamp,
	"first_review_at" timestamp,
	"approved_at" timestamp,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"changed_files" integer DEFAULT 0 NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb,
	"is_draft" boolean DEFAULT false,
	"base_branch" varchar(255) DEFAULT 'main',
	"head_branch" varchar(255),
	"ingested_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "run_id_idx" ON "ci_runs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ci_project_name_idx" ON "ci_runs" USING btree ("project_name");--> statement-breakpoint
CREATE INDEX "ci_pr_number_idx" ON "ci_runs" USING btree ("pr_number");--> statement-breakpoint
CREATE INDEX "status_idx" ON "ci_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "started_at_idx" ON "ci_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "is_flaky_idx" ON "ci_runs" USING btree ("is_flaky");--> statement-breakpoint
CREATE INDEX "deployment_id_idx" ON "deployments" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "deploy_project_name_idx" ON "deployments" USING btree ("project_name");--> statement-breakpoint
CREATE INDEX "environment_idx" ON "deployments" USING btree ("environment");--> statement-breakpoint
CREATE INDEX "deployment_status_idx" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deployment_started_at_idx" ON "deployments" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "is_failed_idx" ON "deployments" USING btree ("is_failed");--> statement-breakpoint
CREATE INDEX "pr_number_idx" ON "pull_requests" USING btree ("pr_number");--> statement-breakpoint
CREATE INDEX "repo_name_idx" ON "pull_requests" USING btree ("repo_name");--> statement-breakpoint
CREATE INDEX "project_name_idx" ON "pull_requests" USING btree ("project_name");--> statement-breakpoint
CREATE INDEX "merged_at_idx" ON "pull_requests" USING btree ("merged_at");--> statement-breakpoint
CREATE INDEX "created_at_idx" ON "pull_requests" USING btree ("created_at");