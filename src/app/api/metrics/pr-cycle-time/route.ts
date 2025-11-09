/**
 * PR Cycle Time API Endpoint
 * GET /api/metrics/pr-cycle-time
 *
 * Calculates median (p50) and 90th percentile (p90) PR cycle time for a given week.
 * Cycle time is measured from PR creation to merge, excluding draft PRs.
 *
 * Query Parameters:
 * - week: Optional ISO 8601 week identifier (e.g., "2025-W02"). Defaults to current week.
 * - project: Optional project name filter. If omitted, returns all projects.
 * - allProjects: Optional boolean ("true"). Returns per-project breakdown.
 *
 * Response:
 * - Single project/org: { p50_hours, p90_hours, count, week, project? }
 * - All projects: { projects: { [projectName]: { p50_hours, p90_hours, count } }, week }
 *
 * Examples:
 * - GET /api/metrics/pr-cycle-time (current week, all projects)
 * - GET /api/metrics/pr-cycle-time?week=2025-W02 (specific week, all projects)
 * - GET /api/metrics/pr-cycle-time?week=2025-W02&project=my-project (specific week and project)
 * - GET /api/metrics/pr-cycle-time?week=2025-W02&allProjects=true (per-project breakdown)
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  calculatePRCycleTime,
  calculatePRCycleTimeByProject,
} from "@/lib/metrics/pr-metrics";
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
      const projectMetrics = await calculatePRCycleTimeByProject(
        startDate,
        endDate,
      );

      // Convert Map to object for JSON serialization
      const projects: Record<string, unknown> = {};
      for (const [projectName, metrics] of projectMetrics.entries()) {
        projects[projectName] = metrics;
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
    const metrics = await calculatePRCycleTime(
      startDate,
      endDate,
      projectParam || undefined,
    );

    const response = {
      ...metrics,
      week,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      ...(projectParam && { project: projectParam }),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("[API] Error in PR cycle time endpoint:", error);

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
