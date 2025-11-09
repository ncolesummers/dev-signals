import * as azdev from "azure-devops-node-api";
import type {
  Build,
  BuildResult,
  BuildStatus,
} from "azure-devops-node-api/interfaces/BuildInterfaces";
import type { TeamProjectReference } from "azure-devops-node-api/interfaces/CoreInterfaces";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ciRuns, pullRequests } from "@/lib/db/schema";

/**
 * Azure Pipelines CI Run Ingestion Module
 *
 * Implements US2.2: Ingest CI run data with flaky test detection
 * - Autodiscovers all projects in Azure DevOps organization
 * - Fetches pipeline run data with pagination and rate limit handling
 * - Transforms Azure Pipelines Build API data to database schema
 * - Post-ingestion batch analysis for flaky test detection
 * - Separate PR linking enrichment via commit SHA
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface CIIngestionResult {
  success: boolean;
  projectsProcessed: number;
  runsIngested: number;
  runsUpdated: number;
  flakyRunsDetected: number;
  errors: Array<{ project?: string; message: string; error?: unknown }>;
  metrics?: Array<{
    stepName: string;
    startTime: number;
    duration: number;
    status: "success" | "error" | "timeout" | "skipped";
    metadata?: Record<string, unknown>;
  }>;
}

interface ProjectCIIngestionResult {
  projectName: string;
  runsIngested: number;
  runsUpdated: number;
  errors: Array<{ message: string; error?: unknown }>;
}

// ============================================================================
// Configuration & Validation (Reuse from azure-devops.ts)
// ============================================================================

function getAzureDevOpsConfig() {
  const pat = process.env.AZURE_DEVOPS_PAT;
  const org = process.env.AZURE_DEVOPS_ORG;

  if (!pat) {
    throw new Error(
      "AZURE_DEVOPS_PAT environment variable is required for ingestion",
    );
  }

  if (!org) {
    throw new Error(
      "AZURE_DEVOPS_ORG environment variable is required for ingestion",
    );
  }

  // Parse excluded projects (comma-separated list)
  const excludeProjects = process.env.AZURE_DEVOPS_EXCLUDE_PROJECTS
    ? process.env.AZURE_DEVOPS_EXCLUDE_PROJECTS.split(",").map((p) => p.trim())
    : [];

  return { pat, org, excludeProjects };
}

// ============================================================================
// Azure DevOps API Client (Reuse from azure-devops.ts)
// ============================================================================

async function createAzureDevOpsConnection(
  org: string,
  pat: string,
): Promise<azdev.WebApi> {
  const authHandler = azdev.getPersonalAccessTokenHandler(pat);
  const orgUrl = `https://dev.azure.com/${org}`;
  return new azdev.WebApi(orgUrl, authHandler);
}

// ============================================================================
// Project Discovery (Reuse from azure-devops.ts)
// ============================================================================

async function discoverProjects(
  connection: azdev.WebApi,
  excludeProjects: string[],
): Promise<TeamProjectReference[]> {
  const coreApi = await connection.getCoreApi();
  const allProjects = await coreApi.getProjects();

  // Filter out excluded projects
  const filteredProjects = allProjects.filter(
    (project) => !excludeProjects.includes(project.name || ""),
  );

  console.log(`[CI Discovery] Found ${allProjects.length} total projects`);
  console.log(
    `[CI Discovery] Filtered to ${filteredProjects.length} projects (excluded: ${excludeProjects.join(", ") || "none"})`,
  );
  console.log(
    `[CI Discovery] Processing projects: ${filteredProjects.map((p) => p.name).join(", ")}`,
  );

  return filteredProjects;
}

// ============================================================================
// CI Run Fetching with Pagination
// ============================================================================

async function fetchAllCIRunsForProject(
  connection: azdev.WebApi,
  projectName: string,
): Promise<Build[]> {
  const buildApi = await connection.getBuildApi();
  const allBuilds: Build[] = [];

  // Only fetch builds from last 90 days to limit data volume
  const NINETY_DAYS_AGO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  try {
    // Fetch builds with pagination (Azure DevOps uses $top and continuationToken)
    let continuationToken: string | undefined;
    const top = 100; // Fetch 100 builds at a time
    let batchNum = 1;

    console.log(
      `[${projectName}] Fetching builds since ${NINETY_DAYS_AGO.toISOString().split("T")[0]} (90 days)`,
    );

    do {
      // Wrap each API call with timeout protection (60 seconds)
      const builds = await trackStep(
        `fetch-builds-${projectName}-batch-${batchNum}`,
        () =>
          buildApi.getBuilds(
            projectName,
            undefined, // definitions - undefined means all
            undefined, // queues
            undefined, // buildNumber
            NINETY_DAYS_AGO, // minTime - only fetch builds from last 90 days
            undefined, // maxTime
            undefined, // requestedFor
            undefined, // reasonFilter
            undefined, // statusFilter - fetch all statuses
            undefined, // resultFilter - fetch all results
            undefined, // tagFilters
            undefined, // properties
            top,
            continuationToken,
          ),
        60000, // 60 second timeout per API call
      );

      if (!builds || builds.length === 0) {
        break;
      }

      allBuilds.push(...builds);
      console.log(
        `[${projectName}] Progress: Fetched ${allBuilds.length} builds so far (batch ${batchNum}: +${builds.length})`,
      );

      // Check if there are more results
      // Azure DevOps Build API doesn't return a continuation token in the response
      // Instead, we rely on the build count - if we get fewer than 'top', we're done
      if (builds.length < top) {
        break;
      }

      // Small delay to avoid rate limits
      await sleep(100);
      batchNum++;
    } while (true);

    console.log(`[${projectName}] ✓ Fetched ${allBuilds.length} CI runs total`);
  } catch (error) {
    console.error(`[${projectName}] ✗ Error fetching CI runs:`, error);
    throw error;
  }

  return allBuilds;
}

// ============================================================================
// Data Transformation
// ============================================================================

function transformCIRun(
  build: Build,
  projectName: string,
  orgName: string,
): {
  runId: string;
  workflowName: string;
  repoName: string;
  orgName: string;
  projectName: string;
  branch: string | null;
  commitSha: string | null;
  prNumber: number | null;
  status: string;
  conclusion: string | null;
  startedAt: Date;
  completedAt: Date | null;
  isFlaky: boolean;
  flakyTestCount: number;
  failureReason: string | null;
  jobsCount: number;
  failedJobsCount: number;
} {
  // Extract build ID as runId (must be unique)
  const runId = `${projectName}-${build.id}`;

  // Extract workflow/definition name
  const workflowName = build.definition?.name || "unknown-pipeline";

  // Extract repository name
  const repoName = build.repository?.name || "unknown";

  // Extract branch name
  const branch = build.sourceBranch?.replace("refs/heads/", "") || null;

  // Extract commit SHA
  const commitSha = build.sourceVersion || null;

  // PR number is not directly available in Build API - will be enriched separately
  const prNumber = null;

  // Map Build status to our schema
  // BuildStatus: None=0, InProgress=1, Completed=2, Cancelling=4, Postponed=8, NotStarted=32, All=47
  let status = "unknown";
  if (build.status === 1) {
    status = "in_progress";
  } else if (build.status === 2) {
    status = "completed";
  } else if (build.status === 4) {
    status = "cancelling";
  }

  // Map Build result to conclusion
  // BuildResult: None=0, Succeeded=2, PartiallySucceeded=4, Failed=8, Canceled=32
  let conclusion: string | null = null;
  if (build.result === 2) {
    conclusion = "success";
  } else if (build.result === 4) {
    conclusion = "partially_succeeded";
  } else if (build.result === 8) {
    conclusion = "failure";
  } else if (build.result === 32) {
    conclusion = "cancelled";
  }

  // Extract timestamps
  const startedAt = build.startTime ? new Date(build.startTime) : new Date();
  const completedAt = build.finishTime ? new Date(build.finishTime) : null;

  // Failure reason (not available in basic API, could be enriched from logs)
  const failureReason: string | null = null;

  // Job counts (not available in basic Build API, would need Timeline API)
  const jobsCount = 0;
  const failedJobsCount = 0;

  // Flaky detection happens post-ingestion, default to false
  const isFlaky = false;
  const flakyTestCount = 0;

  // Debug logging
  console.log(`[Transform] Build #${build.buildNumber} "${workflowName}":`, {
    rawStatus: build.status,
    rawResult: build.result,
    mappedStatus: status,
    mappedConclusion: conclusion,
    startTime: build.startTime,
    finishTime: build.finishTime,
    commitSha: commitSha?.substring(0, 8),
    project: projectName,
  });

  return {
    runId,
    workflowName,
    repoName,
    orgName,
    projectName,
    branch,
    commitSha,
    prNumber,
    status,
    conclusion,
    startedAt,
    completedAt,
    isFlaky,
    flakyTestCount,
    failureReason,
    jobsCount,
    failedJobsCount,
  };
}

// ============================================================================
// Smart Merge (Upsert with Conditional Update)
// ============================================================================

async function upsertCIRun(
  runData: ReturnType<typeof transformCIRun>,
): Promise<"inserted" | "updated" | "skipped"> {
  try {
    // Check if CI run already exists (by unique runId)
    const existing = await db
      .select()
      .from(ciRuns)
      .where(eq(ciRuns.runId, runData.runId))
      .limit(1);

    if (existing.length === 0) {
      // Insert new CI run
      await db.insert(ciRuns).values(runData);
      return "inserted";
    }

    // CI run exists - check if we should update
    const existingRun = existing[0];

    // Smart merge: update if:
    // 1. Status changed (in_progress -> completed), OR
    // 2. Flaky flag changed (post-ingestion detection), OR
    // 3. PR enrichment added prNumber
    const shouldUpdate =
      runData.status !== existingRun.status ||
      runData.isFlaky !== existingRun.isFlaky ||
      (runData.prNumber !== null && existingRun.prNumber === null);

    if (shouldUpdate) {
      await db
        .update(ciRuns)
        .set(runData)
        .where(eq(ciRuns.runId, runData.runId));
      return "updated";
    }

    return "skipped";
  } catch (error) {
    console.error(`[Upsert] Error upserting CI run ${runData.runId}:`, error);
    throw error;
  }
}

// ============================================================================
// Project-Level Ingestion
// ============================================================================

async function ingestProjectCIRuns(
  connection: azdev.WebApi,
  project: TeamProjectReference,
  orgName: string,
): Promise<ProjectCIIngestionResult> {
  const projectName = project.name || "Unknown";
  const result: ProjectCIIngestionResult = {
    projectName,
    runsIngested: 0,
    runsUpdated: 0,
    errors: [],
  };

  try {
    console.log(`[${projectName}] Starting CI run ingestion...`);

    // Fetch all CI runs for this project
    const builds = await fetchAllCIRunsForProject(connection, projectName);

    console.log(`[${projectName}] Processing ${builds.length} CI runs...`);

    // Process each build
    for (const build of builds) {
      try {
        // Transform build data
        const runData = transformCIRun(build, projectName, orgName);

        // Upsert to database
        const action = await upsertCIRun(runData);

        if (action === "inserted") {
          result.runsIngested++;
        } else if (action === "updated") {
          result.runsUpdated++;
        }
      } catch (error) {
        result.errors.push({
          message: `Failed to process build ${build.id}`,
          error,
        });
      }
    }

    console.log(
      `[${projectName}] Completed: ${result.runsIngested} inserted, ${result.runsUpdated} updated, ${result.errors.length} errors`,
    );
  } catch (error) {
    result.errors.push({
      message: `Failed to fetch CI runs for project ${projectName}`,
      error,
    });
  }

  return result;
}

// ============================================================================
// Flaky Test Detection (Post-Ingestion Batch Analysis)
// ============================================================================

/**
 * Detect flaky CI runs using pattern:
 * - Group by commitSha
 * - Within 24-hour window from first run
 * - If any runs failed AND any runs passed -> mark all as flaky
 *
 * This implements pipeline-level flaky detection as agreed in plan
 */
async function detectFlakyRuns(): Promise<number> {
  console.log("[Flaky Detection] Starting batch analysis...");

  const startTime = Date.now();
  const MAX_DURATION_MS = 120000; // 120 seconds timeout protection
  const BATCH_SIZE = 500; // Process runs in batches to avoid memory exhaustion
  const NINETY_DAYS_AGO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  try {
    let offset = 0;
    let totalFlakyCount = 0;
    let totalProcessed = 0;
    let batchNumber = 1;

    while (true) {
      // Check timeout
      if (Date.now() - startTime > MAX_DURATION_MS) {
        console.warn(
          `[Flaky Detection] Timeout reached after processing ${totalProcessed} runs. Stopping early.`,
        );
        break;
      }

      // Fetch batch of CI runs with time window filter (last 90 days)
      const batchRuns = await db
        .select()
        .from(ciRuns)
        .where(
          and(
            eq(ciRuns.isFlaky, false), // Only check runs not already marked as flaky
            gte(ciRuns.startedAt, NINETY_DAYS_AGO), // Only last 90 days
          ),
        )
        .limit(BATCH_SIZE)
        .offset(offset);

      if (batchRuns.length === 0) {
        console.log(
          `[Flaky Detection] Batch ${batchNumber}: No more runs to analyze`,
        );
        break;
      }

      totalProcessed += batchRuns.length;
      console.log(
        `[Flaky Detection] Batch ${batchNumber}: Processing ${batchRuns.length} runs (offset: ${offset})`,
      );

      // Group by commitSha
      const runsByCommit = new Map<string, typeof batchRuns>();

      for (const run of batchRuns) {
        if (!run.commitSha) continue;

        if (!runsByCommit.has(run.commitSha)) {
          runsByCommit.set(run.commitSha, []);
        }

        runsByCommit.get(run.commitSha)!.push(run);
      }

      console.log(
        `[Flaky Detection] Batch ${batchNumber}: Analyzing ${runsByCommit.size} unique commits`,
      );

      // Collect all IDs to update in this batch
      const idsToMarkFlaky: number[] = [];

      // Analyze each commit's runs
      for (const [commitSha, runs] of runsByCommit.entries()) {
        // Need at least 2 runs to detect flaky behavior
        if (runs.length < 2) continue;

        // Sort by startedAt to find time window
        const sortedRuns = runs.sort(
          (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
        );

        const firstRunTime = sortedRuns[0].startedAt.getTime();

        // Filter runs within 24-hour window from first run
        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
        const runsInWindow = sortedRuns.filter(
          (run) => run.startedAt.getTime() - firstRunTime <= TWENTY_FOUR_HOURS,
        );

        if (runsInWindow.length < 2) continue;

        // Check for mixed success/failure
        const hasSuccess = runsInWindow.some(
          (run) => run.conclusion === "success",
        );
        const hasFailure = runsInWindow.some(
          (run) =>
            run.conclusion === "failure" ||
            run.conclusion === "partially_succeeded",
        );

        if (hasSuccess && hasFailure) {
          // Flaky pattern detected! Collect IDs to mark
          console.log(
            `[Flaky Detection] Flaky pattern detected for commit ${commitSha.substring(0, 8)} (${runsInWindow.length} runs in window)`,
          );

          for (const run of runsInWindow) {
            idsToMarkFlaky.push(run.id);
          }
        }
      }

      // Batch update all flaky runs in this batch (single query instead of N queries)
      if (idsToMarkFlaky.length > 0) {
        await db
          .update(ciRuns)
          .set({
            isFlaky: true,
            flakyTestCount: 1, // Pipeline-level, so count is 1
          })
          .where(inArray(ciRuns.id, idsToMarkFlaky));

        totalFlakyCount += idsToMarkFlaky.length;
        console.log(
          `[Flaky Detection] Batch ${batchNumber}: Marked ${idsToMarkFlaky.length} runs as flaky`,
        );
      }

      offset += BATCH_SIZE;
      batchNumber++;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(
      `[Flaky Detection] Complete: Processed ${totalProcessed} runs, marked ${totalFlakyCount} as flaky (${duration}s)`,
    );
    return totalFlakyCount;
  } catch (error) {
    console.error("[Flaky Detection] Error during analysis:", error);
    throw error;
  }
}

// ============================================================================
// PR Linking Enrichment (Separate Function)
// ============================================================================

/**
 * Enrich CI runs with PR numbers by matching commitSha to pull_requests table
 * This is a separate enrichment step that can be called independently
 */
export async function enrichCIRunsWithPRLinks(): Promise<{
  enriched: number;
  errors: number;
}> {
  console.log("[PR Linking] Starting enrichment...");

  const result = { enriched: 0, errors: 0 };

  try {
    // Fetch CI runs without PR links but with commitSha
    const runsWithoutPR = await db
      .select()
      .from(ciRuns)
      .where(
        and(eq(ciRuns.prNumber, null), eq(ciRuns.commitSha, null) === false),
      );

    console.log(
      `[PR Linking] Found ${runsWithoutPR.length} runs without PR links`,
    );

    for (const run of runsWithoutPR) {
      if (!run.commitSha) continue;

      try {
        // Find matching PR by commit SHA
        // Note: This is a simplified approach - in reality, we'd need to query
        // PR commits API to get exact commit-to-PR mapping
        // For now, we'll skip this enrichment as it requires additional API calls
        // and the commitSha field is sufficient for flaky detection
      } catch (error) {
        result.errors++;
        console.warn(
          `[PR Linking] Failed to enrich run ${run.runId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    console.log(
      `[PR Linking] Enriched ${result.enriched} runs, ${result.errors} errors`,
    );
  } catch (error) {
    console.error("[PR Linking] Fatal error during enrichment:", error);
    throw error;
  }

  return result;
}

// ============================================================================
// Main Ingestion Entry Point
// ============================================================================

export async function ingestCIRuns(): Promise<CIIngestionResult> {
  const startTime = Date.now();
  console.log("[CI Ingestion] Starting Azure Pipelines ingestion...");

  // Clear metrics from previous run
  stepMetrics.length = 0;

  const result: CIIngestionResult = {
    success: true,
    projectsProcessed: 0,
    runsIngested: 0,
    runsUpdated: 0,
    flakyRunsDetected: 0,
    errors: [],
  };

  try {
    // Get configuration
    const { pat, org, excludeProjects } = getAzureDevOpsConfig();
    console.log(`[CI Ingestion] Organization: ${org}`);
    console.log(
      `[CI Ingestion] Excluded projects: ${excludeProjects.join(", ") || "none"}`,
    );

    // Create Azure DevOps connection
    const connection = await createAzureDevOpsConnection(org, pat);
    console.log("[CI Ingestion] Connected to Azure DevOps");

    // Discover projects
    const projects = await discoverProjects(connection, excludeProjects);

    // Process projects in parallel (3 at a time) for better performance
    const PROJECT_CONCURRENCY = 3;

    // Process projects in batches
    for (let i = 0; i < projects.length; i += PROJECT_CONCURRENCY) {
      const batch = projects.slice(i, i + PROJECT_CONCURRENCY);

      const batchPromises = batch.map(async (project) => {
        try {
          // Wrap entire project processing with 5-minute timeout
          const projectResult = await trackStep(
            `ingest-project-${project.name}`,
            () => ingestProjectCIRuns(connection, project, org),
            300000, // 5 minute timeout per project
          );

          result.projectsProcessed++;
          result.runsIngested += projectResult.runsIngested;
          result.runsUpdated += projectResult.runsUpdated;

          // Add project-specific errors to overall errors
          for (const error of projectResult.errors) {
            result.errors.push({
              project: projectResult.projectName,
              ...error,
            });
          }
        } catch (error) {
          const isTimeout =
            error instanceof Error && error.message.includes("timed out");

          result.errors.push({
            project: project.name || "Unknown",
            message: isTimeout
              ? "Project ingestion timed out after 5 minutes"
              : "Failed to ingest project CI runs",
            error,
          });
          console.warn(
            `[${project.name || "Unknown"}] Skipping project and continuing with others`,
          );
          // Continue processing other projects even if this one fails/times out
        }
      });

      // Wait for current batch to complete before starting next batch
      await Promise.allSettled(batchPromises);
    }

    // POST-INGESTION: Run flaky detection batch analysis
    console.log(
      "[CI Ingestion] CI run ingestion complete, starting flaky detection...",
    );
    result.flakyRunsDetected = await detectFlakyRuns();

    // Determine overall success
    result.success = result.errors.length === 0;

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(
      `[CI Ingestion] Completed in ${duration}s: ${result.projectsProcessed} projects, ${result.runsIngested} inserted, ${result.runsUpdated} updated, ${result.flakyRunsDetected} flaky runs detected, ${result.errors.length} errors`,
    );
  } catch (error) {
    result.success = false;
    result.errors.push({
      message: "Fatal error during CI ingestion",
      error,
    });
    console.error("[CI Ingestion] Fatal error:", error);
  }

  // Attach metrics to result for observability
  result.metrics = stepMetrics;

  return result;
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Step Tracking & Observability (WDK-compatible pattern)
// ============================================================================

/**
 * Metrics for tracking individual steps in the ingestion workflow
 * This pattern maps 1:1 to Vercel Workflow DevKit's step.run() for future migration
 */
interface StepMetrics {
  stepName: string;
  startTime: number;
  duration: number;
  status: "success" | "error" | "timeout" | "skipped";
  metadata?: Record<string, unknown>;
}

// Global metrics collection (reset per ingestion run)
const stepMetrics: StepMetrics[] = [];

/**
 * Wrap a promise with a timeout
 * Throws a clear timeout error if the promise doesn't resolve in time
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: string,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutError));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutHandle!);
    return result;
  } catch (error) {
    clearTimeout(timeoutHandle!);
    throw error;
  }
}

/**
 * Track a step with metrics and optional timeout protection
 * Pattern matches Vercel Workflow DevKit's step.run() for future migration
 *
 * @param name - Unique step name (e.g., "fetch-builds-Data-Layer-batch-1")
 * @param fn - Async function to execute
 * @param timeoutMs - Optional timeout in milliseconds (default: no timeout)
 * @returns Result of the step function
 */
async function trackStep<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutMs?: number,
): Promise<T> {
  const startTime = Date.now();

  try {
    console.log(`[Step: ${name}] Starting...`);

    // Execute with or without timeout
    const result = timeoutMs
      ? await withTimeout(
          fn(),
          timeoutMs,
          `Step "${name}" timed out after ${timeoutMs}ms`,
        )
      : await fn();

    const duration = Date.now() - startTime;

    // Log slow steps as warnings
    if (duration > 10000) {
      console.warn(
        `[Step: ${name}] ⚠️  Completed slowly in ${(duration / 1000).toFixed(2)}s`,
      );
    } else {
      console.log(`[Step: ${name}] ✓ Completed in ${duration}ms`);
    }

    stepMetrics.push({
      stepName: name,
      startTime,
      duration,
      status: "success",
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.message.includes("timed out");

    console.error(
      `[Step: ${name}] ✗ Failed after ${duration}ms:`,
      error instanceof Error ? error.message : String(error),
    );

    stepMetrics.push({
      stepName: name,
      startTime,
      duration,
      status: isTimeout ? "timeout" : "error",
      metadata: {
        error: error instanceof Error ? error.message : String(error),
      },
    });

    throw error;
  }
}
