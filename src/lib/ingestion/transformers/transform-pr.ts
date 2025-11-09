/**
 * Pull Request Transformer
 *
 * Transforms Azure DevOps PR API responses into database schema format.
 * Includes review timestamp enrichment logic.
 */

import type * as azdev from "azure-devops-node-api";
import type {
  GitPullRequest,
  GitPullRequestCommentThread,
  IdentityRefWithVote,
} from "azure-devops-node-api/interfaces/GitInterfaces";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Transformed PR data ready for database insertion
 */
export interface TransformedPullRequest {
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
}

/**
 * Review timestamp enrichment result
 */
export interface ReviewTimestamps {
  firstReviewAt: Date | null;
  approvedAt: Date | null;
}

// ============================================================================
// Review Timestamp Calculation
// ============================================================================

/**
 * Calculate first review timestamp from PR comment threads
 *
 * Returns the earliest publishedDate from non-deleted threads with comments.
 *
 * @param threads - Array of PR comment threads
 * @returns Earliest review timestamp or null if no reviews found
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
 * Calculate approval timestamp from PR reviewers and threads
 *
 * Infers approval timestamp by matching approver identity to thread authors.
 *
 * Note: Azure DevOps API doesn't expose explicit vote timestamps, so we approximate
 * by finding the earliest thread created by a reviewer who has vote=10 (approved).
 *
 * @param reviewers - Array of PR reviewers with votes
 * @param threads - Array of PR comment threads
 * @returns Earliest approval timestamp or null if no approvals found
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
 *
 * Fetches comment threads and reviewers to calculate firstReviewAt and approvedAt.
 *
 * @param connection - Azure DevOps WebApi connection
 * @param pr - Pull request to enrich
 * @param projectName - Name of the project containing the PR
 * @returns Review timestamps (may be null if not available)
 */
export async function enrichPRReviewTimestamps(
  connection: azdev.WebApi,
  pr: GitPullRequest,
  projectName: string,
): Promise<ReviewTimestamps> {
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

/**
 * Transform Azure DevOps PR into database schema format
 *
 * Maps Azure DevOps GitPullRequest to the database pull_requests table schema.
 * Note: This does not include review timestamp enrichment - call enrichPRReviewTimestamps
 * separately to populate firstReviewAt and approvedAt.
 *
 * @param pr - Azure DevOps pull request object
 * @param projectName - Name of the project containing the PR
 * @param orgName - Name of the Azure DevOps organization
 * @returns Transformed PR data ready for database insertion
 */
export function transformPullRequest(
  pr: GitPullRequest,
  projectName: string,
  orgName: string,
): TransformedPullRequest {
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

  // Review timestamps not available in basic API (deferred to enrichment)
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
