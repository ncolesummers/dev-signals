import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/metrics/dora/route";
import { deployments, pullRequests } from "@/lib/db/schema";
import { testDb as db, initializeTestSchema } from "@/lib/db/test-client";

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
 * Integration Test Suite for Combined DORA Metrics API
 *
 * Tests the /api/metrics/dora endpoint which aggregates all four DORA metrics:
 * - Deployment Frequency
 * - Lead Time for Changes
 * - Change Failure Rate (CFR)
 * - Mean Time to Recovery (MTTR)
 */

// Helper to create a NextRequest with query parameters
function createRequest(params?: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/metrics/dora");
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  return new NextRequest(url);
}

describe("GET /api/metrics/dora", () => {
  const startDate = new Date("2025-01-06T00:00:00Z"); // Monday W02
  const endDate = new Date("2025-01-12T23:59:59Z"); // Sunday W02
  const testWeek = "2025-W02";

  // Initialize PGlite database schema before all tests
  beforeAll(async () => {
    await initializeTestSchema();
  });

  beforeEach(async () => {
    // Clean up test data
    await db.delete(deployments);
    await db.delete(pullRequests);
  });

  afterEach(async () => {
    // Clean up test data
    await db.delete(deployments);
    await db.delete(pullRequests);
  });

  describe("Basic Functionality", () => {
    test("should return 200 and combined DORA metrics for current week", async () => {
      const request = createRequest();
      const response = await GET(request);

      expect(response.status).toBe(200);

      const data = await response.json();

      // Check response structure
      expect(data).toHaveProperty("deploymentFrequency");
      expect(data).toHaveProperty("leadTime");
      expect(data).toHaveProperty("changeFailureRate");
      expect(data).toHaveProperty("mttr");
      expect(data).toHaveProperty("week");
      expect(data).toHaveProperty("startDate");
      expect(data).toHaveProperty("endDate");

      // Check deploymentFrequency structure
      expect(data.deploymentFrequency).toHaveProperty("count");
      expect(typeof data.deploymentFrequency.count).toBe("number");

      // Check leadTime structure
      expect(data.leadTime).toHaveProperty("p50_hours");
      expect(data.leadTime).toHaveProperty("p90_hours");
      expect(data.leadTime).toHaveProperty("count");

      // Check changeFailureRate structure
      expect(data.changeFailureRate).toHaveProperty("percentage");
      expect(data.changeFailureRate).toHaveProperty("failed_count");
      expect(data.changeFailureRate).toHaveProperty("total_count");

      // Check mttr structure
      expect(data.mttr).toHaveProperty("p50_hours");
      expect(data.mttr).toHaveProperty("p90_hours");
      expect(data.mttr).toHaveProperty("count");
    });

    test("should return metrics for specific week", async () => {
      const request = createRequest({ week: testWeek });
      const response = await GET(request);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.week).toBe(testWeek);
      expect(data.startDate).toBe(startDate.toISOString());
      // endDate uses 23:59:59.999 for inclusivity, so check within 1 second
      const receivedEndDate = new Date(data.endDate).getTime();
      const expectedEndDate = endDate.getTime();
      expect(Math.abs(receivedEndDate - expectedEndDate)).toBeLessThan(1000);
    });

    test("should return zero counts when no data exists", async () => {
      const request = createRequest({ week: testWeek });
      const response = await GET(request);

      expect(response.status).toBe(200);

      const data = await response.json();

      // All metrics should show zero/null
      expect(data.deploymentFrequency.count).toBe(0);
      expect(data.leadTime.count).toBe(0);
      expect(data.leadTime.p50_hours).toBeNull();
      expect(data.leadTime.p90_hours).toBeNull();
      expect(data.changeFailureRate.percentage).toBe(0);
      expect(data.changeFailureRate.total_count).toBe(0);
      expect(data.mttr.count).toBe(0);
      expect(data.mttr.p50_hours).toBeNull();
      expect(data.mttr.p90_hours).toBeNull();
    });
  });

  describe("Data Aggregation", () => {
    test("should aggregate all metrics with test data", async () => {
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
          commitSha: `sha-failed-${i + 1}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          isFailed: true,
          relatedPRs: [],
        });
      }

      const request = createRequest({ week: testWeek });
      const response = await GET(request);
      const data = await response.json();

      // Check deployment frequency
      expect(data.deploymentFrequency.count).toBe(5);

      // Check change failure rate (2 failures out of 7 total)
      expect(data.changeFailureRate.total_count).toBe(7);
      expect(data.changeFailureRate.failed_count).toBe(2);
      expect(data.changeFailureRate.percentage).toBeCloseTo(28.57, 1);
    });

    test("should aggregate metrics for specific project", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert deployments for project-A
      await db.insert(deployments).values({
        deploymentId: "deploy-project-a",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "project-a",
        commitSha: "sha-a",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        relatedPRs: [],
      });

      // Insert deployments for project-B
      await db.insert(deployments).values({
        deploymentId: "deploy-project-b",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "project-b",
        commitSha: "sha-b",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        relatedPRs: [],
      });

      const request = createRequest({ week: testWeek, project: "project-a" });
      const response = await GET(request);
      const data = await response.json();

      expect(data.project).toBe("project-a");
      expect(data.deploymentFrequency.count).toBe(1);
    });
  });

  describe("Per-Project Breakdown", () => {
    test("should return per-project breakdown when allProjects=true", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert deployments for multiple projects
      await db.insert(deployments).values([
        {
          deploymentId: "deploy-project-a-1",
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "project-a",
          commitSha: "sha-a-1",
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          relatedPRs: [],
        },
        {
          deploymentId: "deploy-project-a-2",
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "project-a",
          commitSha: "sha-a-2",
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          relatedPRs: [],
        },
        {
          deploymentId: "deploy-project-b-1",
          environment: "production",
          status: "success",
          orgName: "test-org",
          projectName: "project-b",
          commitSha: "sha-b-1",
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          relatedPRs: [],
        },
      ]);

      const request = createRequest({ week: testWeek, allProjects: "true" });
      const response = await GET(request);
      const data = await response.json();

      expect(data).toHaveProperty("projects");
      expect(data.projects).toHaveProperty("project-a");
      expect(data.projects).toHaveProperty("project-b");

      // Check project-a metrics
      expect(data.projects["project-a"].deploymentFrequency.count).toBe(2);

      // Check project-b metrics
      expect(data.projects["project-b"].deploymentFrequency.count).toBe(1);
    });

    test("should include all 4 metrics for each project", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      await db.insert(deployments).values({
        deploymentId: "deploy-test",
        environment: "production",
        status: "success",
        orgName: "test-org",
        projectName: "test-project",
        commitSha: "sha-test",
        startedAt: baseDate,
        completedAt: new Date(baseDate.getTime() + 3600000),
        relatedPRs: [],
      });

      const request = createRequest({ week: testWeek, allProjects: "true" });
      const response = await GET(request);
      const data = await response.json();

      const projectMetrics = data.projects["test-project"];

      expect(projectMetrics).toHaveProperty("deploymentFrequency");
      expect(projectMetrics).toHaveProperty("leadTime");
      expect(projectMetrics).toHaveProperty("changeFailureRate");
      expect(projectMetrics).toHaveProperty("mttr");
    });
  });

  describe("Query Parameter Validation", () => {
    test("should return 400 for invalid week format", async () => {
      const request = createRequest({ week: "invalid-week" });
      const response = await GET(request);

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty("error");
      expect(data.error).toBe("Invalid week format");
    });

    test("should return 400 for malformed week identifier", async () => {
      const request = createRequest({ week: "2025-W99" });
      const response = await GET(request);

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe("Invalid week format");
    });

    test("should accept valid week identifiers", async () => {
      const validWeeks = ["2025-W01", "2024-W52", "2025-W10"];

      for (const week of validWeeks) {
        const request = createRequest({ week });
        const response = await GET(request);
        expect(response.status).toBe(200);
      }
    });
  });

  describe("Error Handling", () => {
    test("should handle gracefully when database is unavailable", async () => {
      // This test would require mocking database failure
      // Skip for now since it requires more complex setup
    });

    test("should return consistent response structure even with errors", async () => {
      // Test with invalid week that passes format validation but causes calculation issues
      const request = createRequest({ week: "2025-W01" });
      const response = await GET(request);

      expect(response.status).toBe(200);

      const data = await response.json();
      // Response should still have correct structure
      expect(data).toHaveProperty("deploymentFrequency");
      expect(data).toHaveProperty("leadTime");
      expect(data).toHaveProperty("changeFailureRate");
      expect(data).toHaveProperty("mttr");
    });
  });

  describe("Response Performance", () => {
    test("should fetch all 4 metrics in parallel efficiently", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert significant test data
      for (let i = 0; i < 20; i++) {
        await db.insert(deployments).values({
          deploymentId: `deploy-${i}`,
          environment: "production",
          status: i % 5 === 0 ? "failure" : "success",
          orgName: "test-org",
          projectName: `project-${i % 3}`,
          commitSha: `sha-${i}`,
          startedAt: baseDate,
          completedAt: new Date(baseDate.getTime() + 3600000),
          isFailed: i % 5 === 0,
          relatedPRs: [],
        });
      }

      const startTime = Date.now();
      const request = createRequest({ week: testWeek });
      const response = await GET(request);
      const endTime = Date.now();

      expect(response.status).toBe(200);

      // Response should be fast (under 2 seconds for test data)
      const responseTime = endTime - startTime;
      expect(responseTime).toBeLessThan(2000);
    });
  });
});
