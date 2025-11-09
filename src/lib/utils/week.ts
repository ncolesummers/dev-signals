/**
 * Week utilities for calculating week boundaries and identifiers.
 * Uses ISO 8601 week numbering with Monday as the start of the week.
 */

export interface WeekBoundaries {
  startDate: Date;
  endDate: Date;
}

/**
 * Parses a week identifier in ISO 8601 format (e.g., "2025-W02") and returns
 * the week boundaries (Monday 00:00:00 UTC to Sunday 23:59:59.999 UTC).
 *
 * @param weekIdentifier - Week identifier in "YYYY-Wnn" format
 * @returns Week boundaries with startDate (Monday) and endDate (Sunday)
 * @throws Error if week identifier format is invalid
 *
 * @example
 * getWeekBoundaries("2025-W02")
 * // Returns: { startDate: 2025-01-06T00:00:00.000Z, endDate: 2025-01-12T23:59:59.999Z }
 */
export function getWeekBoundaries(weekIdentifier: string): WeekBoundaries {
  const weekPattern = /^(\d{4})-W(\d{2})$/;
  const match = weekIdentifier.match(weekPattern);

  if (!match) {
    throw new Error(
      `Invalid week identifier format: ${weekIdentifier}. Expected format: YYYY-Wnn (e.g., "2025-W02")`,
    );
  }

  const year = Number.parseInt(match[1], 10);
  const week = Number.parseInt(match[2], 10);

  if (week < 1 || week > 53) {
    throw new Error(
      `Invalid week number: ${week}. Week number must be between 1 and 53.`,
    );
  }

  // Calculate the Monday of the given ISO week
  const jan4 = new Date(Date.UTC(year, 0, 4)); // January 4th is always in week 1
  const jan4DayOfWeek = jan4.getUTCDay() || 7; // Convert Sunday (0) to 7
  const mondayOfWeek1 = new Date(jan4);
  mondayOfWeek1.setUTCDate(jan4.getUTCDate() - jan4DayOfWeek + 1);

  // Calculate the Monday of the target week
  const startDate = new Date(mondayOfWeek1);
  startDate.setUTCDate(mondayOfWeek1.getUTCDate() + (week - 1) * 7);
  startDate.setUTCHours(0, 0, 0, 0);

  // Calculate the Sunday of the target week (6 days after Monday)
  const endDate = new Date(startDate);
  endDate.setUTCDate(startDate.getUTCDate() + 6);
  endDate.setUTCHours(23, 59, 59, 999);

  return { startDate, endDate };
}

/**
 * Returns the current week identifier in ISO 8601 format (e.g., "2025-W02").
 *
 * @returns Current week identifier in "YYYY-Wnn" format
 *
 * @example
 * getCurrentWeek()
 * // Returns: "2025-W02" (if current date is in week 2 of 2025)
 */
export function getCurrentWeek(): string {
  const now = new Date();
  return getWeekIdentifier(now);
}

/**
 * Calculates the ISO 8601 week identifier for a given date.
 *
 * @param date - Date to calculate week identifier for
 * @returns Week identifier in "YYYY-Wnn" format
 *
 * @example
 * getWeekIdentifier(new Date("2025-01-10"))
 * // Returns: "2025-W02"
 */
export function getWeekIdentifier(date: Date): string {
  // Copy date to avoid mutation
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );

  // Set to nearest Thursday (current date + 4 - current day number)
  // This ensures we get the correct year for the week
  const dayNum = d.getUTCDay() || 7; // Convert Sunday (0) to 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);

  // Get year of the Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));

  // Calculate week number
  const weekNumber = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );

  return `${d.getUTCFullYear()}-W${weekNumber.toString().padStart(2, "0")}`;
}

/**
 * Validates if a string is a valid week identifier format.
 *
 * @param weekIdentifier - String to validate
 * @returns true if valid, false otherwise
 *
 * @example
 * isValidWeekIdentifier("2025-W02") // true
 * isValidWeekIdentifier("2025-W99") // false
 * isValidWeekIdentifier("invalid")  // false
 */
export function isValidWeekIdentifier(weekIdentifier: string): boolean {
  try {
    getWeekBoundaries(weekIdentifier);
    return true;
  } catch {
    return false;
  }
}
