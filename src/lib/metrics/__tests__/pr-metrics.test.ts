import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/lib/db/client";
import { pullRequests } from "@/lib/db/schema";
import {
  calculatePRCycleTime,
  calculatePRCycleTimeByProject,
  calculatePRReviewWaitTime,
  calculatePRReviewWaitTimeByProject,
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
});
