import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// Validate DATABASE_URL exists
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Create Neon connection pool
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Create Drizzle client with schema
export const db = drizzle(pool, { schema });

// Export schema for convenience
export { schema };
