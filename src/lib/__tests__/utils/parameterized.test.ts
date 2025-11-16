/**
 * Unit tests for parameterized testing utilities
 */

import { describe, expect, test } from "bun:test";
import { boundaryTestCases, isDefined } from "./parameterized";

describe("Parameterized Testing Utilities", () => {
  describe("isDefined", () => {
    test("should return true for defined values", () => {
      expect(isDefined(0)).toBe(true);
      expect(isDefined("")).toBe(true);
      expect(isDefined(false)).toBe(true);
      expect(isDefined([])).toBe(true);
      expect(isDefined({})).toBe(true);
    });

    test("should return false for null or undefined", () => {
      expect(isDefined(null)).toBe(false);
      expect(isDefined(undefined)).toBe(false);
    });
  });

  describe("boundaryTestCases", () => {
    test("should create test cases with labels", () => {
      const cases = boundaryTestCases([
        [0, "xs"],
        [50, "xs"],
        [51, "s"],
      ]);

      expect(cases).toEqual([
        { value: 0, expected: "xs", label: "0 (boundary)" },
        { value: 50, expected: "xs", label: "50 (boundary)" },
        { value: 51, expected: "s", label: "51 (boundary)" },
      ]);
    });

    test("should work with different types", () => {
      const cases = boundaryTestCases([
        ["active", "open"],
        ["completed", "merged"],
      ]);

      expect(cases[0]).toEqual({
        value: "active",
        expected: "open",
        label: "active (boundary)",
      });
    });
  });

  // Example of using Bun's native describe.each for parameterized tests
  describe("Parameterized test examples", () => {
    describe.each([
      { input: 1, expected: 2 },
      { input: 2, expected: 4 },
      { input: 3, expected: 6 },
    ])("multiply by 2", ({ input, expected }) => {
      test(`${input} * 2 = ${expected}`, () => {
        expect(input * 2).toBe(expected);
      });
    });

    describe.each([
      { status: 1, state: "open" },
      { status: 2, state: "merged" },
      { status: 3, state: "closed" },
    ])("status mapping", ({ status, state }) => {
      test(`status ${status} maps to ${state}`, () => {
        // Example transformation
        const stateMap: Record<number, string> = {
          1: "open",
          2: "merged",
          3: "closed",
        };
        expect(stateMap[status]).toBe(state);
      });
    });
  });
});
