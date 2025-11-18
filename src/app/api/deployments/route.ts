import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { deployments } from "@/lib/db/schema";

/**
 * POST /api/deployments
 *
 * Manual deployment event recording endpoint for DORA metrics
 *
 * This endpoint allows manual recording of deployment events that occur outside
 * of automated CI/CD pipelines. Used for tracking deployments across all projects
 * for Deployment Frequency, Change Failure Rate, and MTTR calculations.
 *
 * Authentication: Requires DEPLOYMENT_API_KEY in Authorization header
 * Format: Authorization: Bearer <DEPLOYMENT_API_KEY>
 *
 * Usage:
 * ```bash
 * curl -X POST http://localhost:3000/api/deployments \
 *   -H "Authorization: Bearer your_api_key_here" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "environment": "production",
 *     "commitSha": "abc123...",
 *     "deployedAt": "2025-11-09T10:30:00Z",
 *     "projectName": "my-project",
 *     "orgName": "my-org",
 *     "status": "success",
 *     "deployedBy": "john.doe@example.com",
 *     "notes": "Hotfix deployment"
 *   }'
 * ```
 *
 * Response (201 Created):
 * ```json
 * {
 *   "success": true,
 *   "deployment": {
 *     "id": 123,
 *     "deploymentId": "deploy_1699527000_abc123",
 *     "environment": "production",
 *     ...
 *   }
 * }
 * ```
 */

// Validation schema for deployment request body
const deploymentSchema = z.object({
  environment: z.enum(["production", "staging", "development"], {
    message: "environment must be one of: production, staging, development",
  }),
  commitSha: z
    .string()
    .length(40, "commitSha must be exactly 40 characters (Git SHA-1 hash)")
    .regex(/^[a-f0-9]+$/i, "commitSha must be a valid hexadecimal hash"),
  deployedAt: z
    .string()
    .datetime({ message: "deployedAt must be a valid ISO 8601 timestamp" }),
  projectName: z
    .string()
    .min(1, "projectName is required")
    .max(255, "projectName must be 255 characters or less"),
  orgName: z
    .string()
    .min(1, "orgName is required")
    .max(255, "orgName must be 255 characters or less"),
  status: z
    .enum(["success", "failure"], {
      message: "status must be either: success, failure",
    })
    .default("success"),
  deployedBy: z
    .string()
    .max(255, "deployedBy must be 255 characters or less")
    .optional(),
  notes: z.string().optional(),
  repoName: z
    .string()
    .max(255, "repoName must be 255 characters or less")
    .optional(),
});

type DeploymentRequest = z.infer<typeof deploymentSchema>;

/**
 * Validates API key from Authorization header
 */
function validateApiKey(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");

  if (!authHeader) {
    return false;
  }

  // Expected format: "Bearer <api_key>"
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return false;
  }

  const expectedKey = process.env.DEPLOYMENT_API_KEY;

  if (!expectedKey) {
    console.error(
      "[API] DEPLOYMENT_API_KEY not configured in environment variables",
    );
    return false;
  }

  return token === expectedKey;
}

/**
 * Generates a unique deployment ID
 * Format: deploy_<timestamp>_<short_sha>
 */
function generateDeploymentId(commitSha: string): string {
  const timestamp = Date.now();
  const shortSha = commitSha.substring(0, 8);
  return `deploy_${timestamp}_${shortSha}`;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authentication check
    if (!validateApiKey(request)) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
          message:
            "Valid API key required. Provide Authorization: Bearer <key> header",
        },
        { status: 401 },
      );
    }

    // 2. Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON",
          message: "Request body must be valid JSON",
        },
        { status: 400 },
      );
    }

    const validationResult = deploymentSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation error",
          message: "Invalid request body",
          details: validationResult.error.format(),
        },
        { status: 400 },
      );
    }

    const data: DeploymentRequest = validationResult.data;

    // 3. Prepare deployment record
    const deploymentId = generateDeploymentId(data.commitSha);
    const deployedAt = new Date(data.deployedAt);
    const isFailed = data.status === "failure";

    const deploymentRecord = {
      deploymentId,
      environment: data.environment,
      repoName: data.repoName ?? null,
      orgName: data.orgName,
      projectName: data.projectName,
      commitSha: data.commitSha,
      deployedBy: data.deployedBy ?? null,
      notes: data.notes ?? null,
      status: data.status,
      startedAt: deployedAt,
      completedAt: deployedAt, // For manual deployments, started and completed are the same
      isFailed,
      failureReason: isFailed ? (data.notes ?? null) : null,
      isRollback: false,
      rollbackOf: null,
      recoveredAt: null,
      relatedPRs: [],
    };

    // 4. Insert into database
    const [createdDeployment] = await db
      .insert(deployments)
      .values(deploymentRecord)
      .returning();

    console.log(
      `[API] Deployment recorded: ${deploymentId} (${data.environment}, ${data.projectName}, ${data.status})`,
    );

    // 5. Return success response
    return NextResponse.json(
      {
        success: true,
        deployment: createdDeployment,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[API] Error recording deployment:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        message: "Failed to record deployment event",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
