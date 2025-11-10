/**
 * PR Metrics Calculation
 * Calculates PR cycle time and review wait time using p50 and p90 aggregations.
 *
 * Metrics:
 * - PR Cycle Time: Time from PR creation to merge (mergedAt - createdAt)
 * - PR Review Wait Time: Time from PR creation to first review (firstReviewAt - createdAt)
 *
 * All metrics exclude draft PRs and return results in hours.
 */

import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { pullRequests } from "@/lib/db/schema";

export interface PercentileMetric {
  p50_hours: number | null;
  p90_hours: number | null;
  count: number;
}

export interface PRSizeDistribution {
  xs: number; // 0-50 lines
  s: number; // 51-200 lines
  m: number; // 201-500 lines
  l: number; // 501-1000 lines
  xl: number; // 1000+ lines
  total: number;
  percentages: {
    xs: number;
    s: number;
    m: number;
    l: number;
    xl: number;
  };
}

/**
 * Calculates PR cycle time (p50 and p90) for merged PRs within a time window.
 * Cycle time is measured from PR creation to merge.
 *
 * @param startDate - Start of time window (inclusive)
 * @param endDate - End of time window (inclusive)
 * @param projectName - Optional project filter
 * @returns Percentile metrics in hours
 *
 * @example
 * const metrics = await calculatePRCycleTime(
 *   new Date("2025-01-06T00:00:00Z"),
 *   new Date("2025-01-12T23:59:59Z"),
 *   "my-project"
 * );
 * // Returns: { p50_hours: 4.2, p90_hours: 24.5, count: 50 }
 */
export async function calculatePRCycleTime(
  startDate: Date,
  endDate: Date,
  projectName?: string,
): Promise<PercentileMetric> {
  try {
    const conditions = [
      gte(pullRequests.createdAt, startDate),
      lte(pullRequests.createdAt, endDate),
      isNotNull(pullRequests.mergedAt),
      eq(pullRequests.isDraft, false),
    ];

    if (projectName) {
      conditions.push(eq(pullRequests.projectName, projectName));
    }

    const result = await db
      .select({
        p50_ms: sql<
          number | null
        >`percentile_cont(0.5) within group (order by extract(epoch from (${pullRequests.mergedAt} - ${pullRequests.createdAt})) * 1000)`,
        p90_ms: sql<
          number | null
        >`percentile_cont(0.9) within group (order by extract(epoch from (${pullRequests.mergedAt} - ${pullRequests.createdAt})) * 1000)`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(pullRequests)
      .where(and(...conditions));

    const row = result[0];

    // Convert milliseconds to hours
    const p50_hours = row.p50_ms ? row.p50_ms / (1000 * 60 * 60) : null;
    const p90_hours = row.p90_ms ? row.p90_ms / (1000 * 60 * 60) : null;

    console.log(
      `[PR Metrics] Cycle Time ${projectName || "Organization"} (${startDate.toISOString()} to ${endDate.toISOString()}): p50=${p50_hours?.toFixed(2)}h, p90=${p90_hours?.toFixed(2)}h, count=${row.count}`,
    );

    return {
      p50_hours,
      p90_hours,
      count: row.count,
    };
  } catch (error) {
    console.error("[PR Metrics] Error calculating PR cycle time:", error);
    throw error;
  }
}

/**
 * Calculates PR review wait time (p50 and p90) for PRs with reviews within a time window.
 * Review wait time is measured from PR creation to first review.
 *
 * NOTE: firstReviewAt is currently null for most PRs (enrichment planned in US2.1b).
 * This function filters out PRs without review timestamps.
 *
 * @param startDate - Start of time window (inclusive)
 * @param endDate - End of time window (inclusive)
 * @param projectName - Optional project filter
 * @returns Percentile metrics in hours
 *
 * @example
 * const metrics = await calculatePRReviewWaitTime(
 *   new Date("2025-01-06T00:00:00Z"),
 *   new Date("2025-01-12T23:59:59Z")
 * );
 * // Returns: { p50_hours: 2.1, p90_hours: 8.3, count: 45 }
 */
export async function calculatePRReviewWaitTime(
  startDate: Date,
  endDate: Date,
  projectName?: string,
): Promise<PercentileMetric> {
  try {
    const conditions = [
      gte(pullRequests.createdAt, startDate),
      lte(pullRequests.createdAt, endDate),
      isNotNull(pullRequests.firstReviewAt),
      eq(pullRequests.isDraft, false),
    ];

    if (projectName) {
      conditions.push(eq(pullRequests.projectName, projectName));
    }

    const result = await db
      .select({
        p50_ms: sql<
          number | null
        >`percentile_cont(0.5) within group (order by extract(epoch from (${pullRequests.firstReviewAt} - ${pullRequests.createdAt})) * 1000)`,
        p90_ms: sql<
          number | null
        >`percentile_cont(0.9) within group (order by extract(epoch from (${pullRequests.firstReviewAt} - ${pullRequests.createdAt})) * 1000)`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(pullRequests)
      .where(and(...conditions));

    const row = result[0];

    // Convert milliseconds to hours
    const p50_hours = row.p50_ms ? row.p50_ms / (1000 * 60 * 60) : null;
    const p90_hours = row.p90_ms ? row.p90_ms / (1000 * 60 * 60) : null;

    console.log(
      `[PR Metrics] Review Wait Time ${projectName || "Organization"} (${startDate.toISOString()} to ${endDate.toISOString()}): p50=${p50_hours?.toFixed(2)}h, p90=${p90_hours?.toFixed(2)}h, count=${row.count}`,
    );

    return {
      p50_hours,
      p90_hours,
      count: row.count,
    };
  } catch (error) {
    console.error("[PR Metrics] Error calculating PR review wait time:", error);
    throw error;
  }
}

/**
 * Calculates PR cycle time by project for all projects within a time window.
 *
 * @param startDate - Start of time window (inclusive)
 * @param endDate - End of time window (inclusive)
 * @returns Map of project names to percentile metrics
 *
 * @example
 * const metrics = await calculatePRCycleTimeByProject(
 *   new Date("2025-01-06T00:00:00Z"),
 *   new Date("2025-01-12T23:59:59Z")
 * );
 * // Returns: Map {
 * //   "project-a" => { p50_hours: 3.5, p90_hours: 12.0, count: 25 },
 * //   "project-b" => { p50_hours: 5.2, p90_hours: 18.5, count: 30 }
 * // }
 */
export async function calculatePRCycleTimeByProject(
  startDate: Date,
  endDate: Date,
): Promise<Map<string, PercentileMetric>> {
  try {
    const result = await db
      .select({
        projectName: pullRequests.projectName,
        p50_ms: sql<
          number | null
        >`percentile_cont(0.5) within group (order by extract(epoch from (${pullRequests.mergedAt} - ${pullRequests.createdAt})) * 1000)`,
        p90_ms: sql<
          number | null
        >`percentile_cont(0.9) within group (order by extract(epoch from (${pullRequests.mergedAt} - ${pullRequests.createdAt})) * 1000)`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(pullRequests)
      .where(
        and(
          gte(pullRequests.createdAt, startDate),
          lte(pullRequests.createdAt, endDate),
          isNotNull(pullRequests.mergedAt),
          eq(pullRequests.isDraft, false),
        ),
      )
      .groupBy(pullRequests.projectName);

    const metrics = new Map<string, PercentileMetric>();

    for (const row of result) {
      const p50_hours = row.p50_ms ? row.p50_ms / (1000 * 60 * 60) : null;
      const p90_hours = row.p90_ms ? row.p90_ms / (1000 * 60 * 60) : null;

      metrics.set(row.projectName, {
        p50_hours,
        p90_hours,
        count: row.count,
      });

      console.log(
        `[PR Metrics] Cycle Time ${row.projectName} (${startDate.toISOString()} to ${endDate.toISOString()}): p50=${p50_hours?.toFixed(2)}h, p90=${p90_hours?.toFixed(2)}h, count=${row.count}`,
      );
    }

    return metrics;
  } catch (error) {
    console.error(
      "[PR Metrics] Error calculating PR cycle time by project:",
      error,
    );
    throw error;
  }
}

/**
 * Calculates PR review wait time by project for all projects within a time window.
 *
 * @param startDate - Start of time window (inclusive)
 * @param endDate - End of time window (inclusive)
 * @returns Map of project names to percentile metrics
 *
 * @example
 * const metrics = await calculatePRReviewWaitTimeByProject(
 *   new Date("2025-01-06T00:00:00Z"),
 *   new Date("2025-01-12T23:59:59Z")
 * );
 * // Returns: Map {
 * //   "project-a" => { p50_hours: 1.8, p90_hours: 6.5, count: 22 },
 * //   "project-b" => { p50_hours: 2.5, p90_hours: 9.0, count: 28 }
 * // }
 */
export async function calculatePRReviewWaitTimeByProject(
  startDate: Date,
  endDate: Date,
): Promise<Map<string, PercentileMetric>> {
  try {
    const result = await db
      .select({
        projectName: pullRequests.projectName,
        p50_ms: sql<
          number | null
        >`percentile_cont(0.5) within group (order by extract(epoch from (${pullRequests.firstReviewAt} - ${pullRequests.createdAt})) * 1000)`,
        p90_ms: sql<
          number | null
        >`percentile_cont(0.9) within group (order by extract(epoch from (${pullRequests.firstReviewAt} - ${pullRequests.createdAt})) * 1000)`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(pullRequests)
      .where(
        and(
          gte(pullRequests.createdAt, startDate),
          lte(pullRequests.createdAt, endDate),
          isNotNull(pullRequests.firstReviewAt),
          eq(pullRequests.isDraft, false),
        ),
      )
      .groupBy(pullRequests.projectName);

    const metrics = new Map<string, PercentileMetric>();

    for (const row of result) {
      const p50_hours = row.p50_ms ? row.p50_ms / (1000 * 60 * 60) : null;
      const p90_hours = row.p90_ms ? row.p90_ms / (1000 * 60 * 60) : null;

      metrics.set(row.projectName, {
        p50_hours,
        p90_hours,
        count: row.count,
      });

      console.log(
        `[PR Metrics] Review Wait Time ${row.projectName} (${startDate.toISOString()} to ${endDate.toISOString()}): p50=${p50_hours?.toFixed(2)}h, p90=${p90_hours?.toFixed(2)}h, count=${row.count}`,
      );
    }

    return metrics;
  } catch (error) {
    console.error(
      "[PR Metrics] Error calculating PR review wait time by project:",
      error,
    );
    throw error;
  }
}

/**
 * Calculates PR size distribution for merged PRs within a time window.
 * Categorizes PRs by total lines changed (additions + deletions) into 5 buckets:
 * XS (0-50), S (51-200), M (201-500), L (501-1000), XL (1000+).
 *
 * @param startDate - Start of time window (inclusive)
 * @param endDate - End of time window (inclusive)
 * @param projectName - Optional project filter
 * @returns Distribution with counts and percentages for each bucket
 *
 * @example
 * const distribution = await calculatePRSizeDistribution(
 *   new Date("2025-01-06T00:00:00Z"),
 *   new Date("2025-01-12T23:59:59Z"),
 *   "my-project"
 * );
 * // Returns: {
 * //   xs: 10, s: 15, m: 8, l: 5, xl: 2, total: 40,
 * //   percentages: { xs: 25, s: 37.5, m: 20, l: 12.5, xl: 5 }
 * // }
 */
export async function calculatePRSizeDistribution(
  startDate: Date,
  endDate: Date,
  projectName?: string,
): Promise<PRSizeDistribution> {
  try {
    const conditions = [
      gte(pullRequests.createdAt, startDate),
      lte(pullRequests.createdAt, endDate),
      isNotNull(pullRequests.mergedAt),
      eq(pullRequests.isDraft, false),
    ];

    if (projectName) {
      conditions.push(eq(pullRequests.projectName, projectName));
    }

    const result = await db
      .select({
        xs: sql<number>`cast(coalesce(sum(case when (${pullRequests.additions} + ${pullRequests.deletions}) <= 50 then 1 else 0 end), 0) as integer)`,
        s: sql<number>`cast(coalesce(sum(case when (${pullRequests.additions} + ${pullRequests.deletions}) > 50 and (${pullRequests.additions} + ${pullRequests.deletions}) <= 200 then 1 else 0 end), 0) as integer)`,
        m: sql<number>`cast(coalesce(sum(case when (${pullRequests.additions} + ${pullRequests.deletions}) > 200 and (${pullRequests.additions} + ${pullRequests.deletions}) <= 500 then 1 else 0 end), 0) as integer)`,
        l: sql<number>`cast(coalesce(sum(case when (${pullRequests.additions} + ${pullRequests.deletions}) > 500 and (${pullRequests.additions} + ${pullRequests.deletions}) <= 1000 then 1 else 0 end), 0) as integer)`,
        xl: sql<number>`cast(coalesce(sum(case when (${pullRequests.additions} + ${pullRequests.deletions}) > 1000 then 1 else 0 end), 0) as integer)`,
        total: sql<number>`cast(count(*) as integer)`,
      })
      .from(pullRequests)
      .where(and(...conditions));

    const row = result[0];

    // Calculate percentages (handle division by zero)
    const percentages = {
      xs: row.total > 0 ? (row.xs / row.total) * 100 : 0,
      s: row.total > 0 ? (row.s / row.total) * 100 : 0,
      m: row.total > 0 ? (row.m / row.total) * 100 : 0,
      l: row.total > 0 ? (row.l / row.total) * 100 : 0,
      xl: row.total > 0 ? (row.xl / row.total) * 100 : 0,
    };

    console.log(
      `[PR Metrics] Size Distribution ${projectName || "Organization"} (${startDate.toISOString()} to ${endDate.toISOString()}): XS=${row.xs} (${percentages.xs.toFixed(1)}%), S=${row.s} (${percentages.s.toFixed(1)}%), M=${row.m} (${percentages.m.toFixed(1)}%), L=${row.l} (${percentages.l.toFixed(1)}%), XL=${row.xl} (${percentages.xl.toFixed(1)}%), total=${row.total}`,
    );

    return {
      xs: row.xs,
      s: row.s,
      m: row.m,
      l: row.l,
      xl: row.xl,
      total: row.total,
      percentages,
    };
  } catch (error) {
    console.error(
      "[PR Metrics] Error calculating PR size distribution:",
      error,
    );
    throw error;
  }
}

/**
 * Calculates PR size distribution by project for all projects within a time window.
 *
 * @param startDate - Start of time window (inclusive)
 * @param endDate - End of time window (inclusive)
 * @returns Map of project names to size distributions
 *
 * @example
 * const distributions = await calculatePRSizeDistributionByProject(
 *   new Date("2025-01-06T00:00:00Z"),
 *   new Date("2025-01-12T23:59:59Z")
 * );
 * // Returns: Map {
 * //   "project-a" => { xs: 5, s: 10, m: 3, l: 2, xl: 0, total: 20, percentages: {...} },
 * //   "project-b" => { xs: 8, s: 12, m: 5, l: 3, xl: 2, total: 30, percentages: {...} }
 * // }
 */
export async function calculatePRSizeDistributionByProject(
  startDate: Date,
  endDate: Date,
): Promise<Map<string, PRSizeDistribution>> {
  try {
    const result = await db
      .select({
        projectName: pullRequests.projectName,
        xs: sql<number>`cast(coalesce(sum(case when (${pullRequests.additions} + ${pullRequests.deletions}) <= 50 then 1 else 0 end), 0) as integer)`,
        s: sql<number>`cast(coalesce(sum(case when (${pullRequests.additions} + ${pullRequests.deletions}) > 50 and (${pullRequests.additions} + ${pullRequests.deletions}) <= 200 then 1 else 0 end), 0) as integer)`,
        m: sql<number>`cast(coalesce(sum(case when (${pullRequests.additions} + ${pullRequests.deletions}) > 200 and (${pullRequests.additions} + ${pullRequests.deletions}) <= 500 then 1 else 0 end), 0) as integer)`,
        l: sql<number>`cast(coalesce(sum(case when (${pullRequests.additions} + ${pullRequests.deletions}) > 500 and (${pullRequests.additions} + ${pullRequests.deletions}) <= 1000 then 1 else 0 end), 0) as integer)`,
        xl: sql<number>`cast(coalesce(sum(case when (${pullRequests.additions} + ${pullRequests.deletions}) > 1000 then 1 else 0 end), 0) as integer)`,
        total: sql<number>`cast(count(*) as integer)`,
      })
      .from(pullRequests)
      .where(
        and(
          gte(pullRequests.createdAt, startDate),
          lte(pullRequests.createdAt, endDate),
          isNotNull(pullRequests.mergedAt),
          eq(pullRequests.isDraft, false),
        ),
      )
      .groupBy(pullRequests.projectName);

    const distributions = new Map<string, PRSizeDistribution>();

    for (const row of result) {
      // Calculate percentages (handle division by zero)
      const percentages = {
        xs: row.total > 0 ? (row.xs / row.total) * 100 : 0,
        s: row.total > 0 ? (row.s / row.total) * 100 : 0,
        m: row.total > 0 ? (row.m / row.total) * 100 : 0,
        l: row.total > 0 ? (row.l / row.total) * 100 : 0,
        xl: row.total > 0 ? (row.xl / row.total) * 100 : 0,
      };

      distributions.set(row.projectName, {
        xs: row.xs,
        s: row.s,
        m: row.m,
        l: row.l,
        xl: row.xl,
        total: row.total,
        percentages,
      });

      console.log(
        `[PR Metrics] Size Distribution ${row.projectName} (${startDate.toISOString()} to ${endDate.toISOString()}): XS=${row.xs} (${percentages.xs.toFixed(1)}%), S=${row.s} (${percentages.s.toFixed(1)}%), M=${row.m} (${percentages.m.toFixed(1)}%), L=${row.l} (${percentages.l.toFixed(1)}%), XL=${row.xl} (${percentages.xl.toFixed(1)}%), total=${row.total}`,
      );
    }

    return distributions;
  } catch (error) {
    console.error(
      "[PR Metrics] Error calculating PR size distribution by project:",
      error,
    );
    throw error;
  }
}
