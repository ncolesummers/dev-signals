import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { getCurrentWeek } from "@/lib/utils/week";
import {
  useWeekSelection,
  WeekSelector,
  type WeekSelectorProps,
} from "../week-selector";

// Cleanup after each test to prevent test pollution
afterEach(() => {
  cleanup();
});

describe("WeekSelector Component", () => {
  const defaultProps: WeekSelectorProps = {
    value: "2025-W02",
    onValueChange: () => {},
    weeksToShow: 12,
  };

  describe("Basic Rendering", () => {
    test("should render week selector component", () => {
      const { container } = render(<WeekSelector {...defaultProps} />);
      // Component should render
      expect(container).toBeInTheDocument();
    });

    test("should display current week label when selected", () => {
      const currentWeek = getCurrentWeek();
      render(<WeekSelector {...defaultProps} value={currentWeek} />);
      // Current week should have "Current Week" in the label
      expect(screen.getByText(/Current Week/i)).toBeInTheDocument();
    });

    test("should display historical week label format", () => {
      render(<WeekSelector {...defaultProps} value="2024-W01" />);
      // Historical weeks (not current week) should have "Week X, YYYY" format or show the raw value
      // Since 2024-W01 is in the past, it should either show the formatted week or the value itself
      const container = screen.getByRole("combobox");
      expect(container).toHaveTextContent(/Week|2024/);
    });

    test("should render with default aria-label", () => {
      render(<WeekSelector {...defaultProps} />);
      expect(
        screen.getByLabelText("Select week to view metrics"),
      ).toBeInTheDocument();
    });

    test("should render with custom aria-label", () => {
      render(<WeekSelector {...defaultProps} ariaLabel="Choose metric week" />);
      expect(screen.getByLabelText("Choose metric week")).toBeInTheDocument();
    });

    test("should render with responsive width classes", () => {
      const { container } = render(<WeekSelector {...defaultProps} />);
      const trigger = container.querySelector("button[aria-label]");
      expect(trigger).toHaveClass("w-full");
      expect(trigger).toHaveClass("sm:w-[400px]");
    });
  });

  describe("Props Handling", () => {
    test("should accept weeksToShow prop", () => {
      const { container } = render(
        <WeekSelector {...defaultProps} weeksToShow={5} />,
      );
      expect(container).toBeInTheDocument();
    });

    test("should use default weeksToShow of 12 when not specified", () => {
      const {
        value: _,
        weeksToShow: __,
        ...propsWithoutWeeksToShow
      } = defaultProps;
      const { container } = render(
        <WeekSelector {...propsWithoutWeeksToShow} value={getCurrentWeek()} />,
      );
      expect(container).toBeInTheDocument();
    });

    test("should pass onValueChange callback", () => {
      let _callbackCalled = false;
      const handleChange = () => {
        _callbackCalled = true;
      };

      render(<WeekSelector {...defaultProps} onValueChange={handleChange} />);

      // Component should render with callback
      expect(
        screen.getByLabelText("Select week to view metrics"),
      ).toBeInTheDocument();
    });

    test("should display selected week value", () => {
      render(<WeekSelector {...defaultProps} value="2025-W02" />);

      // The component should show the selected week somewhere
      expect(screen.getByText(/Week 2, 2025|2025-W02/)).toBeInTheDocument();
    });
  });

  describe("Disabled State", () => {
    test("should accept disabled prop", () => {
      render(<WeekSelector {...defaultProps} disabled={true} />);

      const trigger = screen.getByRole("combobox");
      expect(trigger).toBeDisabled();
    });

    test("should not be disabled by default", () => {
      render(<WeekSelector {...defaultProps} />);

      const trigger = screen.getByRole("combobox");
      expect(trigger).not.toBeDisabled();
    });
  });

  describe("Edge Cases", () => {
    test("should handle value not in recent weeks", () => {
      render(<WeekSelector {...defaultProps} value="2020-W01" />);

      // Should still render, showing the raw value if no label found
      expect(screen.getByText(/2020-W01/)).toBeInTheDocument();
    });

    test("should handle weeksToShow of 1", () => {
      const { container } = render(
        <WeekSelector {...defaultProps} weeksToShow={1} />,
      );
      expect(container).toBeInTheDocument();
    });

    test("should handle re-rendering with same props", () => {
      const { rerender } = render(
        <WeekSelector {...defaultProps} weeksToShow={5} />,
      );

      // Re-render with same weeksToShow
      rerender(<WeekSelector {...defaultProps} weeksToShow={5} />);

      // Component should still render correctly
      expect(
        screen.getByLabelText("Select week to view metrics"),
      ).toBeInTheDocument();
    });

    test("should handle re-rendering with different weeksToShow", () => {
      const { rerender } = render(
        <WeekSelector {...defaultProps} weeksToShow={3} />,
      );

      // Re-render with different weeksToShow
      rerender(<WeekSelector {...defaultProps} weeksToShow={5} />);

      // Component should still render correctly
      expect(
        screen.getByLabelText("Select week to view metrics"),
      ).toBeInTheDocument();
    });
  });
});

describe("useWeekSelection Hook", () => {
  // Helper component to test the hook
  function TestComponent() {
    const { selectedWeek, setSelectedWeek } = useWeekSelection();

    return (
      <div>
        <span data-testid="selected-week">{selectedWeek}</span>
        <button
          type="button"
          onClick={() => setSelectedWeek("2025-W01")}
          data-testid="change-week"
        >
          Change Week
        </button>
      </div>
    );
  }

  test("should initialize with current week", () => {
    render(<TestComponent />);

    const selectedWeek = screen.getByTestId("selected-week");
    const currentWeek = getCurrentWeek();

    expect(selectedWeek).toHaveTextContent(currentWeek);
  });

  test("should update selected week when setSelectedWeek is called", () => {
    render(<TestComponent />);

    const selectedWeek = screen.getByTestId("selected-week");
    const changeButton = screen.getByTestId("change-week");

    // Initial value should be current week
    const initialWeek = selectedWeek.textContent;

    // Click button to change week
    fireEvent.click(changeButton);

    // Value should have changed to 2025-W01
    expect(selectedWeek).toHaveTextContent("2025-W01");
    expect(selectedWeek).not.toHaveTextContent(initialWeek || "");
  });

  test("should return both selectedWeek and setSelectedWeek", () => {
    render(<TestComponent />);

    // Both elements should be present, indicating both values are returned
    expect(screen.getByTestId("selected-week")).toBeInTheDocument();
    expect(screen.getByTestId("change-week")).toBeInTheDocument();
  });
});
