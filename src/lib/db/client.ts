import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// ============================================================================
// DATABASE CLIENT - SMART TEST/PRODUCTION ROUTING
// ============================================================================
// This client automatically routes to the correct database based on environment:
// - In tests (NODE_ENV=test): Uses PGlite (Postgres in WebAssembly, in-memory)
// - In production/dev: Uses real Supabase connection
//
// This enables metric calculation functions to import `db` from this file
// without needing to know whether they're running in tests or production.
//
// See GitHub Issue #39 for context on test database safety.
// ============================================================================

// Detect test environment FIRST (before validating DATABASE_URL)
const isTestEnvironment =
  process.env.NODE_ENV === "test" ||
  process.env.VITEST === "true" ||
  process.env.JEST_WORKER_ID !== undefined ||
  process.env.BUN_TEST === "true" ||
  // Bun test runner detection - check if main file path includes ".test."
  ((globalThis as { Bun?: { main?: string } }).Bun?.main?.includes(".test.") ??
    false);

// In test environment, use PGlite (imported dynamically to avoid circular deps)
// In production, use real Supabase connection
let db: PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

if (isTestEnvironment) {
  console.log("[DB] Using PGlite test database (in-memory)");
  // Dynamic import to avoid loading test-client in production
  const { testDb } = await import("./test-client");
  db = testDb;
} else {
  console.log("[DB] Using production Supabase database");
  // Validate DATABASE_URL exists (only required for production path)
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  // Create Supabase connection client
  // Note: { prepare: false } is required for Supabase's Transaction pooler mode (serverless)
  const client = postgres(process.env.DATABASE_URL, { prepare: false });
  db = drizzle(client, { schema });
}

export { db };

// Export schema for convenience
export { schema };
