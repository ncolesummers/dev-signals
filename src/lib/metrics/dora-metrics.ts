/**
 * DORA Metrics Calculation
 * Calculates DevOps Research and Assessment (DORA) metrics for deployment performance.
 *
 * Metrics:
 * - Deployment Frequency: Count of successful production deployments per time window
 * - Lead Time for Changes: Time from first commit (PR creation) to production deployment
 * - Change Failure Rate: Percentage of deployments that fail or require rollback
 * - Mean Time to Recovery (MTTR): Time to restore service after failed deployment
 *
 * All percentile metrics use p50 and p90 aggregations and return results in hours.
 */

import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { deployments, pullRequests } from "@/lib/db/schema";

// Re-export PercentileMetric from pr-metrics for consistency
export type { PercentileMetric } from "./pr-metrics";

export interface DeploymentFrequency {
  count: number;
}

export interface ChangeFailureRate {
  percentage: number;
  failed_count: number;
  total_count: number;
}

/**
 * Calculates deployment frequency (count of successful production deployments) within a time window.
 *
 * @param startDate - Start of time window (inclusive)
 * @param endDate - End of time window (inclusive)
 * @param projectName - Optional project filter
 * @returns Deployment count
 *
 * @example
 * const freq = await calculateDeploymentFrequency(
 *   new Date("2025-01-06T00:00:00Z"),
 *   new Date("2025-01-12T23:59:59Z"),
 *   "my-project"
 * );
 * // Returns: { count: 15 }
 */
export async function calculateDeploymentFrequency(
  startDate: Date,
  endDate: Date,
  projectName?: string,
): Promise<DeploymentFrequency> {
  try {
    const conditions = [
      gte(deployments.startedAt, startDate),
      lte(deployments.startedAt, endDate),
      eq(deployments.environment, "production"),
      eq(deployments.status, "success"),
    ];

    if (projectName) {
      conditions.push(eq(deployments.projectName, projectName));
    }

    const result = await db
      .select({
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(deployments)
      .where(and(...conditions));

    const row = result[0];

    console.log(
      `[DORA Metrics] Deployment Frequency ${projectName || "Organization"} (${startDate.toISOString()} to ${endDate.toISOString()}): count=${row.count}`,
    );

    return {
      count: row.count,
    };
  } catch (error) {
    console.error(
      "[DORA Metrics] Error calculating deployment frequency:",
      error,
    );
    throw error;
  }
}

/**
 * Calculates deployment frequency by project for all projects within a time window.
 *
 * @param startDate - Start of time window (inclusive)
 * @param endDate - End of time window (inclusive)
 * @returns Map of project names to deployment counts
 *
 * @example
 * const frequencies = await calculateDeploymentFrequencyByProject(
 *   new Date("2025-01-06T00:00:00Z"),
 *   new Date("2025-01-12T23:59:59Z")
 * );
 * // Returns: Map {
 * //   "project-a" => { count: 10 },
 * //   "project-b" => { count: 5 }
 * // }
 */
export async function calculateDeploymentFrequencyByProject(
  startDate: Date,
  endDate: Date,
): Promise<Map<string, DeploymentFrequency>> {
  try {
    const result = await db
      .select({
        projectName: deployments.projectName,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(deployments)
      .where(
        and(
          gte(deployments.startedAt, startDate),
          lte(deployments.startedAt, endDate),
          eq(deployments.environment, "production"),
          eq(deployments.status, "success"),
        ),
      )
      .groupBy(deployments.projectName);

    const frequencies = new Map<string, DeploymentFrequency>();

    for (const row of result) {
      frequencies.set(row.projectName, {
        count: row.count,
      });

      console.log(
        `[DORA Metrics] Deployment Frequency ${row.projectName} (${startDate.toISOString()} to ${endDate.toISOString()}): count=${row.count}`,
      );
    }

    return frequencies;
  } catch (error) {
    console.error(
      "[DORA Metrics] Error calculating deployment frequency by project:",
      error,
    );
    throw error;
  }
}

/**
 * Calculates change failure rate (percentage of deployments that fail or require rollback).
 *
 * NOTE: This metric counts both failed deployments (isFailed=true) and rollback deployments
 * (isRollback=true) as failures, following DORA guidelines that any deployment requiring
 * remediation should be counted as a failure.
 *
 * @param startDate - Start of time window (inclusive)
 * @param endDate - End of time window (inclusive)
 * @param projectName - Optional project filter
 * @returns Change failure rate with counts
 *
 * @example
 * const cfr = await calculateChangeFailureRate(
 *   new Date("2025-01-06T00:00:00Z"),
 *   new Date("2025-01-12T23:59:59Z"),
 *   "my-project"
 * );
 * // Returns: { percentage: 12.5, failed_count: 5, total_count: 40 }
 */
export async function calculateChangeFailureRate(
  startDate: Date,
  endDate: Date,
  projectName?: string,
): Promise<ChangeFailureRate> {
  try {
    const conditions = [
      gte(deployments.startedAt, startDate),
      lte(deployments.startedAt, endDate),
      eq(deployments.environment, "production"),
    ];

    if (projectName) {
      conditions.push(eq(deployments.projectName, projectName));
    }

    const result = await db
      .select({
        failed_count: sql<number>`cast(coalesce(sum(case when ${deployments.isFailed} = true OR ${deployments.isRollback} = true then 1 else 0 end), 0) as integer)`,
        total_count: sql<number>`cast(count(*) as integer)`,
      })
      .from(deployments)
      .where(and(...conditions));

    const row = result[0];

    // Calculate percentage (handle division by zero)
    const percentage =
      row.total_count > 0 ? (row.failed_count / row.total_count) * 100 : 0;

    console.log(
      `[DORA Metrics] Change Failure Rate ${projectName || "Organization"} (${startDate.toISOString()} to ${endDate.toISOString()}): ${percentage.toFixed(2)}% (${row.failed_count}/${row.total_count})`,
    );

    return {
      percentage,
      failed_count: row.failed_count,
      total_count: row.total_count,
    };
  } catch (error) {
    console.error(
      "[DORA Metrics] Error calculating change failure rate:",
      error,
    );
    throw error;
  }
}

/**
 * Calculates change failure rate by project for all projects within a time window.
 *
 * @param startDate - Start of time window (inclusive)
 * @param endDate - End of time window (inclusive)
 * @returns Map of project names to change failure rates
 *
 * @example
 * const cfrs = await calculateChangeFailureRateByProject(
 *   new Date("2025-01-06T00:00:00Z"),
 *   new Date("2025-01-12T23:59:59Z")
 * );
 * // Returns: Map {
 * //   "project-a" => { percentage: 10.0, failed_count: 2, total_count: 20 },
 * //   "project-b" => { percentage: 15.0, failed_count: 3, total_count: 20 }
 * // }
 */
export async function calculateChangeFailureRateByProject(
  startDate: Date,
  endDate: Date,
): Promise<Map<string, ChangeFailureRate>> {
  try {
    const result = await db
      .select({
        projectName: deployments.projectName,
        failed_count: sql<number>`cast(coalesce(sum(case when ${deployments.isFailed} = true OR ${deployments.isRollback} = true then 1 else 0 end), 0) as integer)`,
        total_count: sql<number>`cast(count(*) as integer)`,
      })
      .from(deployments)
      .where(
        and(
          gte(deployments.startedAt, startDate),
          lte(deployments.startedAt, endDate),
          eq(deployments.environment, "production"),
        ),
      )
      .groupBy(deployments.projectName);

    const cfrs = new Map<string, ChangeFailureRate>();

    for (const row of result) {
      // Calculate percentage (handle division by zero)
      const percentage =
        row.total_count > 0 ? (row.failed_count / row.total_count) * 100 : 0;

      cfrs.set(row.projectName, {
        percentage,
        failed_count: row.failed_count,
        total_count: row.total_count,
      });

      console.log(
        `[DORA Metrics] Change Failure Rate ${row.projectName} (${startDate.toISOString()} to ${endDate.toISOString()}): ${percentage.toFixed(2)}% (${row.failed_count}/${row.total_count})`,
      );
    }

    return cfrs;
  } catch (error) {
    console.error(
      "[DORA Metrics] Error calculating change failure rate by project:",
      error,
    );
    throw error;
  }
}

/**
 * Calculates lead time for changes (time from PR creation to production deployment).
 *
 * This metric measures the time from when code is first committed (PR creation) to when
 * it's deployed to production. It uses the relatedPRs JSONB array in deployments to link
 * deployments back to their source PRs.
 *
 * NOTE: This metric requires deployments to have relatedPRs populated. If relatedPRs is
 * empty or not yet enriched, this will return count=0 with null percentiles.
 *
 * @param startDate - Start of time window (inclusive, filters by deployment startedAt)
 * @param endDate - End of time window (inclusive, filters by deployment startedAt)
 * @param projectName - Optional project filter
 * @returns Percentile metrics in hours
 *
 * @example
 * const leadTime = await calculateLeadTimeForChanges(
 *   new Date("2025-01-06T00:00:00Z"),
 *   new Date("2025-01-12T23:59:59Z"),
 *   "my-project"
 * );
 * // Returns: { p50_hours: 48.5, p90_hours: 120.2, count: 30 }
 */
export async function calculateLeadTimeForChanges(
  startDate: Date,
  endDate: Date,
  projectName?: string,
): Promise<{
  p50_hours: number | null;
  p90_hours: number | null;
  count: number;
}> {
  try {
    const conditions = [
      gte(deployments.startedAt, startDate),
      lte(deployments.startedAt, endDate),
      eq(deployments.environment, "production"),
      eq(deployments.status, "success"),
      // Only deployments with related PRs
      sql`jsonb_array_length(${deployments.relatedPRs}::jsonb) > 0`,
    ];

    if (projectName) {
      conditions.push(eq(deployments.projectName, projectName));
    }

    // Use CROSS JOIN LATERAL to unnest the JSONB array and join with pull_requests
    const result = await db
      .select({
        p50_ms: sql<
          number | null
        >`percentile_cont(0.5) within group (order by extract(epoch from (${deployments.completedAt} - ${pullRequests.createdAt})) * 1000)`,
        p90_ms: sql<
          number | null
        >`percentile_cont(0.9) within group (order by extract(epoch from (${deployments.completedAt} - ${pullRequests.createdAt})) * 1000)`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(deployments)
      .where(and(...conditions))
      // Lateral join to unnest relatedPRs JSONB array
      .innerJoin(
        sql`LATERAL jsonb_array_elements_text(${deployments.relatedPRs}::jsonb) AS pr_num(value)`,
        sql`true`,
      )
      // Join with pull_requests table on prNumber
      .innerJoin(
        pullRequests,
        sql`${pullRequests.prNumber}::text = pr_num.value AND ${pullRequests.projectName} = ${deployments.projectName}`,
      );

    const row = result[0];

    // Convert milliseconds to hours
    const p50_hours = row.p50_ms ? row.p50_ms / (1000 * 60 * 60) : null;
    const p90_hours = row.p90_ms ? row.p90_ms / (1000 * 60 * 60) : null;

    console.log(
      `[DORA Metrics] Lead Time for Changes ${projectName || "Organization"} (${startDate.toISOString()} to ${endDate.toISOString()}): p50=${p50_hours?.toFixed(2)}h, p90=${p90_hours?.toFixed(2)}h, count=${row.count}`,
    );

    return {
      p50_hours,
      p90_hours,
      count: row.count,
    };
  } catch (error) {
    console.error(
      "[DORA Metrics] Error calculating lead time for changes:",
      error,
    );
    throw error;
  }
}

/**
 * Calculates lead time for changes by project for all projects within a time window.
 *
 * @param startDate - Start of time window (inclusive)
 * @param endDate - End of time window (inclusive)
 * @returns Map of project names to percentile metrics
 *
 * @example
 * const leadTimes = await calculateLeadTimeForChangesByProject(
 *   new Date("2025-01-06T00:00:00Z"),
 *   new Date("2025-01-12T23:59:59Z")
 * );
 * // Returns: Map {
 * //   "project-a" => { p50_hours: 36.0, p90_hours: 96.0, count: 15 },
 * //   "project-b" => { p50_hours: 60.0, p90_hours: 144.0, count: 20 }
 * // }
 */
export async function calculateLeadTimeForChangesByProject(
  startDate: Date,
  endDate: Date,
): Promise<
  Map<
    string,
    { p50_hours: number | null; p90_hours: number | null; count: number }
  >
> {
  try {
    const result = await db
      .select({
        projectName: deployments.projectName,
        p50_ms: sql<
          number | null
        >`percentile_cont(0.5) within group (order by extract(epoch from (${deployments.completedAt} - ${pullRequests.createdAt})) * 1000)`,
        p90_ms: sql<
          number | null
        >`percentile_cont(0.9) within group (order by extract(epoch from (${deployments.completedAt} - ${pullRequests.createdAt})) * 1000)`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(deployments)
      .where(
        and(
          gte(deployments.startedAt, startDate),
          lte(deployments.startedAt, endDate),
          eq(deployments.environment, "production"),
          eq(deployments.status, "success"),
          sql`jsonb_array_length(${deployments.relatedPRs}::jsonb) > 0`,
        ),
      )
      // Lateral join to unnest relatedPRs JSONB array
      .innerJoin(
        sql`LATERAL jsonb_array_elements_text(${deployments.relatedPRs}::jsonb) AS pr_num(value)`,
        sql`true`,
      )
      // Join with pull_requests table on prNumber
      .innerJoin(
        pullRequests,
        sql`${pullRequests.prNumber}::text = pr_num.value AND ${pullRequests.projectName} = ${deployments.projectName}`,
      )
      .groupBy(deployments.projectName);

    const leadTimes = new Map<
      string,
      { p50_hours: number | null; p90_hours: number | null; count: number }
    >();

    for (const row of result) {
      const p50_hours = row.p50_ms ? row.p50_ms / (1000 * 60 * 60) : null;
      const p90_hours = row.p90_ms ? row.p90_ms / (1000 * 60 * 60) : null;

      leadTimes.set(row.projectName, {
        p50_hours,
        p90_hours,
        count: row.count,
      });

      console.log(
        `[DORA Metrics] Lead Time for Changes ${row.projectName} (${startDate.toISOString()} to ${endDate.toISOString()}): p50=${p50_hours?.toFixed(2)}h, p90=${p90_hours?.toFixed(2)}h, count=${row.count}`,
      );
    }

    return leadTimes;
  } catch (error) {
    console.error(
      "[DORA Metrics] Error calculating lead time for changes by project:",
      error,
    );
    throw error;
  }
}

/**
 * Calculates Mean Time to Recovery (MTTR) for failed deployments.
 *
 * MTTR measures the time from when a deployment fails to when service is restored
 * (via recovery or rollback). This requires the recoveredAt field to be populated.
 *
 * NOTE: This metric is in early stages and requires incident management workflow to
 * populate recoveredAt timestamps. Until then, expect low counts or null results.
 *
 * @param startDate - Start of time window (inclusive, filters by deployment startedAt)
 * @param endDate - End of time window (inclusive, filters by deployment startedAt)
 * @param projectName - Optional project filter
 * @returns Percentile metrics in hours
 *
 * @example
 * const mttr = await calculateMTTR(
 *   new Date("2025-01-06T00:00:00Z"),
 *   new Date("2025-01-12T23:59:59Z"),
 *   "my-project"
 * );
 * // Returns: { p50_hours: 2.5, p90_hours: 6.0, count: 3 }
 */
export async function calculateMTTR(
  startDate: Date,
  endDate: Date,
  projectName?: string,
): Promise<{
  p50_hours: number | null;
  p90_hours: number | null;
  count: number;
}> {
  try {
    const conditions = [
      gte(deployments.startedAt, startDate),
      lte(deployments.startedAt, endDate),
      eq(deployments.environment, "production"),
      eq(deployments.isFailed, true),
      isNotNull(deployments.recoveredAt),
      isNotNull(deployments.completedAt),
    ];

    if (projectName) {
      conditions.push(eq(deployments.projectName, projectName));
    }

    const result = await db
      .select({
        p50_ms: sql<
          number | null
        >`percentile_cont(0.5) within group (order by extract(epoch from (${deployments.recoveredAt} - ${deployments.completedAt})) * 1000)`,
        p90_ms: sql<
          number | null
        >`percentile_cont(0.9) within group (order by extract(epoch from (${deployments.recoveredAt} - ${deployments.completedAt})) * 1000)`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(deployments)
      .where(and(...conditions));

    const row = result[0];

    // Convert milliseconds to hours
    const p50_hours = row.p50_ms ? row.p50_ms / (1000 * 60 * 60) : null;
    const p90_hours = row.p90_ms ? row.p90_ms / (1000 * 60 * 60) : null;

    console.log(
      `[DORA Metrics] MTTR ${projectName || "Organization"} (${startDate.toISOString()} to ${endDate.toISOString()}): p50=${p50_hours?.toFixed(2)}h, p90=${p90_hours?.toFixed(2)}h, count=${row.count}`,
    );

    return {
      p50_hours,
      p90_hours,
      count: row.count,
    };
  } catch (error) {
    console.error("[DORA Metrics] Error calculating MTTR:", error);
    throw error;
  }
}

/**
 * Calculates MTTR by project for all projects within a time window.
 *
 * @param startDate - Start of time window (inclusive)
 * @param endDate - End of time window (inclusive)
 * @returns Map of project names to percentile metrics
 *
 * @example
 * const mttrs = await calculateMTTRByProject(
 *   new Date("2025-01-06T00:00:00Z"),
 *   new Date("2025-01-12T23:59:59Z")
 * );
 * // Returns: Map {
 * //   "project-a" => { p50_hours: 1.5, p90_hours: 4.0, count: 2 },
 * //   "project-b" => { p50_hours: 3.0, p90_hours: 8.0, count: 1 }
 * // }
 */
export async function calculateMTTRByProject(
  startDate: Date,
  endDate: Date,
): Promise<
  Map<
    string,
    { p50_hours: number | null; p90_hours: number | null; count: number }
  >
> {
  try {
    const result = await db
      .select({
        projectName: deployments.projectName,
        p50_ms: sql<
          number | null
        >`percentile_cont(0.5) within group (order by extract(epoch from (${deployments.recoveredAt} - ${deployments.completedAt})) * 1000)`,
        p90_ms: sql<
          number | null
        >`percentile_cont(0.9) within group (order by extract(epoch from (${deployments.recoveredAt} - ${deployments.completedAt})) * 1000)`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(deployments)
      .where(
        and(
          gte(deployments.startedAt, startDate),
          lte(deployments.startedAt, endDate),
          eq(deployments.environment, "production"),
          eq(deployments.isFailed, true),
          isNotNull(deployments.recoveredAt),
          isNotNull(deployments.completedAt),
        ),
      )
      .groupBy(deployments.projectName);

    const mttrs = new Map<
      string,
      { p50_hours: number | null; p90_hours: number | null; count: number }
    >();

    for (const row of result) {
      const p50_hours = row.p50_ms ? row.p50_ms / (1000 * 60 * 60) : null;
      const p90_hours = row.p90_ms ? row.p90_ms / (1000 * 60 * 60) : null;

      mttrs.set(row.projectName, {
        p50_hours,
        p90_hours,
        count: row.count,
      });

      console.log(
        `[DORA Metrics] MTTR ${row.projectName} (${startDate.toISOString()} to ${endDate.toISOString()}): p50=${p50_hours?.toFixed(2)}h, p90=${p90_hours?.toFixed(2)}h, count=${row.count}`,
      );
    }

    return mttrs;
  } catch (error) {
    console.error("[DORA Metrics] Error calculating MTTR by project:", error);
    throw error;
  }
}
