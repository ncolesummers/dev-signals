"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getCurrentWeek,
  getWeekBoundaries,
  getWeekIdentifier,
} from "@/lib/utils/week";

export interface WeekOption {
  /**
   * ISO 8601 week identifier (e.g., "2025-W02")
   */
  value: string;

  /**
   * Human-readable label (e.g., "Week 2, 2025 (Jan 6 - Jan 12)")
   */
  label: string;
}

export interface WeekSelectorProps {
  /**
   * Currently selected week (ISO 8601 format)
   */
  value: string;

  /**
   * Callback when week selection changes
   */
  onValueChange: (week: string) => void;

  /**
   * Number of weeks to show in the dropdown (default: 12)
   */
  weeksToShow?: number;

  /**
   * Whether the selector is disabled
   */
  disabled?: boolean;

  /**
   * Custom aria-label for accessibility
   */
  ariaLabel?: string;
}

/**
 * Generates a list of week options for the dropdown
 * @param count - Number of weeks to generate (including current week)
 * @returns Array of week options with value and label
 */
function generateWeekOptions(count: number): WeekOption[] {
  const options: WeekOption[] = [];
  const today = new Date();

  for (let i = 0; i < count; i++) {
    // Calculate date for this week (going backwards from today)
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() - i * 7);

    // Get week identifier
    const weekIdentifier = getWeekIdentifier(targetDate);

    // Get week boundaries for formatting
    const { startDate, endDate } = getWeekBoundaries(weekIdentifier);

    // Format dates for display
    const startMonth = startDate.toLocaleDateString("en-US", {
      month: "short",
    });
    const startDay = startDate.getDate();
    const endMonth = endDate.toLocaleDateString("en-US", { month: "short" });
    const endDay = endDate.getDate();

    // Extract week number and year from identifier
    const [year, weekPart] = weekIdentifier.split("-");
    const weekNumber = weekPart.replace("W", "");

    // Format label
    let label: string;
    if (i === 0) {
      // Current week
      label = `Current Week (${startMonth} ${startDay} - ${endMonth} ${endDay})`;
    } else {
      // Historical weeks
      label = `Week ${weekNumber}, ${year} (${startMonth} ${startDay} - ${endMonth} ${endDay})`;
    }

    options.push({
      value: weekIdentifier,
      label,
    });
  }

  return options;
}

/**
 * WeekSelector Component
 *
 * A dropdown selector for choosing weeks to view metrics for.
 * Displays the current week and previous historical weeks.
 *
 * @example
 * ```tsx
 * const [selectedWeek, setSelectedWeek] = useState(getCurrentWeek());
 *
 * <WeekSelector
 *   value={selectedWeek}
 *   onValueChange={setSelectedWeek}
 *   weeksToShow={12}
 * />
 * ```
 */
export function WeekSelector({
  value,
  onValueChange,
  weeksToShow = 12,
  disabled = false,
  ariaLabel = "Select week to view metrics",
}: WeekSelectorProps) {
  // Generate week options
  const weekOptions = React.useMemo(
    () => generateWeekOptions(weeksToShow),
    [weeksToShow],
  );

  // Find the label for the selected week
  const selectedLabel = React.useMemo(() => {
    const option = weekOptions.find((opt) => opt.value === value);
    return option?.label || value;
  }, [value, weekOptions]);

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className="w-full sm:w-[400px]" aria-label={ariaLabel}>
        <SelectValue placeholder="Select a week">{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {weekOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Hook to manage week selection state
 *
 * @example
 * ```tsx
 * const { selectedWeek, setSelectedWeek } = useWeekSelection();
 *
 * <WeekSelector value={selectedWeek} onValueChange={setSelectedWeek} />
 * ```
 */
export function useWeekSelection() {
  const [selectedWeek, setSelectedWeek] = React.useState(() =>
    getCurrentWeek(),
  );

  return {
    selectedWeek,
    setSelectedWeek,
  };
}
