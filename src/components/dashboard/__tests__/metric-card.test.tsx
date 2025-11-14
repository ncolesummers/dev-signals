import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { MetricCard, type MetricCardProps } from "../metric-card";

// Cleanup after each test to prevent test pollution
afterEach(() => {
  cleanup();
});

describe("MetricCard Component", () => {
  const defaultProps: MetricCardProps = {
    name: "Deployment Frequency",
    value: 7,
    unit: "deployments",
    status: "success",
  };

  describe("Basic Rendering", () => {
    test("should render metric name correctly", () => {
      render(<MetricCard {...defaultProps} />);
      expect(screen.getByText("Deployment Frequency")).toBeInTheDocument();
    });

    test("should render metric value correctly", () => {
      render(<MetricCard {...defaultProps} />);
      expect(screen.getByText("7")).toBeInTheDocument();
    });

    test("should render unit correctly", () => {
      render(<MetricCard {...defaultProps} />);
      expect(screen.getByText("deployments")).toBeInTheDocument();
    });

    test("should render description when provided", () => {
      render(
        <MetricCard
          {...defaultProps}
          description="Number of production deployments this week"
        />,
      );
      expect(
        screen.getByText("Number of production deployments this week"),
      ).toBeInTheDocument();
    });

    test("should not render description when not provided", () => {
      const { container } = render(<MetricCard {...defaultProps} />);
      const descriptions = container.querySelectorAll(
        '[class*="CardDescription"]',
      );
      expect(descriptions.length).toBe(0);
    });

    test("should render N/A when value is null", () => {
      render(<MetricCard {...defaultProps} value={null} />);
      expect(screen.getByText("N/A")).toBeInTheDocument();
    });

    test("should render N/A when value is undefined", () => {
      render(<MetricCard {...defaultProps} value={undefined} />);
      expect(screen.getByText("N/A")).toBeInTheDocument();
    });
  });

  describe("Status Badge", () => {
    test("should render success badge with correct label", () => {
      render(<MetricCard {...defaultProps} status="success" />);
      expect(screen.getByText("On Target")).toBeInTheDocument();
    });

    test("should render warning badge with correct label", () => {
      render(<MetricCard {...defaultProps} status="warning" />);
      expect(screen.getByText("Needs Attention")).toBeInTheDocument();
    });

    test("should render critical badge with correct label", () => {
      render(<MetricCard {...defaultProps} status="critical" />);
      expect(screen.getByText("Off Target")).toBeInTheDocument();
    });

    test("should have correct aria-label for success status", () => {
      render(<MetricCard {...defaultProps} status="success" />);
      expect(screen.getByLabelText("Status: On Target")).toBeInTheDocument();
    });

    test("should have correct aria-label for warning status", () => {
      render(<MetricCard {...defaultProps} status="warning" />);
      expect(
        screen.getByLabelText("Status: Needs Attention"),
      ).toBeInTheDocument();
    });

    test("should have correct aria-label for critical status", () => {
      render(<MetricCard {...defaultProps} status="critical" />);
      expect(screen.getByLabelText("Status: Off Target")).toBeInTheDocument();
    });

    test("should not render badge when loading", () => {
      render(<MetricCard {...defaultProps} isLoading={true} />);
      expect(screen.queryByText("On Target")).not.toBeInTheDocument();
    });

    test("should not render badge when error", () => {
      render(
        <MetricCard {...defaultProps} error="Failed to load metric data" />,
      );
      expect(screen.queryByText("On Target")).not.toBeInTheDocument();
    });
  });

  describe("Trend Indicators", () => {
    test("should render up trend indicator with correct aria-label", () => {
      render(<MetricCard {...defaultProps} trend="up" />);
      expect(screen.getByLabelText("Trend: up")).toBeInTheDocument();
      expect(screen.getByText("Trending up")).toBeInTheDocument();
    });

    test("should render down trend indicator with correct aria-label", () => {
      render(<MetricCard {...defaultProps} trend="down" />);
      expect(screen.getByLabelText("Trend: down")).toBeInTheDocument();
      expect(screen.getByText("Trending down")).toBeInTheDocument();
    });

    test("should render same trend indicator with correct aria-label", () => {
      render(<MetricCard {...defaultProps} trend="same" />);
      expect(screen.getByLabelText("Trend: same")).toBeInTheDocument();
      expect(screen.getByText("No change")).toBeInTheDocument();
    });

    test("should not render trend indicator when not provided", () => {
      render(<MetricCard {...defaultProps} />);
      expect(screen.queryByLabelText(/Trend:/)).not.toBeInTheDocument();
    });

    test("should not render trend indicator when loading", () => {
      render(<MetricCard {...defaultProps} trend="up" isLoading={true} />);
      expect(screen.queryByLabelText("Trend: up")).not.toBeInTheDocument();
    });

    test("should not render trend indicator when error", () => {
      render(
        <MetricCard
          {...defaultProps}
          trend="up"
          error="Failed to load metric data"
        />,
      );
      expect(screen.queryByLabelText("Trend: up")).not.toBeInTheDocument();
    });
  });

  describe("Loading State", () => {
    test("should render loading spinner when isLoading is true", () => {
      render(<MetricCard {...defaultProps} isLoading={true} />);
      expect(screen.getByLabelText("Loading metric data")).toBeInTheDocument();
    });

    test("should not render value when loading", () => {
      render(<MetricCard {...defaultProps} isLoading={true} />);
      expect(screen.queryByText("7")).not.toBeInTheDocument();
    });

    test("should not render badge when loading", () => {
      render(<MetricCard {...defaultProps} isLoading={true} />);
      expect(screen.queryByText("On Target")).not.toBeInTheDocument();
    });

    test("should have correct role for loading spinner", () => {
      render(<MetricCard {...defaultProps} isLoading={true} />);
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });

  describe("Error State", () => {
    test("should render error message when error is provided", () => {
      render(
        <MetricCard {...defaultProps} error="Failed to load metric data" />,
      );
      expect(
        screen.getByText("Failed to load metric data"),
      ).toBeInTheDocument();
    });

    test("should have alert role for error message", () => {
      render(
        <MetricCard {...defaultProps} error="Failed to load metric data" />,
      );
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    test("should render retry button when error and onRetry are provided", () => {
      const mockRetry = () => {};
      render(
        <MetricCard
          {...defaultProps}
          error="Failed to load metric data"
          onRetry={mockRetry}
        />,
      );
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });

    test("should not render retry button when error but no onRetry", () => {
      render(
        <MetricCard {...defaultProps} error="Failed to load metric data" />,
      );
      expect(screen.queryByText("Retry")).not.toBeInTheDocument();
    });

    test("should call onRetry when retry button is clicked", async () => {
      let retryClicked = false;
      const mockRetry = () => {
        retryClicked = true;
      };

      render(
        <MetricCard
          {...defaultProps}
          error="Failed to load metric data"
          onRetry={mockRetry}
        />,
      );

      const retryButton = screen.getByText("Retry");
      await userEvent.click(retryButton);

      expect(retryClicked).toBe(true);
    });

    test("should have correct aria-label for retry button", () => {
      const mockRetry = () => {};
      render(
        <MetricCard
          {...defaultProps}
          error="Failed to load metric data"
          onRetry={mockRetry}
        />,
      );
      expect(screen.getByLabelText("Retry loading metric")).toBeInTheDocument();
    });

    test("should not render value when error", () => {
      render(
        <MetricCard {...defaultProps} error="Failed to load metric data" />,
      );
      expect(screen.queryByText("7")).not.toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    test("should have default aria-label for card", () => {
      render(<MetricCard {...defaultProps} />);
      expect(
        screen.getByLabelText("Deployment Frequency metric card"),
      ).toBeInTheDocument();
    });

    test("should use custom aria-label when provided", () => {
      render(
        <MetricCard {...defaultProps} ariaLabel="Custom deployment metric" />,
      );
      expect(
        screen.getByLabelText("Custom deployment metric"),
      ).toBeInTheDocument();
    });

    test("should have role='article' for card element", () => {
      const { container } = render(<MetricCard {...defaultProps} />);
      const article = container.querySelector('[role="article"]');
      expect(article).toBeInTheDocument();
    });

    test("should have aria-label for metric value", () => {
      render(<MetricCard {...defaultProps} />);
      expect(screen.getByLabelText("Value: 7 deployments")).toBeInTheDocument();
    });

    test("should have aria-label for metric value without unit", () => {
      render(<MetricCard {...defaultProps} unit={undefined} />);
      expect(screen.getByLabelText("Value: 7")).toBeInTheDocument();
    });

    test("should have screen reader text for trend indicators", () => {
      render(<MetricCard {...defaultProps} trend="up" />);
      expect(screen.getByText("Trending up")).toBeInTheDocument();
    });

    test("should have aria-hidden on trend icon", () => {
      const { container } = render(<MetricCard {...defaultProps} trend="up" />);
      const trendIcon = container.querySelector('svg[aria-hidden="true"]');
      expect(trendIcon).toBeInTheDocument();
    });
  });

  describe("Different Metric Types", () => {
    test("should render percentage metric correctly", () => {
      render(
        <MetricCard
          name="Change Failure Rate"
          value={12.5}
          unit="%"
          status="success"
        />,
      );
      expect(screen.getByText("12.5")).toBeInTheDocument();
      expect(screen.getByText("%")).toBeInTheDocument();
    });

    test("should render time metric correctly", () => {
      render(
        <MetricCard
          name="Mean Time to Recovery"
          value={2.3}
          unit="hours"
          status="warning"
        />,
      );
      expect(screen.getByText("2.3")).toBeInTheDocument();
      expect(screen.getByText("hours")).toBeInTheDocument();
    });

    test("should render count metric correctly", () => {
      render(
        <MetricCard
          name="Deployment Frequency"
          value={15}
          unit="deployments"
          status="success"
        />,
      );
      expect(screen.getByText("15")).toBeInTheDocument();
      expect(screen.getByText("deployments")).toBeInTheDocument();
    });

    test("should render string value correctly", () => {
      render(
        <MetricCard
          name="Lead Time"
          value="24.5"
          unit="hours"
          status="success"
        />,
      );
      expect(screen.getByText("24.5")).toBeInTheDocument();
      expect(screen.getByText("hours")).toBeInTheDocument();
    });

    test("should render zero value correctly", () => {
      render(
        <MetricCard
          name="Deployment Frequency"
          value={0}
          unit="deployments"
          status="critical"
        />,
      );
      expect(screen.getByText("0")).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    test("should handle very long metric names gracefully", () => {
      const longName =
        "Very Long Metric Name That Should Be Handled Properly Without Breaking Layout";
      render(<MetricCard {...defaultProps} name={longName} />);
      expect(screen.getByText(longName)).toBeInTheDocument();
    });

    test("should handle very long descriptions gracefully", () => {
      const longDescription =
        "This is a very long description that provides extensive details about what this metric measures and why it's important for team performance.";
      render(<MetricCard {...defaultProps} description={longDescription} />);
      expect(screen.getByText(longDescription)).toBeInTheDocument();
    });

    test("should handle very large numeric values", () => {
      render(<MetricCard {...defaultProps} value={9999999} />);
      expect(screen.getByText("9999999")).toBeInTheDocument();
    });

    test("should handle negative values", () => {
      render(<MetricCard {...defaultProps} value={-5} />);
      expect(screen.getByText("-5")).toBeInTheDocument();
    });

    test("should handle decimal values with many digits", () => {
      render(<MetricCard {...defaultProps} value={Math.PI} />);
      expect(screen.getByText(Math.PI.toString())).toBeInTheDocument();
    });

    test("should handle empty string error message as no error", () => {
      render(<MetricCard {...defaultProps} error="" />);
      // Empty error string is falsy, so component renders normally
      expect(screen.getByText("7")).toBeInTheDocument();
      expect(screen.getByText("deployments")).toBeInTheDocument();
      expect(screen.getByText("On Target")).toBeInTheDocument();
    });

    test("should prioritize loading state over error state", () => {
      render(
        <MetricCard
          {...defaultProps}
          isLoading={true}
          error="Failed to load metric"
        />,
      );
      // Loading spinner should be displayed (loading takes priority)
      expect(screen.getByLabelText("Loading metric data")).toBeInTheDocument();
      // Error should not be displayed when loading
      expect(
        screen.queryByText("Failed to load metric"),
      ).not.toBeInTheDocument();
    });
  });
});
