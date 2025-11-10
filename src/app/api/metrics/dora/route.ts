/**
 * Combined DORA Metrics API Endpoint
 * GET /api/metrics/dora
 *
 * Returns all four DORA (DevOps Research and Assessment) metrics in a single response:
 * - Deployment Frequency
 * - Lead Time for Changes
 * - Change Failure Rate (CFR)
 * - Mean Time to Recovery (MTTR)
 *
 * Query Parameters:
 * - week: Optional ISO 8601 week identifier (e.g., "2025-W02"). Defaults to current week.
 * - project: Optional project name filter. If omitted, returns all projects.
 * - allProjects: Optional boolean ("true"). Returns per-project breakdown.
 *
 * Response:
 * - Single project/org: {
 *     deploymentFrequency: { count },
 *     leadTime: { p50_hours, p90_hours, count },
 *     changeFailureRate: { percentage, failed_count, total_count },
 *     mttr: { p50_hours, p90_hours, count },
 *     week,
 *     startDate,
 *     endDate,
 *     project?
 *   }
 * - All projects: {
 *     projects: {
 *       [projectName]: {
 *         deploymentFrequency: { count },
 *         leadTime: { p50_hours, p90_hours, count },
 *         changeFailureRate: { percentage, failed_count, total_count },
 *         mttr: { p50_hours, p90_hours, count }
 *       }
 *     },
 *     week,
 *     startDate,
 *     endDate
 *   }
 *
 * Examples:
 * - GET /api/metrics/dora (current week, all projects)
 * - GET /api/metrics/dora?week=2025-W02 (specific week, all projects)
 * - GET /api/metrics/dora?week=2025-W02&project=my-project (specific week and project)
 * - GET /api/metrics/dora?week=2025-W02&allProjects=true (per-project breakdown)
 */

import { type NextRequest, NextResponse } from "next/server";
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
import {
  getCurrentWeek,
  getWeekBoundaries,
  isValidWeekIdentifier,
} from "@/lib/utils/week";

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const weekParam = searchParams.get("week");
    const projectParam = searchParams.get("project");
    const allProjectsParam = searchParams.get("allProjects");

    // Determine week to query (default to current week)
    const week = weekParam || getCurrentWeek();

    // Validate week format
    if (!isValidWeekIdentifier(week)) {
      return NextResponse.json(
        {
          error: "Invalid week format",
          details:
            'Week must be in ISO 8601 format (e.g., "2025-W02"). Use YYYY-Wnn where nn is the week number (01-53).',
          received: week,
        },
        { status: 400 },
      );
    }

    // Get week boundaries
    const { startDate, endDate } = getWeekBoundaries(week);

    // Handle per-project breakdown
    if (allProjectsParam === "true") {
      // Fetch all metrics in parallel
      const [
        deploymentFrequencyMap,
        leadTimeMap,
        changeFailureRateMap,
        mttrMap,
      ] = await Promise.all([
        calculateDeploymentFrequencyByProject(startDate, endDate),
        calculateLeadTimeForChangesByProject(startDate, endDate),
        calculateChangeFailureRateByProject(startDate, endDate),
        calculateMTTRByProject(startDate, endDate),
      ]);

      // Get all unique project names
      const projectNames = new Set([
        ...deploymentFrequencyMap.keys(),
        ...leadTimeMap.keys(),
        ...changeFailureRateMap.keys(),
        ...mttrMap.keys(),
      ]);

      // Combine metrics for each project
      const projects: Record<string, unknown> = {};
      for (const projectName of projectNames) {
        projects[projectName] = {
          deploymentFrequency: deploymentFrequencyMap.get(projectName) || {
            count: 0,
          },
          leadTime: leadTimeMap.get(projectName) || {
            p50_hours: null,
            p90_hours: null,
            count: 0,
          },
          changeFailureRate: changeFailureRateMap.get(projectName) || {
            percentage: 0,
            failed_count: 0,
            total_count: 0,
          },
          mttr: mttrMap.get(projectName) || {
            p50_hours: null,
            p90_hours: null,
            count: 0,
          },
        };
      }

      return NextResponse.json(
        {
          projects,
          week,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        { status: 200 },
      );
    }

    // Handle single project or organization-wide query
    // Fetch all metrics in parallel
    const [deploymentFrequency, leadTime, changeFailureRate, mttr] =
      await Promise.all([
        calculateDeploymentFrequency(
          startDate,
          endDate,
          projectParam || undefined,
        ),
        calculateLeadTimeForChanges(
          startDate,
          endDate,
          projectParam || undefined,
        ),
        calculateChangeFailureRate(
          startDate,
          endDate,
          projectParam || undefined,
        ),
        calculateMTTR(startDate, endDate, projectParam || undefined),
      ]);

    const response = {
      deploymentFrequency,
      leadTime,
      changeFailureRate,
      mttr,
      week,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      ...(projectParam && { project: projectParam }),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("[API] Error in combined DORA metrics endpoint:", error);

    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes("Invalid week")) {
        return NextResponse.json(
          { error: "Invalid week format", details: error.message },
          { status: 400 },
        );
      }
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
