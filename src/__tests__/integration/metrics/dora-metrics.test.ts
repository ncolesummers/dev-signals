import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { deployments, pullRequests } from "@/lib/db/schema";
import { testDb as db, initializeTestSchema } from "@/lib/db/test-client";
import {
  calculateChangeFailureRate,
  calculateChangeFailureRateByProject,
  calculateDeploymentFrequency,
  calculateDeploymentFrequencyByProject,
  calculateLeadTimeForChanges,
  calculateLeadTimeForChangesByProject,
  calculateMTTR,
  calculateMTTRByProject,
} from "@/lib/metrics/dora-metrics";

// ============================================================================
// ⚠️  INTEGRATION TEST - PGLITE DATABASE ⚠️
// ============================================================================
// This is an INTEGRATION TEST that verifies database queries work correctly
// against a real Postgres database (PGlite - Postgres compiled to WebAssembly).
//
// PGlite runs in-process with zero setup - no Docker, no cloud database, just pure
// Postgres in WASM. Perfect for testing SQL queries, aggregations, and JSONB
// operations without infrastructure overhead.
//
// SAFETY: PGlite uses in-memory database that's isolated per test run. Even
// though this file uses unconditional DELETE statements, they can't affect
// production data because PGlite never connects to external databases.
//
// CLEANUP: This test file uses UNCONDITIONAL DELETE statements in beforeEach/afterEach:
//   - await db.delete(deployments);   // Deletes ALL deployments in PGlite
//   - await db.delete(pullRequests);  // Deletes ALL pull requests in PGlite
//
// RUN INTEGRATION TESTS: bun run test:integration
//
// FUTURE ENHANCEMENT: Migrate to transaction-based tests that rollback after
// each test, or add WHERE clauses with test_ prefix markers (Issue #40-43).
//
// See GitHub Issue #39 for context on why we added PGlite.
// ============================================================================

describe("DORA Metrics", () => {
  const startDate = new Date("2025-01-06T00:00:00Z"); // Monday W02
  const endDate = new Date("2025-01-12T23:59:59Z"); // Sunday W02

  // Initialize PGlite database schema before all tests
  beforeAll(async () => {
    await initializeTestSchema();
  });

  beforeEach(async () => {
    await db.delete(deployments);
    await db.delete(pullRequests);
  });

  afterEach(async () => {
    await db.delete(deployments);
    await db.delete(pullRequests);
  });

  describe("calculateDeploymentFrequency", () => {
    test("should return zero count when no deployments exist", async () => {
      const result = await calculateDeploymentFrequency(startDate, endDate);

      expect(result.count).toBe(0);
    });

    test("should count successful production deployments", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 5 successful production deployments
      for (let i = 0; i < 5; i++) {
        const startedAt = new Date(baseDate);
        startedAt.setHours(startedAt.getHours() + i);
        const completedAt = new Date(startedAt);
        completedAt.setHours(completedAt.getHours() + 1);

        await db.insert(deployments).values({
          deploymentId: `deploy-${i + 1}`,
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "test-project",
          commitSha: `sha-${i + 1}`,
          startedAt,
          completedAt,
          relatedPRs: [],
        });
      }

      const result = await calculateDeploymentFrequency(startDate, endDate);

      expect(result.count).toBe(5);
    });

    test("should only count production deployments, not staging", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 3 production deployments
      for (let i = 0; i < 3; i++) {
        await db.insert(deployments).values({
          deploymentId: `prod-deploy-${i + 1}`,
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "test-project",
          commitSha: `sha-${i + 1}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          relatedPRs: [],
        });
      }

      // Insert 2 staging deployments (should be excluded)
      for (let i = 0; i < 2; i++) {
        await db.insert(deployments).values({
          deploymentId: `staging-deploy-${i + 1}`,
          environment: "staging",
          status: "success",
          orgName: "test-org",
          projectName: "test-project",
          commitSha: `sha-${i + 10}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          relatedPRs: [],
        });
      }

      const result = await calculateDeploymentFrequency(startDate, endDate);

      expect(result.count).toBe(3);
    });

    test("should only count successful deployments, not failures", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 4 successful deployments
      for (let i = 0; i < 4; i++) {
        await db.insert(deployments).values({
          deploymentId: `success-deploy-${i + 1}`,
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "test-project",
          commitSha: `sha-${i + 1}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          relatedPRs: [],
        });
      }

      // Insert 3 failed deployments (should be excluded)
      for (let i = 0; i < 3; i++) {
        await db.insert(deployments).values({
          deploymentId: `failed-deploy-${i + 1}`,
          environment: "production",
          status: "failure",
          orgName: "test-org",
          projectName: "test-project",
          commitSha: `sha-${i + 10}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          isFailed: true,
          relatedPRs: [],
        });
      }

      const result = await calculateDeploymentFrequency(startDate, endDate);

      expect(result.count).toBe(4);
    });

    test("should filter by time window correctly", async () => {
      // Deployment before window
      await db.insert(deployments).values({
        deploymentId: "deploy-before",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-before",
        startedAt: new Date("2025-01-05T23:59:59Z"), // Before startDate
        completedAt: new Date("2025-01-06T01:00:00Z"),
        relatedPRs: [],
      });

      // Deployment within window
      await db.insert(deployments).values({
        deploymentId: "deploy-within",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-within",
        startedAt: new Date("2025-01-08T10:00:00Z"),
        completedAt: new Date("2025-01-08T11:00:00Z"),
        relatedPRs: [],
      });

      // Deployment after window
      await db.insert(deployments).values({
        deploymentId: "deploy-after",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-after",
        startedAt: new Date("2025-01-13T00:00:00Z"), // After endDate
        completedAt: new Date("2025-01-13T01:00:00Z"),
        relatedPRs: [],
      });

      const result = await calculateDeploymentFrequency(startDate, endDate);

      expect(result.count).toBe(1);
    });

    test("should filter by project name when specified", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 3 deployments for project-a
      for (let i = 0; i < 3; i++) {
        await db.insert(deployments).values({
          deploymentId: `project-a-deploy-${i + 1}`,
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "project-a",
          commitSha: `sha-${i + 1}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          relatedPRs: [],
        });
      }

      // Insert 2 deployments for project-b
      for (let i = 0; i < 2; i++) {
        await db.insert(deployments).values({
          deploymentId: `project-b-deploy-${i + 1}`,
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "project-b",
          commitSha: `sha-${i + 10}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          relatedPRs: [],
        });
      }

      const resultA = await calculateDeploymentFrequency(
        startDate,
        endDate,
        "project-a",
      );
      const resultB = await calculateDeploymentFrequency(
        startDate,
        endDate,
        "project-b",
      );

      expect(resultA.count).toBe(3);
      expect(resultB.count).toBe(2);
    });
  });

  describe("calculateDeploymentFrequencyByProject", () => {
    test("should return empty map when no deployments exist", async () => {
      const result = await calculateDeploymentFrequencyByProject(
        startDate,
        endDate,
      );

      expect(result.size).toBe(0);
    });

    test("should aggregate by project correctly", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Project A: 5 deployments
      for (let i = 0; i < 5; i++) {
        await db.insert(deployments).values({
          deploymentId: `project-a-deploy-${i + 1}`,
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "project-a",
          commitSha: `sha-${i + 1}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          relatedPRs: [],
        });
      }

      // Project B: 3 deployments
      for (let i = 0; i < 3; i++) {
        await db.insert(deployments).values({
          deploymentId: `project-b-deploy-${i + 1}`,
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "project-b",
          commitSha: `sha-${i + 10}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          relatedPRs: [],
        });
      }

      const result = await calculateDeploymentFrequencyByProject(
        startDate,
        endDate,
      );

      expect(result.size).toBe(2);

      const projectA = result.get("project-a");
      expect(projectA).toBeDefined();
      expect(projectA?.count).toBe(5);

      const projectB = result.get("project-b");
      expect(projectB).toBeDefined();
      expect(projectB?.count).toBe(3);
    });
  });

  describe("calculateChangeFailureRate", () => {
    test("should return 0% when no deployments exist", async () => {
      const result = await calculateChangeFailureRate(startDate, endDate);

      expect(result.percentage).toBe(0);
      expect(result.failed_count).toBe(0);
      expect(result.total_count).toBe(0);
    });

    test("should return 0% when all deployments are successful", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 5 successful deployments
      for (let i = 0; i < 5; i++) {
        await db.insert(deployments).values({
          deploymentId: `deploy-${i + 1}`,
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "test-project",
          commitSha: `sha-${i + 1}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          isFailed: false,
          isRollback: false,
          relatedPRs: [],
        });
      }

      const result = await calculateChangeFailureRate(startDate, endDate);

      expect(result.percentage).toBe(0);
      expect(result.failed_count).toBe(0);
      expect(result.total_count).toBe(5);
    });

    test("should calculate CFR with failed deployments", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 7 successful deployments
      for (let i = 0; i < 7; i++) {
        await db.insert(deployments).values({
          deploymentId: `success-deploy-${i + 1}`,
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "test-project",
          commitSha: `sha-${i + 1}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          isFailed: false,
          relatedPRs: [],
        });
      }

      // Insert 3 failed deployments
      for (let i = 0; i < 3; i++) {
        await db.insert(deployments).values({
          deploymentId: `failed-deploy-${i + 1}`,
          environment: "production",
          status: "failure",
          orgName: "test-org",
          projectName: "test-project",
          commitSha: `sha-${i + 10}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          isFailed: true,
          relatedPRs: [],
        });
      }

      const result = await calculateChangeFailureRate(startDate, endDate);

      // 3 failures out of 10 total = 30%
      expect(result.percentage).toBeCloseTo(30, 1);
      expect(result.failed_count).toBe(3);
      expect(result.total_count).toBe(10);
    });

    test("should count rollbacks as failures", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 5 successful deployments
      for (let i = 0; i < 5; i++) {
        await db.insert(deployments).values({
          deploymentId: `success-deploy-${i + 1}`,
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "test-project",
          commitSha: `sha-${i + 1}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          isFailed: false,
          isRollback: false,
          relatedPRs: [],
        });
      }

      // Insert 2 failed deployments
      for (let i = 0; i < 2; i++) {
        await db.insert(deployments).values({
          deploymentId: `failed-deploy-${i + 1}`,
          environment: "production",
          status: "failure",
          orgName: "test-org",
          projectName: "test-project",
          commitSha: `sha-${i + 10}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          isFailed: true,
          isRollback: false,
          relatedPRs: [],
        });
      }

      // Insert 3 rollback deployments (should also count as failures)
      for (let i = 0; i < 3; i++) {
        await db.insert(deployments).values({
          deploymentId: `rollback-deploy-${i + 1}`,
          environment: "production",
          status: "rolled_back",
          orgName: "test-org",
          projectName: "test-project",
          commitSha: `sha-${i + 20}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          isFailed: false,
          isRollback: true,
          relatedPRs: [],
        });
      }

      const result = await calculateChangeFailureRate(startDate, endDate);

      // 2 failed + 3 rollback = 5 failures out of 10 total = 50%
      expect(result.percentage).toBeCloseTo(50, 1);
      expect(result.failed_count).toBe(5);
      expect(result.total_count).toBe(10);
    });

    test("should only count production deployments", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 2 production deployments (1 failed)
      await db.insert(deployments).values({
        deploymentId: "prod-success",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-1",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        isFailed: false,
        relatedPRs: [],
      });

      await db.insert(deployments).values({
        deploymentId: "prod-failed",
        environment: "production",
        status: "failure",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-2",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        isFailed: true,
        relatedPRs: [],
      });

      // Insert 3 staging deployments (should be excluded)
      for (let i = 0; i < 3; i++) {
        await db.insert(deployments).values({
          deploymentId: `staging-${i + 1}`,
          environment: "staging",
          status: "failure",
          orgName: "test-org",
          projectName: "test-project",
          commitSha: `sha-${i + 10}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          isFailed: true,
          relatedPRs: [],
        });
      }

      const result = await calculateChangeFailureRate(startDate, endDate);

      // Only 2 production deployments: 1 failed, 1 success = 50%
      expect(result.percentage).toBeCloseTo(50, 1);
      expect(result.failed_count).toBe(1);
      expect(result.total_count).toBe(2);
    });

    test("should filter by time window correctly", async () => {
      // Deployment before window (failed)
      await db.insert(deployments).values({
        deploymentId: "deploy-before",
        environment: "production",
        status: "failure",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-before",
        startedAt: new Date("2025-01-05T23:59:59Z"),
        completedAt: new Date("2025-01-06T01:00:00Z"),
        isFailed: true,
        relatedPRs: [],
      });

      // Deployment within window (1 success, 1 failure)
      await db.insert(deployments).values({
        deploymentId: "deploy-within-1",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-within-1",
        startedAt: new Date("2025-01-08T10:00:00Z"),
        completedAt: new Date("2025-01-08T11:00:00Z"),
        isFailed: false,
        relatedPRs: [],
      });

      await db.insert(deployments).values({
        deploymentId: "deploy-within-2",
        environment: "production",
        status: "failure",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-within-2",
        startedAt: new Date("2025-01-09T10:00:00Z"),
        completedAt: new Date("2025-01-09T11:00:00Z"),
        isFailed: true,
        relatedPRs: [],
      });

      // Deployment after window (failed)
      await db.insert(deployments).values({
        deploymentId: "deploy-after",
        environment: "production",
        status: "failure",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-after",
        startedAt: new Date("2025-01-13T00:00:00Z"),
        completedAt: new Date("2025-01-13T01:00:00Z"),
        isFailed: true,
        relatedPRs: [],
      });

      const result = await calculateChangeFailureRate(startDate, endDate);

      // Only 2 deployments within window: 1 failed, 1 success = 50%
      expect(result.percentage).toBeCloseTo(50, 1);
      expect(result.failed_count).toBe(1);
      expect(result.total_count).toBe(2);
    });

    test("should filter by project name when specified", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Project A: 3 success, 1 failure = 25% CFR
      for (let i = 0; i < 3; i++) {
        await db.insert(deployments).values({
          deploymentId: `project-a-success-${i + 1}`,
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "project-a",
          commitSha: `sha-${i + 1}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          isFailed: false,
          relatedPRs: [],
        });
      }

      await db.insert(deployments).values({
        deploymentId: "project-a-failure",
        environment: "production",
        status: "failure",
        orgName: "test-org",
        projectName: "project-a",
        commitSha: "sha-10",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        isFailed: true,
        relatedPRs: [],
      });

      // Project B: 1 success, 1 failure = 50% CFR
      await db.insert(deployments).values({
        deploymentId: "project-b-success",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "project-b",
        commitSha: "sha-20",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        isFailed: false,
        relatedPRs: [],
      });

      await db.insert(deployments).values({
        deploymentId: "project-b-failure",
        environment: "production",
        status: "failure",
        orgName: "test-org",
        projectName: "project-b",
        commitSha: "sha-21",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        isFailed: true,
        relatedPRs: [],
      });

      const resultA = await calculateChangeFailureRate(
        startDate,
        endDate,
        "project-a",
      );
      const resultB = await calculateChangeFailureRate(
        startDate,
        endDate,
        "project-b",
      );

      expect(resultA.percentage).toBeCloseTo(25, 1);
      expect(resultA.failed_count).toBe(1);
      expect(resultA.total_count).toBe(4);

      expect(resultB.percentage).toBeCloseTo(50, 1);
      expect(resultB.failed_count).toBe(1);
      expect(resultB.total_count).toBe(2);
    });
  });

  describe("calculateChangeFailureRateByProject", () => {
    test("should return empty map when no deployments exist", async () => {
      const result = await calculateChangeFailureRateByProject(
        startDate,
        endDate,
      );

      expect(result.size).toBe(0);
    });

    test("should aggregate by project correctly", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Project A: 4 success, 1 failure = 20% CFR
      for (let i = 0; i < 4; i++) {
        await db.insert(deployments).values({
          deploymentId: `project-a-success-${i + 1}`,
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "project-a",
          commitSha: `sha-${i + 1}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          isFailed: false,
          relatedPRs: [],
        });
      }

      await db.insert(deployments).values({
        deploymentId: "project-a-failure",
        environment: "production",
        status: "failure",
        orgName: "test-org",
        projectName: "project-a",
        commitSha: "sha-10",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        isFailed: true,
        relatedPRs: [],
      });

      // Project B: 2 success, 2 failure = 50% CFR
      for (let i = 0; i < 2; i++) {
        await db.insert(deployments).values({
          deploymentId: `project-b-success-${i + 1}`,
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "project-b",
          commitSha: `sha-${i + 20}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          isFailed: false,
          relatedPRs: [],
        });
      }

      for (let i = 0; i < 2; i++) {
        await db.insert(deployments).values({
          deploymentId: `project-b-failure-${i + 1}`,
          environment: "production",
          status: "failure",
          orgName: "test-org",
          projectName: "project-b",
          commitSha: `sha-${i + 30}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          isFailed: true,
          relatedPRs: [],
        });
      }

      const result = await calculateChangeFailureRateByProject(
        startDate,
        endDate,
      );

      expect(result.size).toBe(2);

      const projectA = result.get("project-a");
      expect(projectA).toBeDefined();
      expect(projectA?.percentage).toBeCloseTo(20, 1);
      expect(projectA?.failed_count).toBe(1);
      expect(projectA?.total_count).toBe(5);

      const projectB = result.get("project-b");
      expect(projectB).toBeDefined();
      expect(projectB?.percentage).toBeCloseTo(50, 1);
      expect(projectB?.failed_count).toBe(2);
      expect(projectB?.total_count).toBe(4);
    });
  });

  describe("calculateLeadTimeForChanges", () => {
    test("should return null percentiles when no deployments with relatedPRs exist", async () => {
      const result = await calculateLeadTimeForChanges(startDate, endDate);

      expect(result.p50_hours).toBe(null);
      expect(result.p90_hours).toBe(null);
      expect(result.count).toBe(0);
    });

    test("should return null percentiles when relatedPRs array is empty", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert deployment with empty relatedPRs
      await db.insert(deployments).values({
        deploymentId: "deploy-1",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-1",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        relatedPRs: [], // Empty array
      });

      const result = await calculateLeadTimeForChanges(startDate, endDate);

      expect(result.p50_hours).toBe(null);
      expect(result.p90_hours).toBe(null);
      expect(result.count).toBe(0);
    });

    test("should calculate lead time from PR creation to deployment", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Create PRs with varying creation times
      const prCreationTimes = [
        { hours: 48 }, // 2 days before deployment
        { hours: 72 }, // 3 days before deployment
        { hours: 24 }, // 1 day before deployment
        { hours: 96 }, // 4 days before deployment
        { hours: 120 }, // 5 days before deployment
      ];

      for (let i = 0; i < prCreationTimes.length; i++) {
        const prCreatedAt = new Date(baseDate);
        prCreatedAt.setHours(prCreatedAt.getHours() - prCreationTimes[i].hours);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt: prCreatedAt,
          updatedAt: prCreatedAt,
          mergedAt: new Date(baseDate.getTime() - 3600000), // Merged 1h before deployment
          isDraft: false,
        });
      }

      // Create deployment with relatedPRs
      await db.insert(deployments).values({
        deploymentId: "deploy-1",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-1",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        relatedPRs: [1, 2, 3, 4, 5],
      });

      const result = await calculateLeadTimeForChanges(startDate, endDate);

      // Sorted lead times: [25, 49, 73, 97, 121] hours (deployment completedAt is +1h from startedAt)
      // p50 should be around 73 hours
      expect(result.p50_hours).toBeCloseTo(73, 0);
      // p90 should be around 120 hours
      expect(result.p90_hours).toBeGreaterThan(96);
      expect(result.count).toBe(5);
    });

    test("should handle multiple deployments with different PRs", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Create 3 PRs
      for (let i = 0; i < 3; i++) {
        const prCreatedAt = new Date(baseDate);
        prCreatedAt.setHours(prCreatedAt.getHours() - 48); // 2 days before

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt: prCreatedAt,
          updatedAt: prCreatedAt,
          mergedAt: new Date(baseDate.getTime() - 3600000),
          isDraft: false,
        });
      }

      // Deployment 1: PRs 1 and 2
      await db.insert(deployments).values({
        deploymentId: "deploy-1",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-1",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        relatedPRs: [1, 2],
      });

      // Deployment 2: PR 3
      await db.insert(deployments).values({
        deploymentId: "deploy-2",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-2",
        startedAt: new Date(baseDate.getTime() + 7200000), // 2h later
        completedAt: new Date(baseDate.getTime() + 10800000), // 3h later
        relatedPRs: [3],
      });

      const result = await calculateLeadTimeForChanges(startDate, endDate);

      expect(result.count).toBe(3);
      expect(result.p50_hours).toBeGreaterThan(0);
    });

    test("should filter by time window correctly (using deployment startedAt)", async () => {
      // PR created before window
      await db.insert(pullRequests).values({
        prNumber: 1,
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        title: "PR 1",
        author: "test-author",
        state: "merged",
        createdAt: new Date("2025-01-01T10:00:00Z"),
        updatedAt: new Date("2025-01-01T10:00:00Z"),
        mergedAt: new Date("2025-01-01T12:00:00Z"),
        isDraft: false,
      });

      // Deployment before window (should be excluded)
      await db.insert(deployments).values({
        deploymentId: "deploy-before",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-before",
        startedAt: new Date("2025-01-05T23:59:59Z"),
        completedAt: new Date("2025-01-06T01:00:00Z"),
        relatedPRs: [1],
      });

      // PR and deployment within window
      await db.insert(pullRequests).values({
        prNumber: 2,
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        title: "PR 2",
        author: "test-author",
        state: "merged",
        createdAt: new Date("2025-01-07T10:00:00Z"),
        updatedAt: new Date("2025-01-07T10:00:00Z"),
        mergedAt: new Date("2025-01-07T12:00:00Z"),
        isDraft: false,
      });

      await db.insert(deployments).values({
        deploymentId: "deploy-within",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-within",
        startedAt: new Date("2025-01-08T10:00:00Z"),
        completedAt: new Date("2025-01-08T11:00:00Z"),
        relatedPRs: [2],
      });

      const result = await calculateLeadTimeForChanges(startDate, endDate);

      expect(result.count).toBe(1);
    });

    test("should filter by project name when specified", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Project A PRs
      for (let i = 0; i < 2; i++) {
        const prCreatedAt = new Date(baseDate);
        prCreatedAt.setHours(prCreatedAt.getHours() - 24); // 1 day before

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "project-a",
          title: `PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt: prCreatedAt,
          updatedAt: prCreatedAt,
          mergedAt: new Date(baseDate.getTime() - 3600000),
          isDraft: false,
        });
      }

      // Project B PRs
      for (let i = 0; i < 3; i++) {
        const prCreatedAt = new Date(baseDate);
        prCreatedAt.setHours(prCreatedAt.getHours() - 48); // 2 days before

        await db.insert(pullRequests).values({
          prNumber: i + 10,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "project-b",
          title: `PR ${i + 10}`,
          author: "test-author",
          state: "merged",
          createdAt: prCreatedAt,
          updatedAt: prCreatedAt,
          mergedAt: new Date(baseDate.getTime() - 3600000),
          isDraft: false,
        });
      }

      // Project A deployment
      await db.insert(deployments).values({
        deploymentId: "deploy-a",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "project-a",
        commitSha: "sha-a",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        relatedPRs: [1, 2],
      });

      // Project B deployment
      await db.insert(deployments).values({
        deploymentId: "deploy-b",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "project-b",
        commitSha: "sha-b",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        relatedPRs: [10, 11, 12],
      });

      const resultA = await calculateLeadTimeForChanges(
        startDate,
        endDate,
        "project-a",
      );
      const resultB = await calculateLeadTimeForChanges(
        startDate,
        endDate,
        "project-b",
      );

      expect(resultA.count).toBe(2);
      expect(resultA.p50_hours).toBeCloseTo(25, 0); // 24h before + 1h to completion = 25h

      expect(resultB.count).toBe(3);
      expect(resultB.p50_hours).toBeCloseTo(49, 0); // 48h before + 1h to completion = 49h
    });
  });

  describe("calculateLeadTimeForChangesByProject", () => {
    test("should return empty map when no deployments with relatedPRs exist", async () => {
      const result = await calculateLeadTimeForChangesByProject(
        startDate,
        endDate,
      );

      expect(result.size).toBe(0);
    });

    test("should aggregate by project correctly", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Project A: 3 PRs with ~24h lead time
      for (let i = 0; i < 3; i++) {
        const prCreatedAt = new Date(baseDate);
        prCreatedAt.setHours(prCreatedAt.getHours() - 24);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "project-a",
          title: `PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt: prCreatedAt,
          updatedAt: prCreatedAt,
          mergedAt: new Date(baseDate.getTime() - 3600000),
          isDraft: false,
        });
      }

      await db.insert(deployments).values({
        deploymentId: "deploy-a",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "project-a",
        commitSha: "sha-a",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        relatedPRs: [1, 2, 3],
      });

      // Project B: 2 PRs with ~48h lead time
      for (let i = 0; i < 2; i++) {
        const prCreatedAt = new Date(baseDate);
        prCreatedAt.setHours(prCreatedAt.getHours() - 48);

        await db.insert(pullRequests).values({
          prNumber: i + 10,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "project-b",
          title: `PR ${i + 10}`,
          author: "test-author",
          state: "merged",
          createdAt: prCreatedAt,
          updatedAt: prCreatedAt,
          mergedAt: new Date(baseDate.getTime() - 3600000),
          isDraft: false,
        });
      }

      await db.insert(deployments).values({
        deploymentId: "deploy-b",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "project-b",
        commitSha: "sha-b",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        relatedPRs: [10, 11],
      });

      const result = await calculateLeadTimeForChangesByProject(
        startDate,
        endDate,
      );

      expect(result.size).toBe(2);

      const projectA = result.get("project-a");
      expect(projectA).toBeDefined();
      expect(projectA?.count).toBe(3);
      expect(projectA?.p50_hours).toBeCloseTo(25, 0); // 24h before + 1h to completion = 25h

      const projectB = result.get("project-b");
      expect(projectB).toBeDefined();
      expect(projectB?.count).toBe(2);
      expect(projectB?.p50_hours).toBeCloseTo(49, 0); // 48h before + 1h to completion = 49h
    });
  });

  describe("calculateMTTR", () => {
    test("should return null percentiles when no failed deployments with recovery exist", async () => {
      const result = await calculateMTTR(startDate, endDate);

      expect(result.p50_hours).toBe(null);
      expect(result.p90_hours).toBe(null);
      expect(result.count).toBe(0);
    });

    test("should exclude failed deployments without recoveredAt", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 2 failed deployments without recoveredAt
      for (let i = 0; i < 2; i++) {
        await db.insert(deployments).values({
          deploymentId: `failed-no-recovery-${i + 1}`,
          environment: "production",
          status: "failure",
          orgName: "test-org",
          projectName: "test-project",
          commitSha: `sha-${i + 1}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          isFailed: true,
          recoveredAt: null, // No recovery timestamp
          relatedPRs: [],
        });
      }

      const result = await calculateMTTR(startDate, endDate);

      expect(result.count).toBe(0);
      expect(result.p50_hours).toBe(null);
    });

    test("should calculate MTTR from deployment completion to recovery", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Recovery times in hours: [1, 2, 3, 4, 5]
      const recoveryHours = [1, 2, 3, 4, 5];

      for (let i = 0; i < recoveryHours.length; i++) {
        const completedAt = new Date(baseDate.getTime() + i * 3600000); // Stagger completion times
        const recoveredAt = new Date(completedAt);
        recoveredAt.setHours(recoveredAt.getHours() + recoveryHours[i]);

        await db.insert(deployments).values({
          deploymentId: `failed-${i + 1}`,
          environment: "production",
          status: "failure",
          orgName: "test-org",
          projectName: "test-project",
          commitSha: `sha-${i + 1}`,
          startedAt: new Date(baseDate.getTime() + i * 3600000),
          completedAt,
          isFailed: true,
          recoveredAt,
          relatedPRs: [],
        });
      }

      const result = await calculateMTTR(startDate, endDate);

      // Recovery times: [1, 2, 3, 4, 5] hours
      // p50 should be 3 hours
      expect(result.p50_hours).toBeCloseTo(3, 1);
      // p90 should be around 5 hours
      expect(result.p90_hours).toBeGreaterThan(4);
      expect(result.count).toBe(5);
    });

    test("should only count production deployments", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");
      const completedAt = new Date(baseDate.getTime() + 3600000);
      const recoveredAt = new Date(completedAt.getTime() + 3600000); // 1h recovery

      // Production deployment with recovery
      await db.insert(deployments).values({
        deploymentId: "prod-failed",
        environment: "production",
        status: "failure",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-1",
        startedAt: baseDate,
        completedAt,
        isFailed: true,
        recoveredAt,
        relatedPRs: [],
      });

      // Staging deployment with recovery (should be excluded)
      await db.insert(deployments).values({
        deploymentId: "staging-failed",
        environment: "staging",
        status: "failure",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-2",
        startedAt: baseDate,
        completedAt,
        isFailed: true,
        recoveredAt,
        relatedPRs: [],
      });

      const result = await calculateMTTR(startDate, endDate);

      expect(result.count).toBe(1);
    });

    test("should filter by time window correctly", async () => {
      const completedAt = new Date("2025-01-08T10:00:00Z");
      const recoveredAt = new Date(completedAt.getTime() + 3600000);

      // Failed deployment before window
      await db.insert(deployments).values({
        deploymentId: "deploy-before",
        environment: "production",
        status: "failure",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-before",
        startedAt: new Date("2025-01-05T23:59:59Z"),
        completedAt: new Date("2025-01-06T00:59:59Z"),
        isFailed: true,
        recoveredAt: new Date("2025-01-06T02:00:00Z"),
        relatedPRs: [],
      });

      // Failed deployment within window
      await db.insert(deployments).values({
        deploymentId: "deploy-within",
        environment: "production",
        status: "failure",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-within",
        startedAt: new Date("2025-01-08T10:00:00Z"),
        completedAt,
        isFailed: true,
        recoveredAt,
        relatedPRs: [],
      });

      // Failed deployment after window
      await db.insert(deployments).values({
        deploymentId: "deploy-after",
        environment: "production",
        status: "failure",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-after",
        startedAt: new Date("2025-01-13T00:00:00Z"),
        completedAt: new Date("2025-01-13T01:00:00Z"),
        isFailed: true,
        recoveredAt: new Date("2025-01-13T02:00:00Z"),
        relatedPRs: [],
      });

      const result = await calculateMTTR(startDate, endDate);

      expect(result.count).toBe(1);
    });

    test("should filter by project name when specified", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");
      const completedAt = new Date(baseDate.getTime() + 3600000);

      // Project A: 1h MTTR
      await db.insert(deployments).values({
        deploymentId: "project-a-failed",
        environment: "production",
        status: "failure",
        orgName: "test-org",
        projectName: "project-a",
        commitSha: "sha-a",
        startedAt: baseDate,
        completedAt,
        isFailed: true,
        recoveredAt: new Date(completedAt.getTime() + 3600000), // +1h
        relatedPRs: [],
      });

      // Project B: 2h MTTR
      await db.insert(deployments).values({
        deploymentId: "project-b-failed",
        environment: "production",
        status: "failure",
        orgName: "test-org",
        projectName: "project-b",
        commitSha: "sha-b",
        startedAt: baseDate,
        completedAt,
        isFailed: true,
        recoveredAt: new Date(completedAt.getTime() + 7200000), // +2h
        relatedPRs: [],
      });

      const resultA = await calculateMTTR(startDate, endDate, "project-a");
      const resultB = await calculateMTTR(startDate, endDate, "project-b");

      expect(resultA.count).toBe(1);
      expect(resultA.p50_hours).toBeCloseTo(1, 1);

      expect(resultB.count).toBe(1);
      expect(resultB.p50_hours).toBeCloseTo(2, 1);
    });
  });

  describe("calculateMTTRByProject", () => {
    test("should return empty map when no failed deployments with recovery exist", async () => {
      const result = await calculateMTTRByProject(startDate, endDate);

      expect(result.size).toBe(0);
    });

    test("should aggregate by project correctly", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");
      const completedAt = new Date(baseDate.getTime() + 3600000);

      // Project A: 3 failures with 1h, 2h, 3h recovery (p50=2h)
      for (let i = 0; i < 3; i++) {
        await db.insert(deployments).values({
          deploymentId: `project-a-failed-${i + 1}`,
          environment: "production",
          status: "failure",
          orgName: "test-org",
          projectName: "project-a",
          commitSha: `sha-a-${i + 1}`,
          startedAt: baseDate,
          completedAt,
          isFailed: true,
          recoveredAt: new Date(completedAt.getTime() + (i + 1) * 3600000), // 1h, 2h, 3h
          relatedPRs: [],
        });
      }

      // Project B: 2 failures with 4h, 5h recovery (p50=4.5h)
      for (let i = 0; i < 2; i++) {
        await db.insert(deployments).values({
          deploymentId: `project-b-failed-${i + 1}`,
          environment: "production",
          status: "failure",
          orgName: "test-org",
          projectName: "project-b",
          commitSha: `sha-b-${i + 1}`,
          startedAt: baseDate,
          completedAt,
          isFailed: true,
          recoveredAt: new Date(completedAt.getTime() + (i + 4) * 3600000), // 4h, 5h
          relatedPRs: [],
        });
      }

      const result = await calculateMTTRByProject(startDate, endDate);

      expect(result.size).toBe(2);

      const projectA = result.get("project-a");
      expect(projectA).toBeDefined();
      expect(projectA?.count).toBe(3);
      expect(projectA?.p50_hours).toBeCloseTo(2, 1);

      const projectB = result.get("project-b");
      expect(projectB).toBeDefined();
      expect(projectB?.count).toBe(2);
      expect(projectB?.p50_hours).toBeCloseTo(4.5, 1);
    });
  });
});
