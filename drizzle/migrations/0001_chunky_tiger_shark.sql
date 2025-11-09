ALTER TABLE "ci_runs" ADD COLUMN "commit_sha" varchar(255);--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "flaky_test_count" integer DEFAULT 0;--> statement-breakpoint
CREATE INDEX "ci_commit_sha_idx" ON "ci_runs" USING btree ("commit_sha");