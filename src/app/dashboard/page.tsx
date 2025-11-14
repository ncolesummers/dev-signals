"use client";

import * as React from "react";
import {
  MetricCard,
  type MetricStatus,
} from "@/components/dashboard/metric-card";
import {
  useWeekSelection,
  WeekSelector,
} from "@/components/dashboard/week-selector";

/**
 * DORA Metrics Response Type
 */
interface DoraMetricsResponse {
  deploymentFrequency: {
    count: number;
  };
  leadTime: {
    p50_hours: number | null;
    p90_hours: number | null;
    count: number;
  };
  changeFailureRate: {
    percentage: number;
    failed_count: number;
    total_count: number;
  };
  mttr: {
    p50_hours: number | null;
    p90_hours: number | null;
    count: number;
  };
  week: string;
  startDate: string;
  endDate: string;
  project?: string;
}

/**
 * Calculates status based on DORA target thresholds from METRICS_DEFINITIONS.md
 */
function calculateDeploymentFrequencyStatus(count: number): MetricStatus {
  if (count >= 5) return "success"; // Target: Daily (5+ per week)
  if (count >= 2) return "warning";
  return "critical";
}

function calculateLeadTimeStatus(p50_hours: number | null): MetricStatus {
  if (p50_hours === null) return "critical";
  if (p50_hours < 24) return "success"; // Target: <1 day
  if (p50_hours < 72) return "warning"; // <3 days
  return "critical";
}

function calculateChangeFailureRateStatus(percentage: number): MetricStatus {
  if (percentage < 15) return "success"; // Target: <15%
  if (percentage < 25) return "warning";
  return "critical";
}

function calculateMTTRStatus(p50_hours: number | null): MetricStatus {
  if (p50_hours === null) return "critical";
  if (p50_hours < 1) return "success"; // Target: <1 hour
  if (p50_hours < 4) return "warning";
  return "critical";
}

/**
 * Formats hours to human-readable string
 */
function formatHours(hours: number | null): string {
  if (hours === null) return "N/A";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

/**
 * Trend type for metric comparisons
 */
type Trend = "up" | "down" | "same";

/**
 * Calculates trend direction by comparing current to previous value
 * Returns undefined if previous data is not available
 */
function calculateTrend(
  current: number | null,
  previous: number | null,
  threshold = 0.05, // 5% threshold for "same"
): Trend | undefined {
  if (current === null || previous === null || previous === 0) {
    return undefined; // Not enough data to calculate trend
  }

  const percentChange = Math.abs((current - previous) / previous);

  if (percentChange < threshold) {
    return "same";
  }

  return current > previous ? "up" : "down";
}

/**
 * Gets the previous week identifier
 * e.g., "2025-W02" -> "2025-W01"
 */
function getPreviousWeek(week: string): string {
  const match = week.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return week;

  const year = Number.parseInt(match[1], 10);
  const weekNum = Number.parseInt(match[2], 10);

  if (weekNum === 1) {
    // Go to last week of previous year (assume 52 weeks)
    return `${year - 1}-W52`;
  }

  return `${year}-W${String(weekNum - 1).padStart(2, "0")}`;
}

/**
 * Dashboard Page Component
 *
 * Displays DORA metrics (Deployment Frequency, Lead Time, CFR, MTTR)
 * with week selection, trend indicators, and responsive card layout.
 */
export default function DashboardPage() {
  const { selectedWeek, setSelectedWeek } = useWeekSelection();
  const [metrics, setMetrics] = React.useState<DoraMetricsResponse | null>(
    null,
  );
  const [previousMetrics, setPreviousMetrics] =
    React.useState<DoraMetricsResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Fetch DORA metrics for current and previous week
  const fetchMetrics = React.useCallback(async (week: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const previousWeek = getPreviousWeek(week);

      // Fetch both current and previous week in parallel
      const [currentResponse, previousResponse] = await Promise.all([
        fetch(`/api/metrics/dora?week=${week}`),
        fetch(`/api/metrics/dora?week=${previousWeek}`),
      ]);

      if (!currentResponse.ok) {
        throw new Error(
          `Failed to fetch metrics: ${currentResponse.statusText}`,
        );
      }

      const currentData: DoraMetricsResponse = await currentResponse.json();
      setMetrics(currentData);

      // Previous week data is optional (might not exist for first week)
      if (previousResponse.ok) {
        const previousData: DoraMetricsResponse = await previousResponse.json();
        setPreviousMetrics(previousData);
      } else {
        setPreviousMetrics(null);
      }
    } catch (err) {
      console.error("Error fetching DORA metrics:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load metrics data",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch metrics when week changes
  React.useEffect(() => {
    fetchMetrics(selectedWeek);
  }, [selectedWeek, fetchMetrics]);

  // Retry handler
  const handleRetry = () => {
    fetchMetrics(selectedWeek);
  };

  // Calculate trends
  const deploymentFrequencyTrend = calculateTrend(
    metrics?.deploymentFrequency.count ?? null,
    previousMetrics?.deploymentFrequency.count ?? null,
  );

  const leadTimeTrend = calculateTrend(
    metrics?.leadTime.p50_hours ?? null,
    previousMetrics?.leadTime.p50_hours ?? null,
  );

  const changeFailureRateTrend = calculateTrend(
    metrics?.changeFailureRate.percentage ?? null,
    previousMetrics?.changeFailureRate.percentage ?? null,
  );

  const mttrTrend = calculateTrend(
    metrics?.mttr.p50_hours ?? null,
    previousMetrics?.mttr.p50_hours ?? null,
  );

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">
          DORA Metrics Dashboard
        </h1>
        <p className="text-muted-foreground">
          Track deployment frequency, lead time, change failure rate, and mean
          time to recovery
        </p>
      </div>

      {/* Week Selector */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <label htmlFor="week-selector" className="sr-only">
            Select week to view metrics
          </label>
          <WeekSelector
            value={selectedWeek}
            onValueChange={setSelectedWeek}
            ariaLabel="Select week to view DORA metrics"
          />
        </div>
      </div>

      {/* DORA Metrics Cards */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {/* Deployment Frequency */}
        <MetricCard
          name="Deployment Frequency"
          value={metrics?.deploymentFrequency.count ?? null}
          unit="deployments"
          description="Number of production deployments this week"
          status={
            metrics
              ? calculateDeploymentFrequencyStatus(
                  metrics.deploymentFrequency.count,
                )
              : "critical"
          }
          trend={deploymentFrequencyTrend}
          isLoading={isLoading}
          error={error || undefined}
          onRetry={handleRetry}
          ariaLabel="Deployment frequency metric card"
        />

        {/* Lead Time for Changes */}
        <MetricCard
          name="Lead Time for Changes"
          value={
            metrics?.leadTime.p50_hours !== null &&
            metrics?.leadTime.p50_hours !== undefined
              ? formatHours(metrics.leadTime.p50_hours)
              : null
          }
          unit="(median)"
          description="Time from PR creation to production deployment"
          status={
            metrics
              ? calculateLeadTimeStatus(metrics.leadTime.p50_hours)
              : "critical"
          }
          trend={leadTimeTrend}
          isLoading={isLoading}
          error={error || undefined}
          onRetry={handleRetry}
          ariaLabel="Lead time for changes metric card"
        />

        {/* Change Failure Rate */}
        <MetricCard
          name="Change Failure Rate"
          value={
            metrics
              ? `${metrics.changeFailureRate.percentage.toFixed(1)}`
              : null
          }
          unit="%"
          description="Percentage of deployments that fail or require rollback"
          status={
            metrics
              ? calculateChangeFailureRateStatus(
                  metrics.changeFailureRate.percentage,
                )
              : "critical"
          }
          trend={changeFailureRateTrend}
          isLoading={isLoading}
          error={error || undefined}
          onRetry={handleRetry}
          ariaLabel="Change failure rate metric card"
        />

        {/* Mean Time to Recovery */}
        <MetricCard
          name="Mean Time to Recovery"
          value={
            metrics?.mttr.p50_hours !== null &&
            metrics?.mttr.p50_hours !== undefined
              ? formatHours(metrics.mttr.p50_hours)
              : null
          }
          unit="(median)"
          description="Time to recover from failed deployments"
          status={
            metrics ? calculateMTTRStatus(metrics.mttr.p50_hours) : "critical"
          }
          trend={mttrTrend}
          isLoading={isLoading}
          error={error || undefined}
          onRetry={handleRetry}
          ariaLabel="Mean time to recovery metric card"
        />
      </div>

      {/* Footer Info */}
      {metrics && !isLoading && !error && (
        <div className="text-sm text-muted-foreground">
          <p>
            Showing metrics for {metrics.week} (
            {new Date(metrics.startDate).toLocaleDateString()} -{" "}
            {new Date(metrics.endDate).toLocaleDateString()})
          </p>
        </div>
      )}
    </div>
  );
}
