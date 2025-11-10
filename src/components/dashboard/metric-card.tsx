"use client";

import { AlertCircle, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type MetricStatus = "success" | "warning" | "critical";

export interface MetricCardProps {
  /**
   * The name of the metric (e.g., "Deployment Frequency")
   */
  name: string;

  /**
   * The metric value to display
   */
  value: string | number | null;

  /**
   * Unit of measurement (e.g., "deployments", "hours", "%")
   */
  unit?: string;

  /**
   * Optional description of the metric
   */
  description?: string;

  /**
   * Status indicator for color coding
   * - success: Green (on target)
   * - warning: Yellow (needs attention)
   * - critical: Red (off target)
   */
  status: MetricStatus;

  /**
   * Trend direction compared to previous period
   * - "up": Metric increased
   * - "down": Metric decreased
   * - "same": No significant change
   */
  trend?: "up" | "down" | "same";

  /**
   * Whether the metric is currently loading
   */
  isLoading?: boolean;

  /**
   * Error message if metric failed to load
   */
  error?: string;

  /**
   * Callback for retry button when error occurs
   */
  onRetry?: () => void;

  /**
   * Additional aria-label for accessibility
   */
  ariaLabel?: string;
}

/**
 * MetricCard Component
 *
 * Displays a DORA or flow metric with:
 * - Metric name and value
 * - Color-coded status badge (green/yellow/red)
 * - Trend indicator (up/down/same)
 * - Loading and error states
 * - Accessibility support
 *
 * @example
 * ```tsx
 * <MetricCard
 *   name="Deployment Frequency"
 *   value={7}
 *   unit="deployments"
 *   status="success"
 *   trend="up"
 *   description="Number of production deployments this week"
 * />
 * ```
 */
export function MetricCard({
  name,
  value,
  unit,
  description,
  status,
  trend,
  isLoading = false,
  error,
  onRetry,
  ariaLabel,
}: MetricCardProps) {
  // Status badge variants
  const statusConfig = {
    success: {
      variant: "default" as const,
      label: "On Target",
      className: "bg-green-500 hover:bg-green-600 text-white border-green-500",
    },
    warning: {
      variant: "secondary" as const,
      label: "Needs Attention",
      className:
        "bg-yellow-500 hover:bg-yellow-600 text-white border-yellow-500",
    },
    critical: {
      variant: "destructive" as const,
      label: "Off Target",
      className: "bg-red-500 hover:bg-red-600 text-white border-red-500",
    },
  };

  // Trend icon components
  const trendIcons = {
    up: TrendingUp,
    down: TrendingDown,
    same: Minus,
  };

  const TrendIcon = trend ? trendIcons[trend] : null;

  // Format value for display
  const formattedValue =
    value !== null && value !== undefined ? String(value) : "N/A";

  return (
    // biome-ignore lint/a11y/useSemanticElements: Card component requires role="article" for proper accessibility
    <Card
      className="w-full"
      aria-label={ariaLabel || `${name} metric card`}
      role="article"
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg">{name}</CardTitle>
            {description && (
              <CardDescription className="mt-1">{description}</CardDescription>
            )}
          </div>
          {!isLoading && !error && (
            <Badge
              variant={statusConfig[status].variant}
              className={statusConfig[status].className}
              aria-label={`Status: ${statusConfig[status].label}`}
            >
              {statusConfig[status].label}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            {/* biome-ignore lint/a11y/useSemanticElements: Custom spinner styling requires div */}
            <div
              className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
              role="status"
              aria-label="Loading metric data"
            />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center space-y-4 py-8">
            <AlertCircle
              className="h-12 w-12 text-destructive"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground" role="alert">
              {error}
            </p>
            {onRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                aria-label="Retry loading metric"
              >
                Retry
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline space-x-2">
              {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label provides screen reader context for metric value */}
              <span
                className="text-4xl font-bold"
                aria-label={`Value: ${formattedValue}${unit ? ` ${unit}` : ""}`}
              >
                {formattedValue}
              </span>
              {unit && (
                <span className="text-lg text-muted-foreground">{unit}</span>
              )}
            </div>

            {TrendIcon && (
              // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label provides screen reader context for trend direction
              <div
                className={cn("flex items-center space-x-1", {
                  "text-green-600": trend === "up",
                  "text-red-600": trend === "down",
                  "text-gray-600": trend === "same",
                })}
                aria-label={`Trend: ${trend}`}
              >
                <TrendIcon className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">
                  {trend === "up" && "Trending up"}
                  {trend === "down" && "Trending down"}
                  {trend === "same" && "No change"}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
