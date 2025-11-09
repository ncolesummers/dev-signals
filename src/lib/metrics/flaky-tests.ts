import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ciRuns } from "@/lib/db/schema";

/**
 * Flaky Test Metrics Calculation Module
 *
 * Calculates flaky test rate metrics from CI run data
 * - Flaky Test Rate: percentage of CI runs flagged as flaky
 * - Supports time window filtering
 * - Supports per-project or organization-wide aggregation
 * - Uses medians and percentiles per CLAUDE.md guidelines
 */

// ============================================================================
// Flaky Test Rate Calculation
// ============================================================================

/**
 * Calculate flaky test rate over a time window
 * Returns percentage: (flaky runs / total runs) * 100
 *
 * @param startDate - Start of time window
 * @param endDate - End of time window
 * @param projectName - Optional project filter (omit for organization-wide)
 * @returns Flaky test rate as percentage (0-100)
 */
export async function calculateFlakyTestRate(
  startDate: Date,
  endDate: Date,
  projectName?: string,
): Promise<number> {
  try {
    // Build where conditions
    const conditions = [
      gte(ciRuns.startedAt, startDate),
      lte(ciRuns.startedAt, endDate),
    ];

    // Add project filter if specified
    if (projectName) {
      conditions.push(eq(ciRuns.projectName, projectName));
    }

    // Query for total runs and flaky runs
    const result = await db
      .select({
        totalRuns: sql<number>`cast(count(*) as integer)`,
        flakyRuns: sql<number>`cast(sum(case when ${ciRuns.isFlaky} = true then 1 else 0 end) as integer)`,
      })
      .from(ciRuns)
      .where(and(...conditions));

    if (!result || result.length === 0 || result[0].totalRuns === 0) {
      return 0;
    }

    const { totalRuns, flakyRuns } = result[0];

    // Calculate percentage
    const flakyRate = (flakyRuns / totalRuns) * 100;

    console.log(
      `[Flaky Metrics] ${projectName || "Organization"} (${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}): ${flakyRuns}/${totalRuns} flaky (${flakyRate.toFixed(2)}%)`,
    );

    return Math.round(flakyRate * 100) / 100; // Round to 2 decimal places
  } catch (error) {
    console.error(`[Flaky Metrics] Error calculating flaky test rate:`, error);
    throw error;
  }
}

/**
 * Calculate flaky test rate by project
 * Returns a map of projectName -> flaky test rate percentage
 *
 * @param startDate - Start of time window
 * @param endDate - End of time window
 * @returns Map of project names to flaky test rates
 */
export async function calculateFlakyTestRateByProject(
  startDate: Date,
  endDate: Date,
): Promise<Map<string, number>> {
  try {
    // Query for runs grouped by project
    const result = await db
      .select({
        projectName: ciRuns.projectName,
        totalRuns: sql<number>`cast(count(*) as integer)`,
        flakyRuns: sql<number>`cast(sum(case when ${ciRuns.isFlaky} = true then 1 else 0 end) as integer)`,
      })
      .from(ciRuns)
      .where(
        and(gte(ciRuns.startedAt, startDate), lte(ciRuns.startedAt, endDate)),
      )
      .groupBy(ciRuns.projectName);

    const rates = new Map<string, number>();

    for (const row of result) {
      if (row.totalRuns === 0) {
        rates.set(row.projectName, 0);
      } else {
        const flakyRate = (row.flakyRuns / row.totalRuns) * 100;
        rates.set(row.projectName, Math.round(flakyRate * 100) / 100);
      }
    }

    console.log(
      `[Flaky Metrics] Calculated flaky rates for ${rates.size} projects`,
    );

    return rates;
  } catch (error) {
    console.error(
      `[Flaky Metrics] Error calculating flaky test rate by project:`,
      error,
    );
    throw error;
  }
}

/**
 * Get total count of flaky runs in a time window
 *
 * @param startDate - Start of time window
 * @param endDate - End of time window
 * @param projectName - Optional project filter
 * @returns Number of flaky runs
 */
export async function getFlakyRunCount(
  startDate: Date,
  endDate: Date,
  projectName?: string,
): Promise<number> {
  try {
    const conditions = [
      gte(ciRuns.startedAt, startDate),
      lte(ciRuns.startedAt, endDate),
      eq(ciRuns.isFlaky, true),
    ];

    if (projectName) {
      conditions.push(eq(ciRuns.projectName, projectName));
    }

    const result = await db
      .select({
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(ciRuns)
      .where(and(...conditions));

    return result[0]?.count || 0;
  } catch (error) {
    console.error(`[Flaky Metrics] Error getting flaky run count:`, error);
    throw error;
  }
}

/**
 * Get CI success rate (inverse of flaky + failure rate)
 *
 * @param startDate - Start of time window
 * @param endDate - End of time window
 * @param projectName - Optional project filter
 * @returns CI success rate as percentage (0-100)
 */
export async function getCISuccessRate(
  startDate: Date,
  endDate: Date,
  projectName?: string,
): Promise<number> {
  try {
    const conditions = [
      gte(ciRuns.startedAt, startDate),
      lte(ciRuns.startedAt, endDate),
    ];

    if (projectName) {
      conditions.push(eq(ciRuns.projectName, projectName));
    }

    const result = await db
      .select({
        totalRuns: sql<number>`cast(count(*) as integer)`,
        successRuns: sql<number>`cast(sum(case when ${ciRuns.conclusion} = 'success' then 1 else 0 end) as integer)`,
      })
      .from(ciRuns)
      .where(and(...conditions));

    if (!result || result.length === 0 || result[0].totalRuns === 0) {
      return 0;
    }

    const { totalRuns, successRuns } = result[0];
    const successRate = (successRuns / totalRuns) * 100;

    return Math.round(successRate * 100) / 100;
  } catch (error) {
    console.error(`[Flaky Metrics] Error calculating CI success rate:`, error);
    throw error;
  }
}
