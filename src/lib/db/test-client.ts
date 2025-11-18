/**
 * PGlite Test Database Client
 *
 * PGlite is a WASM Postgres build that runs in-process - no Docker, no external
 * servers, just pure Postgres compiled to WebAssembly. Perfect for integration
 * tests that need real database behavior without infrastructure overhead.
 *
 * Why PGlite over Docker/cloud databases?
 * - Zero setup: No Docker daemon, no cloud project, just `bun test`
 * - Fast: In-process, no network overhead
 * - Real Postgres: Not SQLite - catches Postgres-specific bugs
 * - Isolated: Each test run gets fresh database
 * - Developer UX: Works out of the box
 *
 * Trade-offs:
 * - WASM overhead: ~2-5x slower than native Postgres (still fast enough)
 * - Memory: In-memory only, not for huge datasets (fine for our use case)
 * - Newer tech: Less battle-tested than Docker (but stable)
 *
 * See: https://github.com/electric-sql/pglite
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema";

// Environment check: Only allow in test environment
if (
  process.env.NODE_ENV !== "test" &&
  !process.env.VITEST &&
  !process.env.JEST_WORKER_ID &&
  !(
    (globalThis as { Bun?: { main?: string } }).Bun?.main?.includes(".test.") ??
    false
  )
) {
  throw new Error(
    "test-client.ts can only be imported in test environment. Use @/lib/db/client for production.",
  );
}

// Create in-memory PGlite instance
// Note: This creates a fresh database each time. For persistent testing across
// runs, you could use: new PGlite("./test-db-data")
const client = new PGlite();

// Create Drizzle client with schema
export const testDb = drizzle(client, { schema });

// Export raw client for advanced use cases (migrations, raw SQL)
export { client as pgliteClient };

// Track if schema has been initialized (global across all test files)
let schemaInitialized = false;

/**
 * Apply database schema to PGlite instance
 *
 * PGlite starts with a fresh in-memory database, so we need to create tables
 * by executing our Drizzle migration SQL files. This ensures the test database
 * schema matches production exactly.
 *
 * Call this ONCE in test setup (beforeAll) to create tables.
 */
export async function initializeTestSchema() {
  // Skip if already initialized (PGlite instance is shared across test files)
  if (schemaInitialized) {
    console.log("[PGlite] Schema already initialized, skipping");
    return;
  }

  try {
    // Apply migrations in order
    // Migration 0000: Create tables (pull_requests, deployments, ci_runs)
    await client.exec(`
			CREATE TABLE IF NOT EXISTS "ci_runs" (
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

			CREATE TABLE IF NOT EXISTS "deployments" (
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

			CREATE TABLE IF NOT EXISTS "pull_requests" (
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

			CREATE INDEX "run_id_idx" ON "ci_runs" USING btree ("run_id");
			CREATE INDEX "ci_project_name_idx" ON "ci_runs" USING btree ("project_name");
			CREATE INDEX "ci_pr_number_idx" ON "ci_runs" USING btree ("pr_number");
			CREATE INDEX "status_idx" ON "ci_runs" USING btree ("status");
			CREATE INDEX "started_at_idx" ON "ci_runs" USING btree ("started_at");
			CREATE INDEX "is_flaky_idx" ON "ci_runs" USING btree ("is_flaky");
			CREATE INDEX "deployment_id_idx" ON "deployments" USING btree ("deployment_id");
			CREATE INDEX "deploy_project_name_idx" ON "deployments" USING btree ("project_name");
			CREATE INDEX "environment_idx" ON "deployments" USING btree ("environment");
			CREATE INDEX "deployment_status_idx" ON "deployments" USING btree ("status");
			CREATE INDEX "deployment_started_at_idx" ON "deployments" USING btree ("started_at");
			CREATE INDEX "is_failed_idx" ON "deployments" USING btree ("is_failed");
			CREATE INDEX "pr_number_idx" ON "pull_requests" USING btree ("pr_number");
			CREATE INDEX "repo_name_idx" ON "pull_requests" USING btree ("repo_name");
			CREATE INDEX "project_name_idx" ON "pull_requests" USING btree ("project_name");
			CREATE INDEX "merged_at_idx" ON "pull_requests" USING btree ("merged_at");
			CREATE INDEX "created_at_idx" ON "pull_requests" USING btree ("created_at");
		`);

    // Migration 0001: Add commit_sha and flaky_test_count to ci_runs
    await client.exec(`
			ALTER TABLE "ci_runs" ADD COLUMN "commit_sha" varchar(255);
			ALTER TABLE "ci_runs" ADD COLUMN "flaky_test_count" integer DEFAULT 0;
			CREATE INDEX "ci_commit_sha_idx" ON "ci_runs" USING btree ("commit_sha");
		`);

    // Migration 0002: Make repo_name nullable and add notes column
    await client.exec(`
			ALTER TABLE "deployments" ALTER COLUMN "repo_name" DROP NOT NULL;
			ALTER TABLE "deployments" ADD COLUMN "notes" text;
		`);

    // Verify connection and tables
    const result = (await client.query("SELECT 1 as test")) as {
      rows: Array<{ test: number }>;
    };
    if (result.rows[0].test !== 1) {
      throw new Error("PGlite connection test failed");
    }

    console.log("[PGlite] Test database schema initialized successfully");
    schemaInitialized = true;
  } catch (error) {
    console.error("[PGlite] Failed to initialize schema:", error);
    throw error;
  }
}

/**
 * Reset test database
 *
 * Drops all tables and recreates schema. Useful for test isolation.
 * Note: With in-memory PGlite, restarting the process already gives you a
 * fresh database, so this is mainly useful for persistent PGlite instances.
 */
export async function resetTestDatabase() {
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await initializeTestSchema();
  console.log("[PGlite] Test database reset complete");
}
