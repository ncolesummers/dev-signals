import { NextResponse } from "next/server";
import { ingestCIRuns } from "@/lib/ingestion/azure-pipelines";

/**
 * POST /api/ingest/ci-runs
 *
 * Triggers Azure Pipelines CI run ingestion with flaky test detection
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
 * curl -X POST http://localhost:3000/api/ingest/ci-runs
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
export async function POST() {
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
