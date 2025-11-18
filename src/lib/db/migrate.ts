/**
 * Database Migration Runner
 *
 * Used by GitHub Actions workflows to run migrations during deployment.
 * This file is NOT used at runtime - migrations are a deployment-time concern.
 *
 * Why GitHub Actions?
 * - Single execution point: No race conditions (Drizzle lacks advisory locking)
 * - Preview testing: Create Neon preview branches for isolated testing
 * - Atomic deployments: Failed migrations prevent deployment
 * - Clear audit trail: All migrations logged in GitHub Actions
 *
 * Usage:
 * - Preview deployments: .github/workflows/preview.yml
 * - Production deployments: .github/workflows/production.yml
 * - Local development: Run manually with `bun run drizzle-kit migrate`
 *
 * See: .github/MIGRATIONS.md for detailed migration workflow documentation
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Run all pending database migrations
 *
 * This function:
 * 1. Creates a dedicated migration client (separate from app pool)
 * 2. Runs all pending migrations from ./drizzle/migrations
 * 3. Logs success/failure for observability
 * 4. Cleans up connection after completion
 *
 * Called by:
 * - GitHub Actions workflows (preview.yml, production.yml)
 * - Manual execution via `bun run drizzle-kit migrate`
 *
 * @throws Error if DATABASE_URL is not set or migrations fail
 */
export async function runMigrations(): Promise<void> {
	// Validate DATABASE_URL exists
	if (!process.env.DATABASE_URL) {
		throw new Error(
			"[Migrations] DATABASE_URL environment variable is not set",
		);
	}

	console.log("[Migrations] Starting database migrations...");
	console.log(
		`[Migrations] Target: ${process.env.DATABASE_URL.split("@")[1]?.split("/")[0] || "unknown"}`,
	);

	// Create migration-specific client
	// - max: 1 connection (migrations are sequential)
	// - prepare: false (required for Neon's connection pooling)
	const migrationClient = postgres(process.env.DATABASE_URL, {
		max: 1,
		prepare: false,
	});

	const db = drizzle(migrationClient);

	try {
		// Run migrations from ./drizzle/migrations
		// Drizzle tracks applied migrations in a metadata table
		await migrate(db, { migrationsFolder: "./drizzle/migrations" });

		console.log("[Migrations] ✅ All migrations applied successfully");
	} catch (error) {
		console.error("[Migrations] ❌ Migration failed:", error);
		throw error; // Re-throw to fail GitHub Actions workflow
	} finally {
		// Always clean up connection
		await migrationClient.end();
		console.log("[Migrations] Connection closed");
	}
}
