import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ingestCIRuns } from "@/lib/ingestion/azure-pipelines";

// Force dynamic rendering to prevent static optimization
export const dynamic = "force-dynamic";

/**
 * Validates the cron secret from the Authorization header
 */
function validateCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[API] CRON_SECRET environment variable not set");
    return false;
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix
  return token === cronSecret;
}

/**
 * GET /api/ingest/ci-runs
 *
 * Triggers Azure Pipelines CI run ingestion with flaky test detection
 *
 * This endpoint is called by:
 * - Vercel Cron Jobs (weekly on Mondays at 1 AM)
 * - Manual triggers for testing/debugging
 *
 * Authentication: Requires CRON_SECRET in Authorization header
 *
 * This endpoint:
 * - Autodiscovers all projects in the organization
 * - Fetches CI run data from Azure Pipelines
 * - Upserts CI runs to the database with smart merge logic
 * - Performs post-ingestion flaky test detection
 * - Returns detailed results including success counts and errors
 *
 * Usage:
 * ```bash
 * curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
 *   http://localhost:3000/api/ingest/ci-runs
 * ```
 *
 * Response:
 * ```json
 * {
 *   "success": true,
 *   "projectsProcessed": 5,
 *   "runsIngested": 342,
 *   "runsUpdated": 87,
 *   "flakyRunsDetected": 12,
 *   "errors": []
 * }
 * ```
 */
export async function GET(request: NextRequest) {
  // Validate cron secret
  if (!validateCronSecret(request)) {
    console.warn(
      "[API] Unauthorized CI run ingestion request - invalid or missing cron secret",
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    console.log("[API] Starting CI run ingestion request...");

    // Run ingestion
    const result = await ingestCIRuns();

    // Return result with appropriate status code
    const statusCode = result.success ? 200 : 207; // 207 = Multi-Status (partial success)

    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
    console.error("[API] Unhandled error during CI run ingestion:", error);

    return NextResponse.json(
      {
        success: false,
        projectsProcessed: 0,
        runsIngested: 0,
        runsUpdated: 0,
        flakyRunsDetected: 0,
        errors: [
          {
            message: "Unhandled error during ingestion",
            error: error instanceof Error ? error.message : String(error),
          },
        ],
      },
      { status: 500 },
    );
  }
}
