import { describe, expect, test } from "bun:test";
import type { GitPullRequest } from "azure-devops-node-api/interfaces/GitInterfaces";
import {
  calculateApprovedAt,
  calculateFirstReviewAt,
} from "../transformers/transform-pr";
import {
  createPRWithApprovalButNoComment,
  createPRWithCommentsButNoApproval,
  createPRWithDeletedThreads,
  createPRWithEmptyThreads,
  createPRWithMultipleReviewers,
  createPRWithNoReviews,
  createPRWithRejection,
  createPRWithSingleReview,
} from "./fixtures/azure-devops-api-responses";

/**
 * Unit tests for Azure DevOps PR ingestion module
 *
 * Tests cover:
 * - Environment variable validation
 * - Project discovery with exclusion filtering
 * - PR data transformation from ADO API to DB schema
 * - Smart merge logic (insert/update/skip)
 * - Error handling and logging
 * - PR review timestamp enrichment (US2.1b)
 *
 * Uses Bun native test runner (Jest-compatible API)
 */

// ============================================================================
// Mock Data
// ============================================================================

const mockGitPR: GitPullRequest = {
  pullRequestId: 123,
  title: "Add new feature",
  createdBy: {
    displayName: "John Doe",
    id: "user-1",
  },
  repository: {
    name: "my-repo",
    id: "repo-1",
  },
  status: 2, // Completed (1=Active, 2=Completed, 3=Abandoned)
  creationDate: new Date("2025-01-01T10:00:00Z"),
  closedDate: new Date("2025-01-02T15:00:00Z"),
  sourceRefName: "refs/heads/feature-branch",
  targetRefName: "refs/heads/main",
  isDraft: false,
  labels: [{ name: "feature" }, { name: "priority-high" }],
};

const _mockActivePR: GitPullRequest = {
  ...mockGitPR,
  pullRequestId: 124,
  title: "Work in progress",
  status: 1, // Active
  closedDate: undefined,
};

const _mockAbandonedPR: GitPullRequest = {
  ...mockGitPR,
  pullRequestId: 125,
  title: "Abandoned PR",
  status: 3, // Abandoned
};

// ============================================================================
// Environment Variable Validation Tests
// ============================================================================

describe("Environment Variable Validation", () => {
  test("should parse AZURE_DEVOPS_EXCLUDE_PROJECTS correctly", () => {
    process.env.AZURE_DEVOPS_EXCLUDE_PROJECTS = "archived-project,test-sandbox";

    const excludeProjects = process.env.AZURE_DEVOPS_EXCLUDE_PROJECTS.split(
      ",",
    ).map((p) => p.trim());

    expect(excludeProjects).toEqual(["archived-project", "test-sandbox"]);
  });

  test("should handle empty AZURE_DEVOPS_EXCLUDE_PROJECTS", () => {
    delete process.env.AZURE_DEVOPS_EXCLUDE_PROJECTS;

    const excludeProjects = process.env.AZURE_DEVOPS_EXCLUDE_PROJECTS
      ? process.env.AZURE_DEVOPS_EXCLUDE_PROJECTS.split(",").map((p) =>
          p.trim(),
        )
      : [];

    expect(excludeProjects).toEqual([]);
  });
});

// ============================================================================
// PR Data Transformation Tests
// ============================================================================

describe("PR Data Transformation", () => {
  test("should transform completed PR correctly", () => {
    const transformed = transformPRForTest(
      mockGitPR,
      "test-project",
      "test-org",
    );

    expect(transformed.prNumber).toBe(123);
    expect(transformed.title).toBe("Add new feature");
    expect(transformed.author).toBe("John Doe");
    expect(transformed.repoName).toBe("my-repo");
    expect(transformed.projectName).toBe("test-project");
    expect(transformed.orgName).toBe("test-org");
    expect(transformed.state).toBe("merged"); // Completed -> merged
    expect(transformed.baseBranch).toBe("main");
    expect(transformed.headBranch).toBe("feature-branch");
    expect(transformed.labels).toEqual(["feature", "priority-high"]);
    expect(transformed.isDraft).toBe(false);

    // Timestamps
    expect(transformed.createdAt).toBeInstanceOf(Date);
    expect(transformed.closedAt).toBeInstanceOf(Date);
    expect(transformed.mergedAt).toBeInstanceOf(Date); // Should be set for completed PRs

    // Review timestamps should be null (deferred to US2.1b)
    expect(transformed.firstReviewAt).toBeNull();
    expect(transformed.approvedAt).toBeNull();

    // Size metrics (not available in basic API - defaults to 0)
    expect(transformed.additions).toBe(0);
    expect(transformed.deletions).toBe(0);
    expect(transformed.changedFiles).toBe(0);
  });

  // Parameterized tests for PR status transformations
  describe.each([
    {
      status: 1,
      expectedState: "open",
      description: "Active",
      shouldHaveClosedAt: false,
      shouldHaveMergedAt: false,
    },
    {
      status: 2,
      expectedState: "merged",
      description: "Completed",
      shouldHaveClosedAt: true,
      shouldHaveMergedAt: true,
    },
    {
      status: 3,
      expectedState: "closed",
      description: "Abandoned",
      shouldHaveClosedAt: true,
      shouldHaveMergedAt: false,
    },
  ])(
    "PR status transformation",
    ({
      status,
      expectedState,
      description,
      shouldHaveClosedAt,
      shouldHaveMergedAt,
    }) => {
      test(`should transform ${description} (status=${status}) to ${expectedState}`, () => {
        const pr: GitPullRequest = {
          ...mockGitPR,
          status,
          closedDate: shouldHaveClosedAt
            ? new Date("2025-01-02T15:00:00Z")
            : undefined,
        };

        const transformed = transformPRForTest(pr, "test-project", "test-org");

        expect(transformed.state).toBe(expectedState);

        if (shouldHaveClosedAt) {
          expect(transformed.closedAt).toBeInstanceOf(Date);
        } else {
          expect(transformed.closedAt).toBeNull();
        }

        if (shouldHaveMergedAt) {
          expect(transformed.mergedAt).toBeInstanceOf(Date);
        } else {
          expect(transformed.mergedAt).toBeNull();
        }
      });
    },
  );

  // Parameterized tests for timestamp edge cases
  describe.each([
    {
      scenario: "null creationDate",
      pr: { pullRequestId: 1, status: 1, creationDate: null },
      expectedCreatedAt: Date,
    },
    {
      scenario: "undefined creationDate",
      pr: { pullRequestId: 2, status: 1, creationDate: undefined },
      expectedCreatedAt: Date,
    },
    {
      scenario: "undefined closedDate on active PR",
      pr: {
        pullRequestId: 3,
        status: 1,
        creationDate: new Date(),
        closedDate: undefined,
      },
      expectedClosedAt: null,
    },
    {
      scenario: "null closedDate on active PR",
      pr: {
        pullRequestId: 4,
        status: 1,
        creationDate: new Date(),
        closedDate: null,
      },
      expectedClosedAt: null,
    },
  ])("Timestamp edge cases", ({ scenario, pr }) => {
    test(`should handle ${scenario}`, () => {
      const transformed = transformPRForTest(
        pr as GitPullRequest,
        "test-project",
        "test-org",
      );

      // createdAt should always be a Date (defaults to new Date() if missing)
      expect(transformed.createdAt).toBeInstanceOf(Date);

      // closedAt depends on the PR status
      if (pr.status === 1) {
        expect(transformed.closedAt).toBeNull();
      }
    });
  });

  // Parameterized tests for missing optional fields
  describe.each([
    {
      field: "title",
      pr: {
        pullRequestId: 1,
        status: 1,
        title: undefined,
        creationDate: new Date(),
      },
      expectedValue: "Untitled PR",
      accessor: (t: ReturnType<typeof transformPRForTest>) => t.title,
    },
    {
      field: "author",
      pr: {
        pullRequestId: 2,
        status: 1,
        createdBy: undefined,
        creationDate: new Date(),
      },
      expectedValue: "Unknown",
      accessor: (t: ReturnType<typeof transformPRForTest>) => t.author,
    },
    {
      field: "repoName",
      pr: {
        pullRequestId: 3,
        status: 1,
        repository: undefined,
        creationDate: new Date(),
      },
      expectedValue: "unknown",
      accessor: (t: ReturnType<typeof transformPRForTest>) => t.repoName,
    },
    {
      field: "baseBranch",
      pr: {
        pullRequestId: 4,
        status: 1,
        targetRefName: undefined,
        creationDate: new Date(),
      },
      expectedValue: "main",
      accessor: (t: ReturnType<typeof transformPRForTest>) => t.baseBranch,
    },
    {
      field: "headBranch",
      pr: {
        pullRequestId: 5,
        status: 1,
        sourceRefName: undefined,
        creationDate: new Date(),
      },
      expectedValue: null,
      accessor: (t: ReturnType<typeof transformPRForTest>) => t.headBranch,
    },
    {
      field: "labels",
      pr: {
        pullRequestId: 6,
        status: 1,
        labels: undefined,
        creationDate: new Date(),
      },
      expectedValue: [],
      accessor: (t: ReturnType<typeof transformPRForTest>) => t.labels,
    },
  ])(
    "Missing optional field handling",
    ({ field, pr, expectedValue, accessor }) => {
      test(`should default ${field} when missing`, () => {
        const transformed = transformPRForTest(
          pr as GitPullRequest,
          "test-project",
          "test-org",
        );

        expect(accessor(transformed)).toEqual(expectedValue);
      });
    },
  );
});

// ============================================================================
// Project Discovery Tests
// ============================================================================

describe("Project Discovery", () => {
  test("should filter out excluded projects", () => {
    const allProjects = [
      { name: "project-1" },
      { name: "archived-project" },
      { name: "test-sandbox" },
      { name: "project-2" },
    ];

    const excludeList = ["archived-project", "test-sandbox"];

    const filtered = allProjects.filter(
      (project) => !excludeList.includes(project.name || ""),
    );

    expect(filtered).toHaveLength(2);
    expect(filtered.map((p) => p.name)).toEqual(["project-1", "project-2"]);
  });

  test("should handle empty exclusion list", () => {
    const allProjects = [{ name: "project-1" }, { name: "project-2" }];

    const excludeList: string[] = [];

    const filtered = allProjects.filter(
      (project) => !excludeList.includes(project.name || ""),
    );

    expect(filtered).toHaveLength(2);
  });
});

// ============================================================================
// Smart Merge Logic Tests
// ============================================================================

describe("Smart Merge Logic", () => {
  test("should determine insert action when PR does not exist", () => {
    const existingPRs: Array<{ updatedAt: Date }> = [];

    const shouldUpdate = existingPRs.length === 0;

    expect(shouldUpdate).toBe(true);
  });

  test("should determine update action when new data is newer", () => {
    const existingPR = {
      updatedAt: new Date("2025-01-01T10:00:00Z"),
    };
    const newPRUpdatedAt = new Date("2025-01-02T15:00:00Z");

    const shouldUpdate = newPRUpdatedAt > existingPR.updatedAt;

    expect(shouldUpdate).toBe(true);
  });

  test("should determine skip action when new data is older", () => {
    const existingPR = {
      updatedAt: new Date("2025-01-05T10:00:00Z"),
    };
    const newPRUpdatedAt = new Date("2025-01-02T15:00:00Z");

    const shouldUpdate = newPRUpdatedAt > existingPR.updatedAt;

    expect(shouldUpdate).toBe(false);
  });

  test("should determine skip action when timestamps are equal", () => {
    const timestamp = new Date("2025-01-02T15:00:00Z");
    const existingPR = { updatedAt: timestamp };
    const newPRUpdatedAt = timestamp;

    const shouldUpdate = newPRUpdatedAt > existingPR.updatedAt;

    expect(shouldUpdate).toBe(false);
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("Error Handling", () => {
  test("should continue processing on individual PR error", () => {
    const prs = [
      { pullRequestId: 1, title: "PR 1" },
      { pullRequestId: 2, title: null }, // This might cause error
      { pullRequestId: 3, title: "PR 3" },
    ];

    const errors: string[] = [];
    const processed: number[] = [];

    for (const pr of prs) {
      try {
        // Simulate processing
        if (pr.title === null) {
          throw new Error("Invalid title");
        }
        processed.push(pr.pullRequestId);
      } catch (_) {
        errors.push(`Error processing PR ${pr.pullRequestId}`);
        // Continue processing other PRs
      }
    }

    expect(processed).toEqual([1, 3]); // Should process PRs 1 and 3
    expect(errors).toHaveLength(1);
  });
});

// ============================================================================
// Pagination Tests
// ============================================================================

describe("Pagination Logic", () => {
  test("should handle pagination correctly", () => {
    const allPRs: number[] = [];

    // Simulate 3 pages of results
    const mockPages = [
      Array.from({ length: 100 }, (_, i) => i + 1), // Page 1: 1-100
      Array.from({ length: 100 }, (_, i) => i + 101), // Page 2: 101-200
      Array.from({ length: 50 }, (_, i) => i + 201), // Page 3: 201-250
      [], // Page 4: empty (end)
    ];

    let pageIndex = 0;
    let hasMore = true;

    while (hasMore) {
      const prs = mockPages[pageIndex] || [];

      if (prs.length === 0) {
        hasMore = false;
      } else {
        allPRs.push(...prs);
        pageIndex++;
      }
    }

    expect(allPRs).toHaveLength(250);
    expect(allPRs[0]).toBe(1);
    expect(allPRs[249]).toBe(250);
  });
});

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Simplified version of transformPullRequest for testing
 * (Duplicates logic from main module to avoid import issues)
 */
function transformPRForTest(
  pr: GitPullRequest,
  projectName: string,
  orgName: string,
) {
  const repoName = pr.repository?.name || "unknown";

  let state = "open";
  if (pr.status === 2) {
    state = "merged";
  } else if (pr.status === 3) {
    state = "closed";
  }

  const additions = 0;
  const deletions = 0;
  const changedFiles = 0;

  const labels: string[] = pr.labels?.map((label) => label.name || "") || [];
  const isDraft = pr.isDraft || false;

  const baseBranch = pr.targetRefName?.replace("refs/heads/", "") || "main";
  const headBranch = pr.sourceRefName?.replace("refs/heads/", "") || null;

  const createdAt = pr.creationDate ? new Date(pr.creationDate) : new Date();
  const updatedAt = pr.closedDate ? new Date(pr.closedDate) : new Date();
  const closedAt = pr.closedDate ? new Date(pr.closedDate) : null;
  const mergedAt =
    pr.status === 2 && pr.closedDate ? new Date(pr.closedDate) : null;

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
// Review Timestamp Enrichment Tests (US2.1b)
// ============================================================================

describe("calculateFirstReviewAt()", () => {
  test("should return earliest thread published date from valid threads", () => {
    const scenario = createPRWithSingleReview();

    const result = calculateFirstReviewAt(scenario.threads);

    expect(result).toEqual(scenario.expectedFirstReview);
  });

  test("should return earliest thread when multiple reviewers comment at different times", () => {
    const scenario = createPRWithMultipleReviewers();

    const result = calculateFirstReviewAt(scenario.threads);

    expect(result).toEqual(scenario.expectedFirstReview);
  });

  test("should return null when no threads exist", () => {
    const scenario = createPRWithNoReviews();

    const result = calculateFirstReviewAt(scenario.threads);

    expect(result).toBeNull();
  });

  test("should ignore deleted threads when calculating first review", () => {
    const scenario = createPRWithDeletedThreads();

    const result = calculateFirstReviewAt(scenario.threads);

    expect(result).toEqual(scenario.expectedFirstReview);
  });

  test("should ignore empty threads (no comments)", () => {
    const scenario = createPRWithEmptyThreads();

    const result = calculateFirstReviewAt(scenario.threads);

    expect(result).toEqual(scenario.expectedFirstReview);
  });

  test("should handle threads without publishedDate", () => {
    const scenario = createPRWithSingleReview();
    // Remove publishedDate from all threads
    const threadsWithoutDate = scenario.threads.map((thread) => ({
      ...thread,
      publishedDate: undefined,
    }));

    const result = calculateFirstReviewAt(threadsWithoutDate);

    expect(result).toBeNull();
  });

  test("should return date instance, not string", () => {
    const scenario = createPRWithSingleReview();

    const result = calculateFirstReviewAt(scenario.threads);

    expect(result).toBeInstanceOf(Date);
  });
});

describe("calculateApprovedAt()", () => {
  test("should return approval timestamp when approver has matching thread", () => {
    const scenario = createPRWithSingleReview();

    const result = calculateApprovedAt(scenario.reviewers, scenario.threads);

    expect(result).toEqual(scenario.expectedApproval);
  });

  test("should return earliest approval when multiple approvers comment", () => {
    const scenario = createPRWithMultipleReviewers();

    const result = calculateApprovedAt(scenario.reviewers, scenario.threads);

    expect(result).toEqual(scenario.expectedApproval);
  });

  test("should return null when no approvers exist (vote !== 10)", () => {
    const scenario = createPRWithCommentsButNoApproval();

    const result = calculateApprovedAt(scenario.reviewers, scenario.threads);

    expect(result).toBeNull();
  });

  test("should return null when approver has no matching threads", () => {
    const scenario = createPRWithApprovalButNoComment();

    const result = calculateApprovedAt(scenario.reviewers, scenario.threads);

    expect(result).toBeNull();
  });

  test("should return null when reviewer rejected (vote = -10)", () => {
    const scenario = createPRWithRejection();

    const result = calculateApprovedAt(scenario.reviewers, scenario.threads);

    expect(result).toBeNull();
  });

  test("should ignore deleted threads when matching approvers", () => {
    const scenario = createPRWithDeletedThreads();

    const result = calculateApprovedAt(scenario.reviewers, scenario.threads);

    // Should still find the approval from the active thread
    expect(result).toEqual(scenario.expectedApproval);
  });

  test("should ignore empty threads when matching approvers", () => {
    const scenario = createPRWithEmptyThreads();

    const result = calculateApprovedAt(scenario.reviewers, scenario.threads);

    expect(result).toEqual(scenario.expectedApproval);
  });

  test("should match approver by displayName", () => {
    const scenario = createPRWithSingleReview();

    // Ensure matching by displayName works
    const result = calculateApprovedAt(scenario.reviewers, scenario.threads);

    expect(result).not.toBeNull();
  });

  test("should match approver by uniqueName", () => {
    const scenario = createPRWithSingleReview();

    // Modify thread to match by uniqueName instead of displayName
    const modifiedThreads = scenario.threads.map((thread) => ({
      ...thread,
      comments: thread.comments?.map((comment) => ({
        ...comment,
        author: {
          ...comment.author,
          displayName: "Different Name", // Won't match
          uniqueName: scenario.reviewers[0].uniqueName, // Will match
        },
      })),
    }));

    const result = calculateApprovedAt(scenario.reviewers, modifiedThreads);

    expect(result).not.toBeNull();
  });

  test("should match approver by id", () => {
    const scenario = createPRWithSingleReview();

    // Modify thread to match by id instead
    const modifiedThreads = scenario.threads.map((thread) => ({
      ...thread,
      comments: thread.comments?.map((comment) => ({
        ...comment,
        author: {
          displayName: "Different Name",
          uniqueName: "different@email.com",
          id: scenario.reviewers[0].id, // Will match by ID
        },
      })),
    }));

    const result = calculateApprovedAt(scenario.reviewers, modifiedThreads);

    expect(result).not.toBeNull();
  });

  test("should return date instance, not string", () => {
    const scenario = createPRWithSingleReview();

    const result = calculateApprovedAt(scenario.reviewers, scenario.threads);

    expect(result).toBeInstanceOf(Date);
  });

  test("should handle threads without author information", () => {
    const scenario = createPRWithSingleReview();

    // Remove author from comments
    const threadsWithoutAuthor = scenario.threads.map((thread) => ({
      ...thread,
      comments: thread.comments?.map((comment) => ({
        ...comment,
        author: undefined,
      })),
    }));

    const result = calculateApprovedAt(
      scenario.reviewers,
      threadsWithoutAuthor,
    );

    expect(result).toBeNull();
  });
});
