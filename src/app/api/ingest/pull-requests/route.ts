import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ingestPullRequests } from "@/lib/ingestion/azure-devops";

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
 * GET /api/ingest/pull-requests
 *
 * Triggers Azure DevOps PR metadata ingestion
 *
 * This endpoint is called by:
 * - Vercel Cron Jobs (daily at midnight)
 * - Manual triggers for testing/debugging
 *
 * Authentication: Requires CRON_SECRET in Authorization header
 *
 * This endpoint:
 * - Autodiscovers all projects in the organization
 * - Fetches PR data from each project's repositories
 * - Upserts PRs to the database with smart merge logic
 * - Returns detailed results including success counts and errors
 *
 * Usage:
 * ```bash
 * curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
 *   http://localhost:3000/api/ingest/pull-requests
 * ```
 *
 * Response:
 * ```json
 * {
 *   "success": true,
 *   "projectsProcessed": 5,
 *   "prsIngested": 127,
 *   "prsUpdated": 43,
 *   "errors": []
 * }
 * ```
 */
export async function GET(request: NextRequest) {
  // Validate cron secret
  if (!validateCronSecret(request)) {
    console.warn(
      "[API] Unauthorized PR ingestion request - invalid or missing cron secret",
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    console.log("[API] Starting PR ingestion request...");

    // Run ingestion
    const result = await ingestPullRequests();

    // Return result with appropriate status code
    const statusCode = result.success ? 200 : 207; // 207 = Multi-Status (partial success)

    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
    console.error("[API] Unhandled error during PR ingestion:", error);

    return NextResponse.json(
      {
        success: false,
        projectsProcessed: 0,
        prsIngested: 0,
        prsUpdated: 0,
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
