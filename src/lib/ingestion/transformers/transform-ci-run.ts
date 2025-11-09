/**
 * CI Run Transformer
 *
 * Transforms Azure Pipelines Build API responses into database schema format.
 */

import type { Build } from "azure-devops-node-api/interfaces/BuildInterfaces";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Transformed CI run data ready for database insertion
 */
export interface TransformedCIRun {
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
}

// ============================================================================
// Data Transformation
// ============================================================================

/**
 * Transform Azure Pipelines Build into database schema format
 *
 * Maps Azure Pipelines Build object to the database ci_runs table schema.
 * Note: Flaky test detection happens post-ingestion via batch analysis.
 *
 * Build Status Mapping:
 * - None=0, InProgress=1, Completed=2, Cancelling=4, Postponed=8, NotStarted=32, All=47
 *
 * Build Result Mapping:
 * - None=0, Succeeded=2, PartiallySucceeded=4, Failed=8, Canceled=32
 *
 * @param build - Azure Pipelines build object
 * @param projectName - Name of the project containing the build
 * @param orgName - Name of the Azure DevOps organization
 * @returns Transformed CI run data ready for database insertion
 */
export function transformCIRun(
  build: Build,
  projectName: string,
  orgName: string,
): TransformedCIRun {
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
