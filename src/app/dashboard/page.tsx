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
 * Dashboard Page Component
 *
 * Displays DORA metrics (Deployment Frequency, Lead Time, CFR, MTTR)
 * with week selection and responsive card layout.
 */
export default function DashboardPage() {
  const { selectedWeek, setSelectedWeek } = useWeekSelection();
  const [metrics, setMetrics] = React.useState<DoraMetricsResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Fetch DORA metrics
  const fetchMetrics = React.useCallback(async (week: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/metrics/dora?week=${week}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch metrics: ${response.statusText}`);
      }

      const data: DoraMetricsResponse = await response.json();
      setMetrics(data);
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
