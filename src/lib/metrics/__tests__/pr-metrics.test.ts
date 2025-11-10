import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/lib/db/client";
import { pullRequests } from "@/lib/db/schema";
import {
  calculatePRCycleTime,
  calculatePRCycleTimeByProject,
  calculatePRReviewWaitTime,
  calculatePRReviewWaitTimeByProject,
  calculatePRSizeDistribution,
  calculatePRSizeDistributionByProject,
} from "../pr-metrics";

describe("PR Metrics", () => {
  const startDate = new Date("2025-01-06T00:00:00Z"); // Monday W02
  const endDate = new Date("2025-01-12T23:59:59Z"); // Sunday W02

  beforeEach(async () => {
    await db.delete(pullRequests);
  });

  afterEach(async () => {
    await db.delete(pullRequests);
  });

  describe("calculatePRCycleTime", () => {
    test("should return null percentiles when no PRs exist", async () => {
      const result = await calculatePRCycleTime(startDate, endDate);

      expect(result.p50_hours).toBe(null);
      expect(result.p90_hours).toBe(null);
      expect(result.count).toBe(0);
    });

    test("should calculate p50 and p90 for merged PRs per acceptance criteria", async () => {
      // Seed 10 PRs: 5 merged in < 4h, 5 merged in > 1 day (24h)
      const baseDate = new Date("2025-01-08T10:00:00Z");

      const testPRs = [
        // 5 PRs with < 4h cycle time
        { hours: 1 },
        { hours: 2 },
        { hours: 3 },
        { hours: 3.5 },
        { hours: 3.8 },
        // 5 PRs with > 1 day cycle time
        { hours: 25 },
        { hours: 30 },
        { hours: 36 },
        { hours: 40 },
        { hours: 48 },
      ];

      for (let i = 0; i < testPRs.length; i++) {
        const createdAt = new Date(baseDate);
        const mergedAt = new Date(baseDate);
        mergedAt.setHours(mergedAt.getHours() + testPRs[i].hours);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          mergedAt,
          isDraft: false,
        });
      }

      const result = await calculatePRCycleTime(startDate, endDate);

      // p50 calculated by PostgreSQL percentile_cont (interpolated median)
      // Sorted: [1, 2, 3, 3.5, 3.8, 25, 30, 36, 40, 48]
      // PostgreSQL percentile_cont(0.5) ≈ 14h
      expect(result.p50_hours).toBeCloseTo(14, 1);

      // p90 should be around 1 day or more
      // p90 of [1, 2, 3, 3.5, 3.8, 25, 30, 36, 40, 48] ≈ 40.8h
      expect(result.p90_hours).toBeGreaterThan(40);
      expect(result.count).toBe(10);
    });

    test("should exclude draft PRs from calculation", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 5 non-draft PRs
      for (let i = 0; i < 5; i++) {
        const createdAt = new Date(baseDate);
        const mergedAt = new Date(baseDate);
        mergedAt.setHours(mergedAt.getHours() + 2);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          mergedAt,
          isDraft: false,
        });
      }

      // Insert 3 draft PRs (should be excluded)
      for (let i = 5; i < 8; i++) {
        const createdAt = new Date(baseDate);
        const mergedAt = new Date(baseDate);
        mergedAt.setHours(mergedAt.getHours() + 10);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `Draft PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          mergedAt,
          isDraft: true,
        });
      }

      const result = await calculatePRCycleTime(startDate, endDate);

      // Should only count 5 non-draft PRs
      expect(result.count).toBe(5);
      expect(result.p50_hours).toBeCloseTo(2, 1);
    });

    test("should only include PRs with mergedAt timestamp", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 3 merged PRs
      for (let i = 0; i < 3; i++) {
        const createdAt = new Date(baseDate);
        const mergedAt = new Date(baseDate);
        mergedAt.setHours(mergedAt.getHours() + 4);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `Merged PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          mergedAt,
          isDraft: false,
        });
      }

      // Insert 2 open PRs (no mergedAt)
      for (let i = 3; i < 5; i++) {
        const createdAt = new Date(baseDate);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `Open PR ${i + 1}`,
          author: "test-author",
          state: "open",
          createdAt,
          updatedAt: createdAt,
          mergedAt: null,
          isDraft: false,
        });
      }

      const result = await calculatePRCycleTime(startDate, endDate);

      expect(result.count).toBe(3);
    });

    test("should filter by time window correctly", async () => {
      // PR before window
      await db.insert(pullRequests).values({
        prNumber: 1,
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        title: "PR before window",
        author: "test-author",
        state: "merged",
        createdAt: new Date("2025-01-05T23:59:59Z"), // Before startDate
        updatedAt: new Date("2025-01-05T23:59:59Z"),
        mergedAt: new Date("2025-01-06T02:00:00Z"),
        isDraft: false,
      });

      // PR within window
      await db.insert(pullRequests).values({
        prNumber: 2,
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        title: "PR within window",
        author: "test-author",
        state: "merged",
        createdAt: new Date("2025-01-08T10:00:00Z"),
        updatedAt: new Date("2025-01-08T10:00:00Z"),
        mergedAt: new Date("2025-01-08T14:00:00Z"),
        isDraft: false,
      });

      // PR after window
      await db.insert(pullRequests).values({
        prNumber: 3,
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        title: "PR after window",
        author: "test-author",
        state: "merged",
        createdAt: new Date("2025-01-13T00:00:00Z"), // After endDate
        updatedAt: new Date("2025-01-13T00:00:00Z"),
        mergedAt: new Date("2025-01-13T04:00:00Z"),
        isDraft: false,
      });

      const result = await calculatePRCycleTime(startDate, endDate);

      expect(result.count).toBe(1);
    });

    test("should filter by project name when specified", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 3 PRs for project-a
      for (let i = 0; i < 3; i++) {
        const createdAt = new Date(baseDate);
        const mergedAt = new Date(baseDate);
        mergedAt.setHours(mergedAt.getHours() + 2);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "project-a",
          title: `PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          mergedAt,
          isDraft: false,
        });
      }

      // Insert 2 PRs for project-b
      for (let i = 3; i < 5; i++) {
        const createdAt = new Date(baseDate);
        const mergedAt = new Date(baseDate);
        mergedAt.setHours(mergedAt.getHours() + 8);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "project-b",
          title: `PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          mergedAt,
          isDraft: false,
        });
      }

      const resultA = await calculatePRCycleTime(
        startDate,
        endDate,
        "project-a",
      );
      const resultB = await calculatePRCycleTime(
        startDate,
        endDate,
        "project-b",
      );

      expect(resultA.count).toBe(3);
      expect(resultA.p50_hours).toBeCloseTo(2, 1);

      expect(resultB.count).toBe(2);
      expect(resultB.p50_hours).toBeCloseTo(8, 1);
    });
  });

  describe("calculatePRReviewWaitTime", () => {
    test("should return null percentiles when no PRs with reviews exist", async () => {
      const result = await calculatePRReviewWaitTime(startDate, endDate);

      expect(result.p50_hours).toBe(null);
      expect(result.p90_hours).toBe(null);
      expect(result.count).toBe(0);
    });

    test("should calculate p50 and p90 for PRs with review timestamps", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Seed 10 PRs with varying review wait times
      const reviewWaitHours = [0.5, 1, 1.5, 2, 2.5, 5, 7, 8, 9, 10];

      for (let i = 0; i < reviewWaitHours.length; i++) {
        const createdAt = new Date(baseDate);
        const firstReviewAt = new Date(baseDate);
        firstReviewAt.setHours(firstReviewAt.getHours() + reviewWaitHours[i]);
        const mergedAt = new Date(firstReviewAt);
        mergedAt.setHours(mergedAt.getHours() + 1);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          firstReviewAt,
          mergedAt,
          isDraft: false,
        });
      }

      const result = await calculatePRReviewWaitTime(startDate, endDate);

      // p50 calculated by PostgreSQL percentile_cont (interpolated median)
      // Sorted: [0.5, 1, 1.5, 2, 2.5, 5, 7, 8, 9, 10]
      // PostgreSQL percentile_cont(0.5) ≈ 3.5h
      expect(result.p50_hours).toBeCloseTo(3.5, 1);

      // p90 should be around 9.5h
      expect(result.p90_hours).toBeGreaterThan(9);
      expect(result.count).toBe(10);
    });

    test("should exclude PRs without firstReviewAt timestamp", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 3 PRs with reviews
      for (let i = 0; i < 3; i++) {
        const createdAt = new Date(baseDate);
        const firstReviewAt = new Date(baseDate);
        firstReviewAt.setHours(firstReviewAt.getHours() + 2);
        const mergedAt = new Date(firstReviewAt);
        mergedAt.setHours(mergedAt.getHours() + 1);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `PR with review ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          firstReviewAt,
          mergedAt,
          isDraft: false,
        });
      }

      // Insert 5 PRs without reviews (firstReviewAt is null)
      for (let i = 3; i < 8; i++) {
        const createdAt = new Date(baseDate);
        const mergedAt = new Date(baseDate);
        mergedAt.setHours(mergedAt.getHours() + 5);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `PR without review ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          firstReviewAt: null,
          mergedAt,
          isDraft: false,
        });
      }

      const result = await calculatePRReviewWaitTime(startDate, endDate);

      // Should only count 3 PRs with reviews
      expect(result.count).toBe(3);
      expect(result.p50_hours).toBeCloseTo(2, 1);
    });

    test("should exclude draft PRs from calculation", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 2 non-draft PRs with reviews
      for (let i = 0; i < 2; i++) {
        const createdAt = new Date(baseDate);
        const firstReviewAt = new Date(baseDate);
        firstReviewAt.setHours(firstReviewAt.getHours() + 1);
        const mergedAt = new Date(firstReviewAt);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          firstReviewAt,
          mergedAt,
          isDraft: false,
        });
      }

      // Insert 1 draft PR with review (should be excluded)
      const draftCreatedAt = new Date(baseDate);
      const draftFirstReviewAt = new Date(baseDate);
      draftFirstReviewAt.setHours(draftFirstReviewAt.getHours() + 10);

      await db.insert(pullRequests).values({
        prNumber: 3,
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        title: "Draft PR",
        author: "test-author",
        state: "merged",
        createdAt: draftCreatedAt,
        updatedAt: draftCreatedAt,
        firstReviewAt: draftFirstReviewAt,
        mergedAt: draftFirstReviewAt,
        isDraft: true,
      });

      const result = await calculatePRReviewWaitTime(startDate, endDate);

      expect(result.count).toBe(2);
    });
  });

  describe("calculatePRCycleTimeByProject", () => {
    test("should return empty map when no PRs exist", async () => {
      const result = await calculatePRCycleTimeByProject(startDate, endDate);

      expect(result.size).toBe(0);
    });

    test("should aggregate by project correctly", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Project A: 3 PRs with ~2h cycle time
      for (let i = 0; i < 3; i++) {
        const createdAt = new Date(baseDate);
        const mergedAt = new Date(baseDate);
        mergedAt.setHours(mergedAt.getHours() + 2);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "project-a",
          title: `PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          mergedAt,
          isDraft: false,
        });
      }

      // Project B: 2 PRs with ~8h cycle time
      for (let i = 0; i < 2; i++) {
        const createdAt = new Date(baseDate);
        const mergedAt = new Date(baseDate);
        mergedAt.setHours(mergedAt.getHours() + 8);

        await db.insert(pullRequests).values({
          prNumber: i + 10,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "project-b",
          title: `PR ${i + 10}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          mergedAt,
          isDraft: false,
        });
      }

      const result = await calculatePRCycleTimeByProject(startDate, endDate);

      expect(result.size).toBe(2);

      const projectA = result.get("project-a");
      expect(projectA).toBeDefined();
      expect(projectA?.count).toBe(3);
      expect(projectA?.p50_hours).toBeCloseTo(2, 1);

      const projectB = result.get("project-b");
      expect(projectB).toBeDefined();
      expect(projectB?.count).toBe(2);
      expect(projectB?.p50_hours).toBeCloseTo(8, 1);
    });
  });

  describe("calculatePRReviewWaitTimeByProject", () => {
    test("should return empty map when no PRs with reviews exist", async () => {
      const result = await calculatePRReviewWaitTimeByProject(
        startDate,
        endDate,
      );

      expect(result.size).toBe(0);
    });

    test("should aggregate by project correctly", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Project A: 3 PRs with ~1h review wait
      for (let i = 0; i < 3; i++) {
        const createdAt = new Date(baseDate);
        const firstReviewAt = new Date(baseDate);
        firstReviewAt.setHours(firstReviewAt.getHours() + 1);
        const mergedAt = new Date(firstReviewAt);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "project-a",
          title: `PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          firstReviewAt,
          mergedAt,
          isDraft: false,
        });
      }

      // Project B: 2 PRs with ~4h review wait
      for (let i = 0; i < 2; i++) {
        const createdAt = new Date(baseDate);
        const firstReviewAt = new Date(baseDate);
        firstReviewAt.setHours(firstReviewAt.getHours() + 4);
        const mergedAt = new Date(firstReviewAt);

        await db.insert(pullRequests).values({
          prNumber: i + 10,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "project-b",
          title: `PR ${i + 10}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          firstReviewAt,
          mergedAt,
          isDraft: false,
        });
      }

      const result = await calculatePRReviewWaitTimeByProject(
        startDate,
        endDate,
      );

      expect(result.size).toBe(2);

      const projectA = result.get("project-a");
      expect(projectA).toBeDefined();
      expect(projectA?.count).toBe(3);
      expect(projectA?.p50_hours).toBeCloseTo(1, 1);

      const projectB = result.get("project-b");
      expect(projectB).toBeDefined();
      expect(projectB?.count).toBe(2);
      expect(projectB?.p50_hours).toBeCloseTo(4, 1);
    });
  });

  describe("calculatePRSizeDistribution", () => {
    test("should return zero distribution when no PRs exist", async () => {
      const result = await calculatePRSizeDistribution(startDate, endDate);

      expect(result.total).toBe(0);
      expect(result.xs).toBe(0);
      expect(result.s).toBe(0);
      expect(result.m).toBe(0);
      expect(result.l).toBe(0);
      expect(result.xl).toBe(0);
      expect(result.percentages.xs).toBe(0);
      expect(result.percentages.s).toBe(0);
      expect(result.percentages.m).toBe(0);
      expect(result.percentages.l).toBe(0);
      expect(result.percentages.xl).toBe(0);
    });

    test("should categorize PRs into correct size buckets", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Test data: [additions, deletions, expected_bucket]
      const testPRs = [
        // XS: 0-50 lines
        { additions: 0, deletions: 0, bucket: "xs" }, // 0 lines
        { additions: 25, deletions: 25, bucket: "xs" }, // 50 lines (boundary)
        { additions: 30, deletions: 10, bucket: "xs" }, // 40 lines
        // S: 51-200 lines
        { additions: 30, deletions: 21, bucket: "s" }, // 51 lines (boundary)
        { additions: 100, deletions: 100, bucket: "s" }, // 200 lines (boundary)
        { additions: 150, deletions: 25, bucket: "s" }, // 175 lines
        // M: 201-500 lines
        { additions: 150, deletions: 51, bucket: "m" }, // 201 lines (boundary)
        { additions: 300, deletions: 200, bucket: "m" }, // 500 lines (boundary)
        { additions: 400, deletions: 50, bucket: "m" }, // 450 lines
        // L: 501-1000 lines
        { additions: 300, deletions: 201, bucket: "l" }, // 501 lines (boundary)
        { additions: 600, deletions: 400, bucket: "l" }, // 1000 lines (boundary)
        { additions: 700, deletions: 100, bucket: "l" }, // 800 lines
        // XL: 1000+ lines
        { additions: 600, deletions: 401, bucket: "xl" }, // 1001 lines (boundary)
        { additions: 5000, deletions: 5000, bucket: "xl" }, // 10,000 lines
        { additions: 15000, deletions: 5000, bucket: "xl" }, // 20,000 lines
      ];

      for (let i = 0; i < testPRs.length; i++) {
        const createdAt = new Date(baseDate);
        const mergedAt = new Date(baseDate);
        mergedAt.setHours(mergedAt.getHours() + 1);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          mergedAt,
          isDraft: false,
          additions: testPRs[i].additions,
          deletions: testPRs[i].deletions,
        });
      }

      const result = await calculatePRSizeDistribution(startDate, endDate);

      expect(result.total).toBe(15);
      expect(result.xs).toBe(3); // 0, 50, 40 lines
      expect(result.s).toBe(3); // 51, 200, 175 lines
      expect(result.m).toBe(3); // 201, 500, 450 lines
      expect(result.l).toBe(3); // 501, 1000, 800 lines
      expect(result.xl).toBe(3); // 1001, 10000, 20000 lines

      // Verify percentages (each bucket has 3 PRs out of 15 = 20%)
      expect(result.percentages.xs).toBeCloseTo(20, 1);
      expect(result.percentages.s).toBeCloseTo(20, 1);
      expect(result.percentages.m).toBeCloseTo(20, 1);
      expect(result.percentages.l).toBeCloseTo(20, 1);
      expect(result.percentages.xl).toBeCloseTo(20, 1);

      // Percentages should sum to 100%
      const sum =
        result.percentages.xs +
        result.percentages.s +
        result.percentages.m +
        result.percentages.l +
        result.percentages.xl;
      expect(sum).toBeCloseTo(100, 0);
    });

    test("should exclude draft PRs from distribution", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 3 non-draft PRs (XS bucket)
      for (let i = 0; i < 3; i++) {
        const createdAt = new Date(baseDate);
        const mergedAt = new Date(baseDate);
        mergedAt.setHours(mergedAt.getHours() + 1);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          mergedAt,
          isDraft: false,
          additions: 25,
          deletions: 0,
        });
      }

      // Insert 2 draft PRs (should be excluded, even though they're XL)
      for (let i = 3; i < 5; i++) {
        const createdAt = new Date(baseDate);
        const mergedAt = new Date(baseDate);
        mergedAt.setHours(mergedAt.getHours() + 1);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `Draft PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          mergedAt,
          isDraft: true,
          additions: 5000,
          deletions: 5000,
        });
      }

      const result = await calculatePRSizeDistribution(startDate, endDate);

      expect(result.total).toBe(3);
      expect(result.xs).toBe(3);
      expect(result.xl).toBe(0); // Draft PRs should be excluded
    });

    test("should only include merged PRs", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 2 merged PRs (S bucket)
      for (let i = 0; i < 2; i++) {
        const createdAt = new Date(baseDate);
        const mergedAt = new Date(baseDate);
        mergedAt.setHours(mergedAt.getHours() + 1);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `Merged PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          mergedAt,
          isDraft: false,
          additions: 75,
          deletions: 25,
        });
      }

      // Insert 3 open PRs (should be excluded)
      for (let i = 2; i < 5; i++) {
        const createdAt = new Date(baseDate);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "test-project",
          title: `Open PR ${i + 1}`,
          author: "test-author",
          state: "open",
          createdAt,
          updatedAt: createdAt,
          mergedAt: null,
          isDraft: false,
          additions: 500,
          deletions: 0,
        });
      }

      const result = await calculatePRSizeDistribution(startDate, endDate);

      expect(result.total).toBe(2);
      expect(result.s).toBe(2);
      expect(result.m).toBe(0); // Open PRs should be excluded
    });

    test("should filter by time window correctly", async () => {
      // PR before window (XS)
      await db.insert(pullRequests).values({
        prNumber: 1,
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        title: "PR before window",
        author: "test-author",
        state: "merged",
        createdAt: new Date("2025-01-05T23:59:59Z"),
        updatedAt: new Date("2025-01-05T23:59:59Z"),
        mergedAt: new Date("2025-01-06T02:00:00Z"),
        isDraft: false,
        additions: 10,
        deletions: 10,
      });

      // PR within window (S)
      await db.insert(pullRequests).values({
        prNumber: 2,
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        title: "PR within window",
        author: "test-author",
        state: "merged",
        createdAt: new Date("2025-01-08T10:00:00Z"),
        updatedAt: new Date("2025-01-08T10:00:00Z"),
        mergedAt: new Date("2025-01-08T14:00:00Z"),
        isDraft: false,
        additions: 100,
        deletions: 0,
      });

      // PR after window (M)
      await db.insert(pullRequests).values({
        prNumber: 3,
        repoName: "test-repo",
        orgName: "test-org",
        projectName: "test-project",
        title: "PR after window",
        author: "test-author",
        state: "merged",
        createdAt: new Date("2025-01-13T00:00:00Z"),
        updatedAt: new Date("2025-01-13T00:00:00Z"),
        mergedAt: new Date("2025-01-13T04:00:00Z"),
        isDraft: false,
        additions: 200,
        deletions: 100,
      });

      const result = await calculatePRSizeDistribution(startDate, endDate);

      expect(result.total).toBe(1);
      expect(result.s).toBe(1);
      expect(result.xs).toBe(0);
      expect(result.m).toBe(0);
    });

    test("should filter by project name when specified", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Insert 3 XS PRs for project-a
      for (let i = 0; i < 3; i++) {
        const createdAt = new Date(baseDate);
        const mergedAt = new Date(baseDate);
        mergedAt.setHours(mergedAt.getHours() + 1);

        await db.insert(pullRequests).values({
          prNumber: i + 1,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "project-a",
          title: `PR ${i + 1}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          mergedAt,
          isDraft: false,
          additions: 20,
          deletions: 10,
        });
      }

      // Insert 2 XL PRs for project-b
      for (let i = 0; i < 2; i++) {
        const createdAt = new Date(baseDate);
        const mergedAt = new Date(baseDate);
        mergedAt.setHours(mergedAt.getHours() + 1);

        await db.insert(pullRequests).values({
          prNumber: i + 10,
          repoName: "test-repo",
          orgName: "test-org",
          projectName: "project-b",
          title: `PR ${i + 10}`,
          author: "test-author",
          state: "merged",
          createdAt,
          updatedAt: createdAt,
          mergedAt,
          isDraft: false,
          additions: 2000,
          deletions: 1000,
        });
      }

      const resultA = await calculatePRSizeDistribution(
        startDate,
        endDate,
        "project-a",
      );
      const resultB = await calculatePRSizeDistribution(
        startDate,
        endDate,
        "project-b",
      );

      expect(resultA.total).toBe(3);
      expect(resultA.xs).toBe(3);
      expect(resultA.percentages.xs).toBeCloseTo(100, 1);

      expect(resultB.total).toBe(2);
      expect(resultB.xl).toBe(2);
      expect(resultB.percentages.xl).toBeCloseTo(100, 1);
    });

    test("should calculate realistic distribution matching acceptance criteria", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Realistic distribution: 10 XS, 15 S, 8 M, 5 L, 2 XL (total 40)
      const distribution = [
        { count: 10, additions: 25, deletions: 10 }, // XS: 35 lines
        { count: 15, additions: 100, deletions: 50 }, // S: 150 lines
        { count: 8, additions: 250, deletions: 100 }, // M: 350 lines
        { count: 5, additions: 600, deletions: 200 }, // L: 800 lines
        { count: 2, additions: 1500, deletions: 500 }, // XL: 2000 lines
      ];

      // Batch insert for performance
      const prsToInsert = [];
      let prNumber = 1;
      for (const bucket of distribution) {
        for (let i = 0; i < bucket.count; i++) {
          const createdAt = new Date(baseDate);
          const mergedAt = new Date(baseDate);
          mergedAt.setHours(mergedAt.getHours() + 1);

          prsToInsert.push({
            prNumber: prNumber++,
            repoName: "test-repo",
            orgName: "test-org",
            projectName: "test-project",
            title: `PR ${prNumber}`,
            author: "test-author",
            state: "merged",
            createdAt,
            updatedAt: createdAt,
            mergedAt,
            isDraft: false,
            additions: bucket.additions,
            deletions: bucket.deletions,
          });
        }
      }

      await db.insert(pullRequests).values(prsToInsert);

      const result = await calculatePRSizeDistribution(startDate, endDate);

      expect(result.total).toBe(40);
      expect(result.xs).toBe(10);
      expect(result.s).toBe(15);
      expect(result.m).toBe(8);
      expect(result.l).toBe(5);
      expect(result.xl).toBe(2);

      // Expected percentages
      expect(result.percentages.xs).toBeCloseTo(25, 1); // 10/40 = 25%
      expect(result.percentages.s).toBeCloseTo(37.5, 1); // 15/40 = 37.5%
      expect(result.percentages.m).toBeCloseTo(20, 1); // 8/40 = 20%
      expect(result.percentages.l).toBeCloseTo(12.5, 1); // 5/40 = 12.5%
      expect(result.percentages.xl).toBeCloseTo(5, 1); // 2/40 = 5%
    });
  });

  describe("calculatePRSizeDistributionByProject", () => {
    test("should return empty map when no PRs exist", async () => {
      const result = await calculatePRSizeDistributionByProject(
        startDate,
        endDate,
      );

      expect(result.size).toBe(0);
    });

    test("should aggregate by project correctly", async () => {
      const baseDate = new Date("2025-01-08T10:00:00Z");

      // Project A: 5 XS, 10 S, 3 M, 2 L, 0 XL (total 20)
      const projectADistribution = [
        { count: 5, additions: 20, deletions: 10 }, // XS
        { count: 10, additions: 100, deletions: 0 }, // S
        { count: 3, additions: 300, deletions: 50 }, // M
        { count: 2, additions: 700, deletions: 100 }, // L
      ];

      // Project B: 8 S, 12 M, 5 L, 3 XL, 2 XL (total 30)
      const projectBDistribution = [
        { count: 8, additions: 120, deletions: 30 }, // S
        { count: 12, additions: 250, deletions: 100 }, // M
        { count: 5, additions: 600, deletions: 150 }, // L
        { count: 3, additions: 1200, deletions: 300 }, // XL
        { count: 2, additions: 5000, deletions: 5000 }, // XL
      ];

      // Batch insert for performance
      const prsToInsert = [];
      let prNumber = 1;

      for (const bucket of projectADistribution) {
        for (let i = 0; i < bucket.count; i++) {
          const createdAt = new Date(baseDate);
          const mergedAt = new Date(baseDate);
          mergedAt.setHours(mergedAt.getHours() + 1);

          prsToInsert.push({
            prNumber: prNumber++,
            repoName: "test-repo",
            orgName: "test-org",
            projectName: "project-a",
            title: `PR ${prNumber}`,
            author: "test-author",
            state: "merged",
            createdAt,
            updatedAt: createdAt,
            mergedAt,
            isDraft: false,
            additions: bucket.additions,
            deletions: bucket.deletions,
          });
        }
      }

      for (const bucket of projectBDistribution) {
        for (let i = 0; i < bucket.count; i++) {
          const createdAt = new Date(baseDate);
          const mergedAt = new Date(baseDate);
          mergedAt.setHours(mergedAt.getHours() + 1);

          prsToInsert.push({
            prNumber: prNumber++,
            repoName: "test-repo",
            orgName: "test-org",
            projectName: "project-b",
            title: `PR ${prNumber}`,
            author: "test-author",
            state: "merged",
            createdAt,
            updatedAt: createdAt,
            mergedAt,
            isDraft: false,
            additions: bucket.additions,
            deletions: bucket.deletions,
          });
        }
      }

      await db.insert(pullRequests).values(prsToInsert);

      const result = await calculatePRSizeDistributionByProject(
        startDate,
        endDate,
      );

      expect(result.size).toBe(2);

      const projectA = result.get("project-a");
      expect(projectA).toBeDefined();
      expect(projectA?.total).toBe(20);
      expect(projectA?.xs).toBe(5);
      expect(projectA?.s).toBe(10);
      expect(projectA?.m).toBe(3);
      expect(projectA?.l).toBe(2);
      expect(projectA?.xl).toBe(0);
      expect(projectA?.percentages.xs).toBeCloseTo(25, 1); // 5/20 = 25%
      expect(projectA?.percentages.s).toBeCloseTo(50, 1); // 10/20 = 50%

      const projectB = result.get("project-b");
      expect(projectB).toBeDefined();
      expect(projectB?.total).toBe(30);
      expect(projectB?.xs).toBe(0);
      expect(projectB?.s).toBe(8);
      expect(projectB?.m).toBe(12);
      expect(projectB?.l).toBe(5);
      expect(projectB?.xl).toBe(5); // 3 + 2 = 5
      expect(projectB?.percentages.xl).toBeCloseTo(16.67, 1); // 5/30 ≈ 16.67%
    });
  });
});
