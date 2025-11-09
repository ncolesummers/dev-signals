import { NextResponse } from "next/server";
import { ingestPullRequests } from "@/lib/ingestion/azure-devops";

/**
 * POST /api/ingest/pull-requests
 *
 * Triggers Azure DevOps PR metadata ingestion
 *
 * This endpoint:
 * - Autodiscovers all projects in the organization
 * - Fetches PR data from each project's repositories
 * - Upserts PRs to the database with smart merge logic
 * - Returns detailed results including success counts and errors
 *
 * Usage:
 * ```bash
 * curl -X POST http://localhost:3000/api/ingest/pull-requests
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
export async function POST() {
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
