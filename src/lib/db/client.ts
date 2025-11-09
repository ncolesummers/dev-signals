import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Validate DATABASE_URL exists
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Create Supabase connection client
// Note: { prepare: false } is required for Supabase's Transaction pooler mode (serverless)
const client = postgres(process.env.DATABASE_URL, { prepare: false });

// Create Drizzle client with schema
export const db = drizzle(client, { schema });

// Export schema for convenience
export { schema };
