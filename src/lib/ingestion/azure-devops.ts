import * as azdev from "azure-devops-node-api";
import type { TeamProjectReference } from "azure-devops-node-api/interfaces/CoreInterfaces";
import {
  type GitPullRequest,
  type GitPullRequestCommentThread,
  type IdentityRefWithVote,
  PullRequestStatus,
} from "azure-devops-node-api/interfaces/GitInterfaces";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { pullRequests } from "@/lib/db/schema";

/**
 * Azure DevOps PR Ingestion Module
 *
 * Implements US2.1: Ingest PR metadata into Postgres
 * - Autodiscovers all projects in Azure DevOps organization
 * - Fetches PR data with pagination and rate limit handling
 * - Transforms ADO API data to database schema
 * - Smart merge: updates existing PRs only if source data is newer
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface IngestionResult {
  success: boolean;
  projectsProcessed: number;
  prsIngested: number;
  prsUpdated: number;
  prsEnriched: number;
  prsWithReviews: number;
  prsWithApprovals: number;
  enrichmentErrors: number;
  errors: Array<{ project?: string; message: string; error?: unknown }>;
}

interface ProjectIngestionResult {
  projectName: string;
  prsIngested: number;
  prsUpdated: number;
  prsEnriched: number;
  prsWithReviews: number;
  prsWithApprovals: number;
  enrichmentErrors: number;
  errors: Array<{ message: string; error?: unknown }>;
}

// ============================================================================
// Configuration & Validation
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
// Azure DevOps API Client
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
// Project Discovery
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

  console.log(`[Project Discovery] Found ${allProjects.length} total projects`);
  console.log(
    `[Project Discovery] Filtered to ${filteredProjects.length} projects (excluded: ${excludeProjects.join(", ") || "none"})`,
  );
  console.log(
    `[Project Discovery] Processing projects: ${filteredProjects.map((p) => p.name).join(", ")}`,
  );

  return filteredProjects;
}

// ============================================================================
// PR Fetching with Pagination
// ============================================================================

async function fetchAllPRsForProject(
  connection: azdev.WebApi,
  projectName: string,
): Promise<GitPullRequest[]> {
  const gitApi = await connection.getGitApi();
  const allPRs: GitPullRequest[] = [];

  try {
    // Get all repositories in the project
    const repos = await gitApi.getRepositories(projectName);
    console.log(
      `[${projectName}] Found ${repos.length} repositories to process`,
    );

    // Fetch PRs from each repository
    for (const repo of repos) {
      if (!repo.id || !repo.name) continue;

      try {
        // Fetch PRs with pagination (Azure DevOps uses $top and $skip)
        let skip = 0;
        const top = 100; // Fetch 100 PRs at a time
        let hasMore = true;

        while (hasMore) {
          const prs = await gitApi.getPullRequests(
            repo.id,
            {
              // Fetch all PRs (completed, active, abandoned)
              // PullRequestStatus.All (4) includes all statuses
              status: PullRequestStatus.All,
            },
            projectName,
            top,
            skip,
          );

          if (prs.length === 0) {
            hasMore = false;
          } else {
            allPRs.push(...prs);
            skip += top;

            // Small delay to avoid rate limits
            await sleep(100);
          }
        }

        console.log(
          `[${projectName}/${repo.name}] Fetched ${allPRs.length} PRs`,
        );
      } catch (error) {
        console.error(
          `[${projectName}/${repo.name}] Error fetching PRs:`,
          error,
        );
        // Continue processing other repos even if one fails
      }
    }
  } catch (error) {
    console.error(`[${projectName}] Error fetching repositories:`, error);
    throw error;
  }

  return allPRs;
}

// ============================================================================
// Review Timestamp Enrichment (US2.1b)
// ============================================================================

/**
 * Calculate firstReviewAt from PR threads
 * Returns the earliest publishedDate from non-deleted threads with comments
 */
export function calculateFirstReviewAt(
  threads: GitPullRequestCommentThread[],
): Date | null {
  const validThreads = threads
    .filter((thread) => {
      // Filter out deleted threads
      if (thread.isDeleted) return false;

      // Filter out threads with no comments
      if (!thread.comments || thread.comments.length === 0) return false;

      // Must have a published date
      if (!thread.publishedDate) return false;

      return true;
    })
    .map((thread) => thread.publishedDate as Date)
    .sort((a, b) => a.getTime() - b.getTime());

  return validThreads.length > 0 ? validThreads[0] : null;
}

/**
 * Calculate approvedAt from PR reviewers and threads
 * Infers approval timestamp by matching approver identity to thread authors
 *
 * Note: Azure DevOps API doesn't expose explicit vote timestamps, so we approximate
 * by finding the earliest thread created by a reviewer who has vote=10 (approved)
 */
export function calculateApprovedAt(
  reviewers: IdentityRefWithVote[],
  threads: GitPullRequestCommentThread[],
): Date | null {
  // Find approvers (vote = 10)
  const approvers = reviewers.filter((r) => r.vote === 10);

  if (approvers.length === 0) {
    return null;
  }

  // Find threads created by approvers
  const approverThreads: Date[] = [];

  for (const approver of approvers) {
    for (const thread of threads) {
      // Skip deleted threads or threads without comments
      if (
        thread.isDeleted ||
        !thread.comments ||
        thread.comments.length === 0
      ) {
        continue;
      }

      // Check if any comment in this thread is from the approver
      const hasApproverComment = thread.comments.some((comment) => {
        if (!comment.author) return false;

        // Match by display name or unique name
        return (
          comment.author.displayName === approver.displayName ||
          comment.author.uniqueName === approver.uniqueName ||
          comment.author.id === approver.id
        );
      });

      if (hasApproverComment && thread.publishedDate) {
        approverThreads.push(thread.publishedDate);
      }
    }
  }

  // Return earliest thread from an approver
  if (approverThreads.length === 0) {
    return null;
  }

  return approverThreads.sort((a, b) => a.getTime() - b.getTime())[0];
}

/**
 * Enrich PR with review timestamps by querying Azure DevOps APIs
 * Returns firstReviewAt and approvedAt, or null if not available
 */
async function enrichPRReviewTimestamps(
  connection: azdev.WebApi,
  pr: GitPullRequest,
  projectName: string,
): Promise<{
  firstReviewAt: Date | null;
  approvedAt: Date | null;
}> {
  try {
    // Validate required fields
    if (!pr.repository?.id || !pr.pullRequestId) {
      console.warn(
        `[Enrichment] Missing repository ID or PR ID for PR ${pr.pullRequestId}`,
      );
      return { firstReviewAt: null, approvedAt: null };
    }

    const gitApi = await connection.getGitApi();

    // Fetch threads and reviewers in parallel
    const [threads, reviewers] = await Promise.all([
      gitApi.getThreads(pr.repository.id, pr.pullRequestId, projectName),
      gitApi.getPullRequestReviewers(
        pr.repository.id,
        pr.pullRequestId,
        projectName,
      ),
    ]);

    // Calculate timestamps
    const firstReviewAt = calculateFirstReviewAt(threads);
    const approvedAt = calculateApprovedAt(reviewers, threads);

    return { firstReviewAt, approvedAt };
  } catch (error) {
    // Log error but don't throw - gracefully handle enrichment failures
    console.warn(
      `[Enrichment] Failed to enrich PR ${pr.pullRequestId} in ${projectName}:`,
      error instanceof Error ? error.message : error,
    );
    return { firstReviewAt: null, approvedAt: null };
  }
}

// ============================================================================
// Data Transformation
// ============================================================================

function transformPullRequest(
  pr: GitPullRequest,
  projectName: string,
  orgName: string,
): {
  prNumber: number;
  repoName: string;
  orgName: string;
  projectName: string;
  title: string;
  author: string;
  state: string;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  mergedAt: Date | null;
  firstReviewAt: Date | null;
  approvedAt: Date | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
  isDraft: boolean;
  baseBranch: string;
  headBranch: string | null;
} {
  // Extract repository name from repository object
  const repoName = pr.repository?.name || "unknown";

  // Map PR status to state
  // Azure DevOps PullRequestStatus enum: 0=notSet, 1=active, 2=abandoned, 3=completed
  let state = "open";
  if (pr.status === 3) {
    // Completed
    state = "merged";
  } else if (pr.status === 2) {
    // Abandoned
    state = "closed";
  }

  // Calculate additions and deletions (may not be available in basic API)
  // We'll default to 0 if not available - enrichment can happen later
  const additions = 0; // Not available in basic PR API
  const deletions = 0; // Not available in basic PR API
  const changedFiles = 0; // Not available in basic PR API

  // Extract labels from PR (if available)
  const labels: string[] = pr.labels?.map((label) => label.name || "") || [];

  // Determine if PR is draft
  const isDraft = pr.isDraft || false;

  // Extract branch names
  const baseBranch = pr.targetRefName?.replace("refs/heads/", "") || "main";
  const headBranch = pr.sourceRefName?.replace("refs/heads/", "") || null;

  // Map timestamps
  const createdAt = pr.creationDate ? new Date(pr.creationDate) : new Date();

  // FIX: Use creationDate as fallback instead of new Date() to avoid creating fresh timestamps
  // This ensures the smart merge logic works correctly by comparing actual PR update times
  const updatedAt = pr.closedDate
    ? new Date(pr.closedDate)
    : new Date(pr.creationDate || new Date());

  const closedAt = pr.closedDate ? new Date(pr.closedDate) : null;

  // Debug logging to understand what Azure DevOps API is returning
  console.log(
    `[Transform] PR #${pr.pullRequestId} "${pr.title?.substring(0, 50)}...":`,
    {
      rawStatus: pr.status,
      mappedState: state,
      creationDate: pr.creationDate,
      closedDate: pr.closedDate,
      computedUpdatedAt: updatedAt.toISOString(),
      repo: repoName,
      project: projectName,
    },
  );

  // mergedAt approximation: use closedDate when status=3 (completed)
  const mergedAt =
    pr.status === 3 && pr.closedDate ? new Date(pr.closedDate) : null;

  // Review timestamps not available in basic API (deferred to US2.1b)
  const firstReviewAt = null;
  const approvedAt = null;

  return {
    prNumber: pr.pullRequestId || 0,
    repoName,
    orgName,
    projectName,
    title: pr.title || "Untitled PR",
    author: pr.createdBy?.displayName || "Unknown",
    state,
    createdAt,
    updatedAt,
    closedAt,
    mergedAt,
    firstReviewAt,
    approvedAt,
    additions,
    deletions,
    changedFiles,
    labels,
    isDraft,
    baseBranch,
    headBranch,
  };
}

// ============================================================================
// Smart Merge (Upsert with Conditional Update)
// ============================================================================

async function upsertPullRequest(
  prData: ReturnType<typeof transformPullRequest>,
): Promise<"inserted" | "updated" | "skipped"> {
  try {
    // Check if PR already exists
    const existing = await db
      .select()
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.prNumber, prData.prNumber),
          eq(pullRequests.repoName, prData.repoName),
          eq(pullRequests.projectName, prData.projectName),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      // Insert new PR
      await db.insert(pullRequests).values(prData);
      return "inserted";
    }

    // PR exists - check if we should update
    const existingPR = existing[0];

    // Smart merge: update if:
    // 1. Source data is newer (updatedAt timestamp changed), OR
    // 2. We're enriching with new review timestamps that were previously null
    const hasNewEnrichmentData =
      (prData.firstReviewAt !== null && existingPR.firstReviewAt === null) ||
      (prData.approvedAt !== null && existingPR.approvedAt === null);

    if (prData.updatedAt > existingPR.updatedAt || hasNewEnrichmentData) {
      await db
        .update(pullRequests)
        .set(prData)
        .where(
          and(
            eq(pullRequests.prNumber, prData.prNumber),
            eq(pullRequests.repoName, prData.repoName),
            eq(pullRequests.projectName, prData.projectName),
          ),
        );
      return "updated";
    }

    return "skipped";
  } catch (error) {
    console.error(
      `[Upsert] Error upserting PR ${prData.prNumber} in ${prData.projectName}/${prData.repoName}:`,
      error,
    );
    throw error;
  }
}

// ============================================================================
// Project-Level Ingestion
// ============================================================================

async function ingestProjectPRs(
  connection: azdev.WebApi,
  project: TeamProjectReference,
  orgName: string,
): Promise<ProjectIngestionResult> {
  const projectName = project.name || "Unknown";
  const result: ProjectIngestionResult = {
    projectName,
    prsIngested: 0,
    prsUpdated: 0,
    prsEnriched: 0,
    prsWithReviews: 0,
    prsWithApprovals: 0,
    enrichmentErrors: 0,
    errors: [],
  };

  try {
    console.log(`[${projectName}] Starting PR ingestion...`);

    // Fetch all PRs for this project
    const prs = await fetchAllPRsForProject(connection, projectName);

    console.log(`[${projectName}] Processing ${prs.length} PRs...`);

    // Process each PR
    for (const pr of prs) {
      try {
        // Transform PR data
        const prData = transformPullRequest(pr, projectName, orgName);

        // Enrich with review timestamps
        try {
          const reviewTimestamps = await enrichPRReviewTimestamps(
            connection,
            pr,
            projectName,
          );

          prData.firstReviewAt = reviewTimestamps.firstReviewAt;
          prData.approvedAt = reviewTimestamps.approvedAt;

          // Track enrichment statistics
          if (
            reviewTimestamps.firstReviewAt !== null ||
            reviewTimestamps.approvedAt !== null
          ) {
            result.prsEnriched++;
          }

          if (reviewTimestamps.firstReviewAt !== null) {
            result.prsWithReviews++;
          }

          if (reviewTimestamps.approvedAt !== null) {
            result.prsWithApprovals++;
          }

          // Small delay to avoid rate limits (2 additional API calls per PR)
          await sleep(100);
        } catch (error) {
          // Log warning but continue - enrichment failure shouldn't block ingestion
          result.enrichmentErrors++;
          console.warn(
            `[${projectName}] Failed to enrich PR ${pr.pullRequestId}:`,
            error instanceof Error ? error.message : error,
          );
          // Keep timestamps as null (already set in transformPullRequest)
        }

        // Upsert to database
        const action = await upsertPullRequest(prData);

        if (action === "inserted") {
          result.prsIngested++;
        } else if (action === "updated") {
          result.prsUpdated++;
        }
      } catch (error) {
        result.errors.push({
          message: `Failed to process PR ${pr.pullRequestId}`,
          error,
        });
      }
    }

    console.log(
      `[${projectName}] Completed: ${result.prsIngested} inserted, ${result.prsUpdated} updated, ${result.prsEnriched} enriched (${result.prsWithReviews} with reviews, ${result.prsWithApprovals} with approvals), ${result.enrichmentErrors} enrichment errors, ${result.errors.length} errors`,
    );
  } catch (error) {
    result.errors.push({
      message: `Failed to fetch PRs for project ${projectName}`,
      error,
    });
  }

  return result;
}

// ============================================================================
// Main Ingestion Entry Point
// ============================================================================

export async function ingestPullRequests(): Promise<IngestionResult> {
  const startTime = Date.now();
  console.log("[Ingestion] Starting Azure DevOps PR ingestion...");

  const result: IngestionResult = {
    success: true,
    projectsProcessed: 0,
    prsIngested: 0,
    prsUpdated: 0,
    prsEnriched: 0,
    prsWithReviews: 0,
    prsWithApprovals: 0,
    enrichmentErrors: 0,
    errors: [],
  };

  try {
    // Get configuration
    const { pat, org, excludeProjects } = getAzureDevOpsConfig();
    console.log(`[Ingestion] Organization: ${org}`);
    console.log(
      `[Ingestion] Excluded projects: ${excludeProjects.join(", ") || "none"}`,
    );

    // Create Azure DevOps connection
    const connection = await createAzureDevOpsConnection(org, pat);
    console.log("[Ingestion] Connected to Azure DevOps");

    // Discover projects
    const projects = await discoverProjects(connection, excludeProjects);

    // Process projects in parallel (3 at a time) for better performance
    // This provides ~3x speedup while respecting Azure DevOps API rate limits
    const PROJECT_CONCURRENCY = 3;

    // Process projects in batches
    for (let i = 0; i < projects.length; i += PROJECT_CONCURRENCY) {
      const batch = projects.slice(i, i + PROJECT_CONCURRENCY);

      const batchPromises = batch.map(async (project) => {
        try {
          const projectResult = await ingestProjectPRs(
            connection,
            project,
            org,
          );

          result.projectsProcessed++;
          result.prsIngested += projectResult.prsIngested;
          result.prsUpdated += projectResult.prsUpdated;
          result.prsEnriched += projectResult.prsEnriched;
          result.prsWithReviews += projectResult.prsWithReviews;
          result.prsWithApprovals += projectResult.prsWithApprovals;
          result.enrichmentErrors += projectResult.enrichmentErrors;

          // Add project-specific errors to overall errors
          for (const error of projectResult.errors) {
            result.errors.push({
              project: projectResult.projectName,
              ...error,
            });
          }
        } catch (error) {
          result.errors.push({
            project: project.name || "Unknown",
            message: "Failed to ingest project",
            error,
          });
          // Continue processing other projects
        }
      });

      // Wait for current batch to complete before starting next batch
      await Promise.allSettled(batchPromises);
    }

    // Determine overall success
    result.success = result.errors.length === 0;

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const enrichmentRate =
      result.prsIngested + result.prsUpdated > 0
        ? (
            (result.prsEnriched / (result.prsIngested + result.prsUpdated)) *
            100
          ).toFixed(1)
        : "0.0";
    console.log(
      `[Ingestion] Completed in ${duration}s: ${result.projectsProcessed} projects, ${result.prsIngested} inserted, ${result.prsUpdated} updated, ${result.prsEnriched} enriched (${enrichmentRate}% - ${result.prsWithReviews} with reviews, ${result.prsWithApprovals} with approvals), ${result.enrichmentErrors} enrichment errors, ${result.errors.length} errors`,
    );
  } catch (error) {
    result.success = false;
    result.errors.push({
      message: "Fatal error during ingestion",
      error,
    });
    console.error("[Ingestion] Fatal error:", error);
  }

  return result;
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
