import { describe, expect, test } from "bun:test";
import {
  getCurrentWeek,
  getWeekBoundaries,
  getWeekIdentifier,
  isValidWeekIdentifier,
} from "../week";

describe("Week Utilities", () => {
  describe("getWeekBoundaries", () => {
    test("should return correct boundaries for 2025-W02 (Jan 6-12)", () => {
      const { startDate, endDate } = getWeekBoundaries("2025-W02");

      // Week 2 of 2025 starts on Monday, January 6
      expect(startDate.toISOString()).toBe("2025-01-06T00:00:00.000Z");
      expect(endDate.toISOString()).toBe("2025-01-12T23:59:59.999Z");
    });

    test("should return correct boundaries for 2025-W01 (Dec 30, 2024 - Jan 5, 2025)", () => {
      const { startDate, endDate } = getWeekBoundaries("2025-W01");

      // Week 1 of 2025 starts on Monday, December 30, 2024
      expect(startDate.toISOString()).toBe("2024-12-30T00:00:00.000Z");
      expect(endDate.toISOString()).toBe("2025-01-05T23:59:59.999Z");
    });

    test("should return correct boundaries for 2024-W52 (Dec 23-29, 2024)", () => {
      const { startDate, endDate } = getWeekBoundaries("2024-W52");

      expect(startDate.toISOString()).toBe("2024-12-23T00:00:00.000Z");
      expect(endDate.toISOString()).toBe("2024-12-29T23:59:59.999Z");
    });

    test("should handle year with 53 weeks (2020-W53)", () => {
      const { startDate, endDate } = getWeekBoundaries("2020-W53");

      expect(startDate.toISOString()).toBe("2020-12-28T00:00:00.000Z");
      expect(endDate.toISOString()).toBe("2021-01-03T23:59:59.999Z");
    });

    test("should throw error for invalid format", () => {
      expect(() => getWeekBoundaries("invalid")).toThrow(
        "Invalid week identifier format",
      );
      expect(() => getWeekBoundaries("2025-W2")).toThrow(
        "Invalid week identifier format",
      );
      expect(() => getWeekBoundaries("2025W02")).toThrow(
        "Invalid week identifier format",
      );
      expect(() => getWeekBoundaries("25-W02")).toThrow(
        "Invalid week identifier format",
      );
    });

    test("should throw error for invalid week number", () => {
      expect(() => getWeekBoundaries("2025-W00")).toThrow(
        "Invalid week number",
      );
      expect(() => getWeekBoundaries("2025-W54")).toThrow(
        "Invalid week number",
      );
      expect(() => getWeekBoundaries("2025-W99")).toThrow(
        "Invalid week number",
      );
    });

    test("should ensure start is Monday at 00:00:00", () => {
      const { startDate } = getWeekBoundaries("2025-W10");

      expect(startDate.getUTCHours()).toBe(0);
      expect(startDate.getUTCMinutes()).toBe(0);
      expect(startDate.getUTCSeconds()).toBe(0);
      expect(startDate.getUTCMilliseconds()).toBe(0);

      // Monday is day 1
      expect(startDate.getUTCDay()).toBe(1);
    });

    test("should ensure end is Sunday at 23:59:59.999", () => {
      const { endDate } = getWeekBoundaries("2025-W10");

      expect(endDate.getUTCHours()).toBe(23);
      expect(endDate.getUTCMinutes()).toBe(59);
      expect(endDate.getUTCSeconds()).toBe(59);
      expect(endDate.getUTCMilliseconds()).toBe(999);

      // Sunday is day 0
      expect(endDate.getUTCDay()).toBe(0);
    });
  });

  describe("getWeekIdentifier", () => {
    test("should return correct identifier for date in 2025-W02", () => {
      const date = new Date("2025-01-10T12:00:00Z"); // Friday in week 2
      expect(getWeekIdentifier(date)).toBe("2025-W02");
    });

    test("should return correct identifier for date in 2025-W01", () => {
      const date = new Date("2025-01-03T12:00:00Z"); // Friday in week 1
      expect(getWeekIdentifier(date)).toBe("2025-W01");
    });

    test("should handle year boundary correctly (Dec 30, 2024 is in 2025-W01)", () => {
      const date = new Date("2024-12-30T12:00:00Z"); // Monday of 2025-W01
      expect(getWeekIdentifier(date)).toBe("2025-W01");
    });

    test("should handle year boundary correctly (Dec 29, 2024 is in 2024-W52)", () => {
      const date = new Date("2024-12-29T12:00:00Z"); // Sunday of 2024-W52
      expect(getWeekIdentifier(date)).toBe("2024-W52");
    });

    test("should pad week numbers with leading zero", () => {
      const date = new Date("2025-01-10T12:00:00Z");
      const identifier = getWeekIdentifier(date);
      expect(identifier).toMatch(/^\d{4}-W\d{2}$/);
    });

    test("should handle Monday correctly (first day of week)", () => {
      const monday = new Date("2025-01-06T00:00:00Z"); // Monday of W02
      expect(getWeekIdentifier(monday)).toBe("2025-W02");
    });

    test("should handle Sunday correctly (last day of week)", () => {
      const sunday = new Date("2025-01-12T23:59:59Z"); // Sunday of W02
      expect(getWeekIdentifier(sunday)).toBe("2025-W02");
    });
  });

  describe("getCurrentWeek", () => {
    test("should return a valid week identifier", () => {
      const currentWeek = getCurrentWeek();
      expect(currentWeek).toMatch(/^\d{4}-W\d{2}$/);
    });

    test("should return current week that can be parsed back", () => {
      const currentWeek = getCurrentWeek();
      expect(() => getWeekBoundaries(currentWeek)).not.toThrow();
    });

    test("should return week identifier for current date", () => {
      const currentWeek = getCurrentWeek();
      const now = new Date();
      const expectedWeek = getWeekIdentifier(now);
      expect(currentWeek).toBe(expectedWeek);
    });
  });

  describe("isValidWeekIdentifier", () => {
    test("should return true for valid identifiers", () => {
      expect(isValidWeekIdentifier("2025-W02")).toBe(true);
      expect(isValidWeekIdentifier("2025-W01")).toBe(true);
      expect(isValidWeekIdentifier("2025-W52")).toBe(true);
      expect(isValidWeekIdentifier("2020-W53")).toBe(true);
    });

    test("should return false for invalid formats", () => {
      expect(isValidWeekIdentifier("invalid")).toBe(false);
      expect(isValidWeekIdentifier("2025-W2")).toBe(false);
      expect(isValidWeekIdentifier("2025W02")).toBe(false);
      expect(isValidWeekIdentifier("25-W02")).toBe(false);
      expect(isValidWeekIdentifier("")).toBe(false);
    });

    test("should return false for invalid week numbers", () => {
      expect(isValidWeekIdentifier("2025-W00")).toBe(false);
      expect(isValidWeekIdentifier("2025-W54")).toBe(false);
      expect(isValidWeekIdentifier("2025-W99")).toBe(false);
    });
  });

  describe("Round-trip consistency", () => {
    test("should maintain consistency when converting date → identifier → boundaries", () => {
      const originalDate = new Date("2025-01-10T12:00:00Z");
      const identifier = getWeekIdentifier(originalDate);
      const { startDate, endDate } = getWeekBoundaries(identifier);

      // Original date should be within the returned boundaries
      expect(originalDate.getTime()).toBeGreaterThanOrEqual(
        startDate.getTime(),
      );
      expect(originalDate.getTime()).toBeLessThanOrEqual(endDate.getTime());
    });

    test("should maintain consistency for multiple weeks", () => {
      const testDates = [
        "2025-01-06T00:00:00Z", // Monday W02
        "2025-01-10T12:00:00Z", // Friday W02
        "2025-01-12T23:59:59Z", // Sunday W02
        "2024-12-30T00:00:00Z", // Monday W01 (year boundary)
      ];

      for (const dateStr of testDates) {
        const originalDate = new Date(dateStr);
        const identifier = getWeekIdentifier(originalDate);
        const { startDate, endDate } = getWeekBoundaries(identifier);

        expect(originalDate.getTime()).toBeGreaterThanOrEqual(
          startDate.getTime(),
        );
        expect(originalDate.getTime()).toBeLessThanOrEqual(endDate.getTime());
      }
    });
  });
});
