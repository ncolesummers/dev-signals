import type * as azdev from "azure-devops-node-api";
import type { GitPullRequest } from "azure-devops-node-api/interfaces/GitInterfaces";
import {
  PullRequestStatus,
  PullRequestTimeRangeType,
} from "azure-devops-node-api/interfaces/GitInterfaces";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { pullRequests } from "@/lib/db/schema";
import {
  createAzureDevOpsConnection,
  discoverProjects,
  getAzureDevOpsConfig,
} from "./azure-devops-client";
import {
  enrichPRReviewTimestamps,
  type TransformedPullRequest,
  transformPullRequest,
} from "./transformers/transform-pr";
import type {
  IngestionResult,
  ProjectIngestionResult,
  TeamProjectReference,
} from "./types";

// Re-export IngestionResult for backward compatibility
export type { IngestionResult };

/**
 * Azure DevOps PR Ingestion Module
 *
 * Implements US2.1: Ingest PR metadata into Postgres
 * - Autodiscovers all projects in Azure DevOps organization
 * - Fetches PR data with pagination and rate limit handling
 * - Transforms ADO API data to database schema
 * - Smart merge: updates existing PRs only if source data is newer
 *
 * This module is now refactored to use shared utilities from:
 * - azure-devops-client.ts: Connection, config, retry logic, rate limiting
 * - transformers/transform-pr.ts: PR transformation and enrichment
 * - types.ts: Shared type definitions
 */

// ============================================================================
// PR Fetching with Pagination
// ============================================================================

async function fetchAllPRsForProject(
  connection: azdev.WebApi,
  projectName: string,
): Promise<GitPullRequest[]> {
  const gitApi = await connection.getGitApi();
  const allPRs: GitPullRequest[] = [];

  // Only fetch PRs from last 90 days to limit data volume
  const NINETY_DAYS_AGO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  try {
    // Get all repositories in the project
    const repos = await gitApi.getRepositories(projectName);
    console.log(
      `[${projectName}] Found ${repos.length} repositories to process`,
    );
    console.log(
      `[${projectName}] Fetching PRs created since ${NINETY_DAYS_AGO.toISOString().split("T")[0]} (90 days)`,
    );

    // Process repositories in parallel (10 at a time) to speed up large projects
    const REPO_CONCURRENCY = 10;

    for (let i = 0; i < repos.length; i += REPO_CONCURRENCY) {
      const repoBatch = repos.slice(i, i + REPO_CONCURRENCY);

      await Promise.all(
        repoBatch.map(async (repo) => {
          if (!repo.id || !repo.name) return;

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
                  // Only fetch PRs created in the last 90 days
                  minTime: NINETY_DAYS_AGO,
                  queryTimeRangeType: PullRequestTimeRangeType.Created,
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
        }),
      );
    }
  } catch (error) {
    console.error(`[${projectName}] Error fetching repositories:`, error);
    throw error;
  }

  return allPRs;
}

// ============================================================================
// Smart Merge (Upsert with Conditional Update)
// ============================================================================

async function upsertPullRequest(
  prData: TransformedPullRequest,
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
