import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { ciRuns } from "@/lib/db/schema";
import { testDb as db, initializeTestSchema } from "@/lib/db/test-client";
import {
  calculateFlakyTestRate,
  calculateFlakyTestRateByProject,
  getCISuccessRate,
  getFlakyRunCount,
} from "@/lib/metrics/flaky-tests";

// ============================================================================
// ⚠️  INTEGRATION TEST - PGLITE DATABASE ⚠️
// ============================================================================
// This is an INTEGRATION TEST using PGlite (Postgres in WebAssembly).
// PGlite runs in-process with zero setup - no Docker, no cloud database needed.
//
// SAFETY: PGlite uses in-memory database isolated per test run. Cannot affect
// production data because it never connects to external databases.
//
// See GitHub Issue #39 for context on why we added PGlite.
// ============================================================================

/**
 * Test Suite for Flaky Test Metrics Calculation
 *
 * Tests cover:
 * - Flaky test rate calculation (percentage)
 * - Per-project aggregation
 * - Time window filtering
 * - Edge cases (no data, all flaky, zero flaky)
 */

describe("Flaky Test Rate Calculation", () => {
  // Initialize PGlite database schema before all tests
  beforeAll(async () => {
    await initializeTestSchema();
  });

  // Clean up test data before each test
  beforeEach(async () => {
    await db.delete(ciRuns);
  });

  afterEach(async () => {
    await db.delete(ciRuns);
  });

  test("should calculate 0% when no runs exist", async () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-31T23:59:59Z");

    const rate = await calculateFlakyTestRate(startDate, endDate);

    expect(rate).toBe(0);
  });

  test("should calculate 0% when no flaky runs exist", async () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-31T23:59:59Z");

    // Insert 10 successful runs
    for (let i = 0; i < 10; i++) {
      await db.insert(ciRuns).values({
        runId: `run-${i}`,
        workflowName: "test-pipeline",
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        status: "completed",
        conclusion: "success",
        startedAt: new Date("2025-01-15T10:00:00Z"),
        isFlaky: false,
        flakyTestCount: 0,
      });
    }

    const rate = await calculateFlakyTestRate(startDate, endDate);

    expect(rate).toBe(0);
  });

  test("should calculate 100% when all runs are flaky", async () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-31T23:59:59Z");

    // Insert 10 flaky runs
    for (let i = 0; i < 10; i++) {
      await db.insert(ciRuns).values({
        runId: `run-${i}`,
        workflowName: "test-pipeline",
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        status: "completed",
        conclusion: "failure",
        startedAt: new Date("2025-01-15T10:00:00Z"),
        isFlaky: true,
        flakyTestCount: 1,
      });
    }

    const rate = await calculateFlakyTestRate(startDate, endDate);

    expect(rate).toBe(100);
  });

  test("should calculate 50% when half of runs are flaky", async () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-31T23:59:59Z");

    // Insert 5 flaky runs
    for (let i = 0; i < 5; i++) {
      await db.insert(ciRuns).values({
        runId: `flaky-${i}`,
        workflowName: "test-pipeline",
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        status: "completed",
        conclusion: "failure",
        startedAt: new Date("2025-01-15T10:00:00Z"),
        isFlaky: true,
        flakyTestCount: 1,
      });
    }

    // Insert 5 normal runs
    for (let i = 0; i < 5; i++) {
      await db.insert(ciRuns).values({
        runId: `normal-${i}`,
        workflowName: "test-pipeline",
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        status: "completed",
        conclusion: "success",
        startedAt: new Date("2025-01-15T10:00:00Z"),
        isFlaky: false,
        flakyTestCount: 0,
      });
    }

    const rate = await calculateFlakyTestRate(startDate, endDate);

    expect(rate).toBe(50);
  });

  test("should calculate 25% when 1 out of 4 runs is flaky", async () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-31T23:59:59Z");

    // Insert 1 flaky run
    await db.insert(ciRuns).values({
      runId: "flaky-1",
      workflowName: "test-pipeline",
      repoName: "test-repo",
      orgName: "test-org",
      projectName: "test-project",
      status: "completed",
      conclusion: "failure",
      startedAt: new Date("2025-01-15T10:00:00Z"),
      isFlaky: true,
      flakyTestCount: 1,
    });

    // Insert 3 normal runs
    for (let i = 0; i < 3; i++) {
      await db.insert(ciRuns).values({
        runId: `normal-${i}`,
        workflowName: "test-pipeline",
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        status: "completed",
        conclusion: "success",
        startedAt: new Date("2025-01-15T10:00:00Z"),
        isFlaky: false,
        flakyTestCount: 0,
      });
    }

    const rate = await calculateFlakyTestRate(startDate, endDate);

    expect(rate).toBe(25);
  });
});

describe("Time Window Filtering", () => {
  beforeEach(async () => {
    await db.delete(ciRuns);
  });

  afterEach(async () => {
    await db.delete(ciRuns);
  });

  test("should only count runs within time window", async () => {
    // Insert run inside window
    await db.insert(ciRuns).values({
      runId: "inside-1",
      workflowName: "test-pipeline",
      repoName: "test-repo",
      orgName: "test-org",
      projectName: "test-project",
      status: "completed",
      conclusion: "failure",
      startedAt: new Date("2025-01-15T10:00:00Z"),
      isFlaky: true,
      flakyTestCount: 1,
    });

    // Insert run outside window (before)
    await db.insert(ciRuns).values({
      runId: "outside-before",
      workflowName: "test-pipeline",
      repoName: "test-repo",
      orgName: "test-org",
      projectName: "test-project",
      status: "completed",
      conclusion: "failure",
      startedAt: new Date("2024-12-15T10:00:00Z"),
      isFlaky: true,
      flakyTestCount: 1,
    });

    // Insert run outside window (after)
    await db.insert(ciRuns).values({
      runId: "outside-after",
      workflowName: "test-pipeline",
      repoName: "test-repo",
      orgName: "test-org",
      projectName: "test-project",
      status: "completed",
      conclusion: "failure",
      startedAt: new Date("2025-02-15T10:00:00Z"),
      isFlaky: true,
      flakyTestCount: 1,
    });

    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-31T23:59:59Z");

    const count = await getFlakyRunCount(startDate, endDate);

    expect(count).toBe(1); // Only the inside-1 run
  });
});

describe("Per-Project Aggregation", () => {
  beforeEach(async () => {
    await db.delete(ciRuns);
  });

  afterEach(async () => {
    await db.delete(ciRuns);
  });

  test("should calculate rate for specific project only", async () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-31T23:59:59Z");

    // Project A: 2 flaky out of 4 runs (50%)
    for (let i = 0; i < 2; i++) {
      await db.insert(ciRuns).values({
        runId: `a-flaky-${i}`,
        workflowName: "test-pipeline",
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "project-a",
        status: "completed",
        conclusion: "failure",
        startedAt: new Date("2025-01-15T10:00:00Z"),
        isFlaky: true,
        flakyTestCount: 1,
      });
    }
    for (let i = 0; i < 2; i++) {
      await db.insert(ciRuns).values({
        runId: `a-normal-${i}`,
        workflowName: "test-pipeline",
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "project-a",
        status: "completed",
        conclusion: "success",
        startedAt: new Date("2025-01-15T10:00:00Z"),
        isFlaky: false,
        flakyTestCount: 0,
      });
    }

    // Project B: 1 flaky out of 2 runs (50%)
    await db.insert(ciRuns).values({
      runId: "b-flaky-1",
      workflowName: "test-pipeline",
      repoName: "test-repo",
      orgName: "test-org",
      projectName: "project-b",
      status: "completed",
      conclusion: "failure",
      startedAt: new Date("2025-01-15T10:00:00Z"),
      isFlaky: true,
      flakyTestCount: 1,
    });
    await db.insert(ciRuns).values({
      runId: "b-normal-1",
      workflowName: "test-pipeline",
      repoName: "test-repo",
      orgName: "test-org",
      projectName: "project-b",
      status: "completed",
      conclusion: "success",
      startedAt: new Date("2025-01-15T10:00:00Z"),
      isFlaky: false,
      flakyTestCount: 0,
    });

    const rateA = await calculateFlakyTestRate(startDate, endDate, "project-a");
    const rateB = await calculateFlakyTestRate(startDate, endDate, "project-b");

    expect(rateA).toBe(50);
    expect(rateB).toBe(50);
  });

  test("should calculate rates for all projects", async () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-31T23:59:59Z");

    // Project A: 0% flaky (all success)
    await db.insert(ciRuns).values({
      runId: "a-1",
      workflowName: "test-pipeline",
      repoName: "test-repo",
      orgName: "test-org",
      projectName: "project-a",
      status: "completed",
      conclusion: "success",
      startedAt: new Date("2025-01-15T10:00:00Z"),
      isFlaky: false,
      flakyTestCount: 0,
    });

    // Project B: 100% flaky
    await db.insert(ciRuns).values({
      runId: "b-1",
      workflowName: "test-pipeline",
      repoName: "test-repo",
      orgName: "test-org",
      projectName: "project-b",
      status: "completed",
      conclusion: "failure",
      startedAt: new Date("2025-01-15T10:00:00Z"),
      isFlaky: true,
      flakyTestCount: 1,
    });

    const ratesByProject = await calculateFlakyTestRateByProject(
      startDate,
      endDate,
    );

    expect(ratesByProject.get("project-a")).toBe(0);
    expect(ratesByProject.get("project-b")).toBe(100);
  });
});

describe("CI Success Rate Calculation", () => {
  beforeEach(async () => {
    await db.delete(ciRuns);
  });

  afterEach(async () => {
    await db.delete(ciRuns);
  });

  test("should calculate 100% success when all runs succeed", async () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-31T23:59:59Z");

    for (let i = 0; i < 5; i++) {
      await db.insert(ciRuns).values({
        runId: `run-${i}`,
        workflowName: "test-pipeline",
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        status: "completed",
        conclusion: "success",
        startedAt: new Date("2025-01-15T10:00:00Z"),
      });
    }

    const successRate = await getCISuccessRate(startDate, endDate);

    expect(successRate).toBe(100);
  });

  test("should calculate 0% success when all runs fail", async () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-31T23:59:59Z");

    for (let i = 0; i < 5; i++) {
      await db.insert(ciRuns).values({
        runId: `run-${i}`,
        workflowName: "test-pipeline",
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        status: "completed",
        conclusion: "failure",
        startedAt: new Date("2025-01-15T10:00:00Z"),
      });
    }

    const successRate = await getCISuccessRate(startDate, endDate);

    expect(successRate).toBe(0);
  });

  test("should calculate 60% success rate", async () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-31T23:59:59Z");

    // 3 successes
    for (let i = 0; i < 3; i++) {
      await db.insert(ciRuns).values({
        runId: `success-${i}`,
        workflowName: "test-pipeline",
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        status: "completed",
        conclusion: "success",
        startedAt: new Date("2025-01-15T10:00:00Z"),
      });
    }

    // 2 failures
    for (let i = 0; i < 2; i++) {
      await db.insert(ciRuns).values({
        runId: `failure-${i}`,
        workflowName: "test-pipeline",
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        status: "completed",
        conclusion: "failure",
        startedAt: new Date("2025-01-15T10:00:00Z"),
      });
    }

    const successRate = await getCISuccessRate(startDate, endDate);

    expect(successRate).toBe(60);
  });
});

describe("Edge Cases", () => {
  beforeEach(async () => {
    await db.delete(ciRuns);
  });

  afterEach(async () => {
    await db.delete(ciRuns);
  });

  test("should handle decimal percentages correctly", async () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-31T23:59:59Z");

    // 1 flaky out of 3 runs = 33.33%
    await db.insert(ciRuns).values({
      runId: "flaky-1",
      workflowName: "test-pipeline",
      repoName: "test-repo",
      orgName: "test-org",
      projectName: "test-project",
      status: "completed",
      conclusion: "failure",
      startedAt: new Date("2025-01-15T10:00:00Z"),
      isFlaky: true,
      flakyTestCount: 1,
    });

    for (let i = 0; i < 2; i++) {
      await db.insert(ciRuns).values({
        runId: `normal-${i}`,
        workflowName: "test-pipeline",
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        status: "completed",
        conclusion: "success",
        startedAt: new Date("2025-01-15T10:00:00Z"),
        isFlaky: false,
        flakyTestCount: 0,
      });
    }

    const rate = await calculateFlakyTestRate(startDate, endDate);

    // Should be rounded to 2 decimal places
    expect(rate).toBeCloseTo(33.33, 2);
  });

  test("should return 0 for empty project", async () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-31T23:59:59Z");

    const rate = await calculateFlakyTestRate(
      startDate,
      endDate,
      "non-existent-project",
    );

    expect(rate).toBe(0);
  });

  test("should handle larger datasets correctly", async () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-01-31T23:59:59Z");

    // Insert 100 runs (50 flaky, 50 normal) - reduced for test performance
    const flakyRuns = Array.from({ length: 50 }, (_, i) => ({
      runId: `flaky-${i}`,
      workflowName: "test-pipeline",
      repoName: "test-repo",
      orgName: "test-org",
      projectName: "test-project",
      status: "completed",
      conclusion: "failure",
      startedAt: new Date("2025-01-15T10:00:00Z"),
      isFlaky: true,
      flakyTestCount: 1,
    }));

    const normalRuns = Array.from({ length: 50 }, (_, i) => ({
      runId: `normal-${i}`,
      workflowName: "test-pipeline",
      repoName: "test-repo",
      orgName: "test-org",
      projectName: "test-project",
      status: "completed",
      conclusion: "success",
      startedAt: new Date("2025-01-15T10:00:00Z"),
      isFlaky: false,
      flakyTestCount: 0,
    }));

    // Batch insert for better performance
    await db.insert(ciRuns).values([...flakyRuns, ...normalRuns]);

    const rate = await calculateFlakyTestRate(startDate, endDate);

    expect(rate).toBe(50);
  });
});
