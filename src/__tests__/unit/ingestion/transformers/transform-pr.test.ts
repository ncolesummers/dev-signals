import { describe, expect, test } from "bun:test";
import type { GitPullRequest } from "azure-devops-node-api/interfaces/GitInterfaces";
import { transformPullRequest } from "@/lib/ingestion/transformers/transform-pr";

/**
 * Test Suite for transformPullRequest()
 *
 * Tests the actual production function (not a duplicate helper).
 * This ensures the real code used in production gets coverage.
 */

// Helper to create minimal GitPullRequest with required fields
function createMockPR(overrides: Partial<GitPullRequest> = {}): GitPullRequest {
  return {
    pullRequestId: 123,
    title: "Test PR",
    creationDate: new Date("2025-01-10T10:00:00Z"),
    status: 1, // Active by default
    repository: {
      id: "repo-id",
      name: "test-repo",
    },
    createdBy: {
      displayName: "Test User",
    },
    targetRefName: "refs/heads/main",
    sourceRefName: "refs/heads/feature-branch",
    ...overrides,
  } as GitPullRequest;
}

describe("transformPullRequest()", () => {
  const testProjectName = "test-project";
  const testOrgName = "test-org";

  describe("Status Mapping", () => {
    test("should map status=3 (completed) to state='merged' and set mergedAt", () => {
      const pr = createMockPR({
        status: 3,
        closedDate: new Date("2025-01-11T15:00:00Z"),
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.state).toBe("merged");
      expect(result.mergedAt).toEqual(new Date("2025-01-11T15:00:00Z"));
      expect(result.closedAt).toEqual(new Date("2025-01-11T15:00:00Z"));
    });

    test("should map status=2 (abandoned) to state='closed' with mergedAt=null", () => {
      const pr = createMockPR({
        status: 2,
        closedDate: new Date("2025-01-11T15:00:00Z"),
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.state).toBe("closed");
      expect(result.mergedAt).toBeNull();
      expect(result.closedAt).toEqual(new Date("2025-01-11T15:00:00Z"));
    });

    test("should map status=1 (active) to state='open' with closedAt=null and mergedAt=null", () => {
      const pr = createMockPR({
        status: 1,
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.state).toBe("open");
      expect(result.closedAt).toBeNull();
      expect(result.mergedAt).toBeNull();
    });

    test("should map status=0 (not set) to state='open' (default)", () => {
      const pr = createMockPR({
        status: 0,
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.state).toBe("open");
      expect(result.closedAt).toBeNull();
      expect(result.mergedAt).toBeNull();
    });
  });

  describe("Field Mapping and Defaults", () => {
    test("should extract repository name when repository is present", () => {
      const pr = createMockPR({
        repository: {
          id: "repo-id",
          name: "my-awesome-repo",
        },
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.repoName).toBe("my-awesome-repo");
    });

    test("should default to 'unknown' when repository is missing", () => {
      const pr = createMockPR({
        repository: undefined,
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.repoName).toBe("unknown");
    });

    test("should extract author displayName when createdBy is present", () => {
      const pr = createMockPR({
        createdBy: {
          displayName: "John Doe",
        },
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.author).toBe("John Doe");
    });

    test("should default to 'Unknown' when createdBy is missing", () => {
      const pr = createMockPR({
        createdBy: undefined,
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.author).toBe("Unknown");
    });

    test("should default to 'Untitled PR' when title is missing", () => {
      const pr = createMockPR({
        title: undefined,
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.title).toBe("Untitled PR");
    });

    test("should default to 0 when pullRequestId is missing", () => {
      const pr = createMockPR({
        pullRequestId: undefined,
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.prNumber).toBe(0);
    });

    test("should use provided orgName and projectName", () => {
      const pr = createMockPR();

      const result = transformPullRequest(pr, "my-project", "my-org");

      expect(result.projectName).toBe("my-project");
      expect(result.orgName).toBe("my-org");
    });
  });

  describe("Branch Name Parsing", () => {
    test("should parse targetRefName to baseBranch (strip refs/heads/ prefix)", () => {
      const pr = createMockPR({
        targetRefName: "refs/heads/main",
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.baseBranch).toBe("main");
    });

    test("should parse sourceRefName to headBranch (strip refs/heads/ prefix)", () => {
      const pr = createMockPR({
        sourceRefName: "refs/heads/feature-xyz",
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.headBranch).toBe("feature-xyz");
    });

    test("should handle nested branch names (feature/sub-feature)", () => {
      const pr = createMockPR({
        targetRefName: "refs/heads/release/v1.2.3",
        sourceRefName: "refs/heads/feature/add-new-api",
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.baseBranch).toBe("release/v1.2.3");
      expect(result.headBranch).toBe("feature/add-new-api");
    });

    test("should default to 'main' when targetRefName is missing", () => {
      const pr = createMockPR({
        targetRefName: undefined,
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.baseBranch).toBe("main");
    });

    test("should default to null when sourceRefName is missing", () => {
      const pr = createMockPR({
        sourceRefName: undefined,
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.headBranch).toBeNull();
    });
  });

  describe("Timestamp Logic", () => {
    test("should use creationDate for createdAt when present", () => {
      const pr = createMockPR({
        creationDate: new Date("2025-01-10T08:30:00Z"),
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.createdAt).toEqual(new Date("2025-01-10T08:30:00Z"));
    });

    test("should use closedDate for updatedAt when closedDate is present", () => {
      const pr = createMockPR({
        creationDate: new Date("2025-01-10T08:30:00Z"),
        closedDate: new Date("2025-01-12T14:00:00Z"),
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.updatedAt).toEqual(new Date("2025-01-12T14:00:00Z"));
    });

    test("should fallback to creationDate for updatedAt when closedDate is missing", () => {
      const pr = createMockPR({
        creationDate: new Date("2025-01-10T08:30:00Z"),
        closedDate: undefined,
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.updatedAt).toEqual(new Date("2025-01-10T08:30:00Z"));
    });

    test("should set mergedAt when status=3 and closedDate is present", () => {
      const pr = createMockPR({
        status: 3,
        closedDate: new Date("2025-01-12T14:00:00Z"),
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.mergedAt).toEqual(new Date("2025-01-12T14:00:00Z"));
    });

    test("should set mergedAt=null when status=3 but closedDate is missing", () => {
      const pr = createMockPR({
        status: 3,
        closedDate: undefined,
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.mergedAt).toBeNull();
    });

    test("should set mergedAt=null when status is not 3 even if closedDate exists", () => {
      const pr = createMockPR({
        status: 2, // Abandoned
        closedDate: new Date("2025-01-12T14:00:00Z"),
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.mergedAt).toBeNull();
    });
  });

  describe("Labels Handling", () => {
    test("should extract labels from PR when labels array is present", () => {
      const pr = createMockPR({
        labels: [
          { name: "bug" },
          { name: "priority-high" },
          { name: "backend" },
        ],
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.labels).toEqual(["bug", "priority-high", "backend"]);
    });

    test("should default to empty array when labels is missing", () => {
      const pr = createMockPR({
        labels: undefined,
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.labels).toEqual([]);
    });

    test("should handle empty labels array", () => {
      const pr = createMockPR({
        labels: [],
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.labels).toEqual([]);
    });

    test("should handle labels with empty name (edge case)", () => {
      const pr = createMockPR({
        labels: [{ name: "bug" }, { name: "" }, { name: "backend" }],
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.labels).toEqual(["bug", "", "backend"]);
    });
  });

  describe("Boolean Flags and Fixed Values", () => {
    test("should set isDraft=true when PR is draft", () => {
      const pr = createMockPR({
        isDraft: true,
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.isDraft).toBe(true);
    });

    test("should set isDraft=false when PR is not draft", () => {
      const pr = createMockPR({
        isDraft: false,
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.isDraft).toBe(false);
    });

    test("should default isDraft to false when missing", () => {
      const pr = createMockPR({
        isDraft: undefined,
      });

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.isDraft).toBe(false);
    });

    test("should set size metrics to 0 (not available in basic API)", () => {
      const pr = createMockPR();

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.additions).toBe(0);
      expect(result.deletions).toBe(0);
      expect(result.changedFiles).toBe(0);
    });

    test("should set review timestamps to null (deferred to enrichment)", () => {
      const pr = createMockPR();

      const result = transformPullRequest(pr, testProjectName, testOrgName);

      expect(result.firstReviewAt).toBeNull();
      expect(result.approvedAt).toBeNull();
    });
  });
});
