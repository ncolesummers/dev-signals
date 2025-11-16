/**
 * Parameterized tests for PR size calculations
 *
 * Tests the PR size categorization logic (XS/S/M/L/XL buckets) using
 * data-driven test patterns to ensure correct boundary handling.
 *
 * Size buckets:
 * - XS: 0-50 lines
 * - S: 51-200 lines
 * - M: 201-500 lines
 * - L: 501-1000 lines
 * - XL: 1000+ lines
 */

import { describe, expect, test } from "bun:test";
import { boundaryTestCases } from "@/lib/__tests__/utils/parameterized";

/**
 * Helper function to categorize PR size based on total lines changed
 * (This matches the SQL logic in pr-metrics.ts)
 */
function categorizePRSize(
  additions: number,
  deletions: number,
): "xs" | "s" | "m" | "l" | "xl" {
  const totalLines = additions + deletions;

  if (totalLines <= 50) return "xs";
  if (totalLines <= 200) return "s";
  if (totalLines <= 500) return "m";
  if (totalLines <= 1000) return "l";
  return "xl";
}

describe("PR Size Categorization", () => {
  // Parameterized tests for boundary values
  describe.each(
    boundaryTestCases([
      // XS bucket (0-50 lines)
      [0, "xs"], // Minimum value
      [25, "xs"], // Mid-range
      [50, "xs"], // Upper boundary

      // S bucket (51-200 lines)
      [51, "s"], // Lower boundary
      [100, "s"], // Mid-range
      [200, "s"], // Upper boundary

      // M bucket (201-500 lines)
      [201, "m"], // Lower boundary
      [350, "m"], // Mid-range
      [500, "m"], // Upper boundary

      // L bucket (501-1000 lines)
      [501, "l"], // Lower boundary
      [750, "l"], // Mid-range
      [1000, "l"], // Upper boundary

      // XL bucket (1000+ lines)
      [1001, "xl"], // Lower boundary
      [5000, "xl"], // Large PR
      [10000, "xl"], // Very large PR
    ]),
  )("Boundary test: $label", ({ value, expected }) => {
    test(`${value} total lines should be ${expected.toUpperCase()}`, () => {
      // Test with all additions
      expect(categorizePRSize(value, 0)).toBe(expected);

      // Test with all deletions
      expect(categorizePRSize(0, value)).toBe(expected);

      // Test with balanced additions/deletions
      const half = Math.floor(value / 2);
      expect(categorizePRSize(half, value - half)).toBe(expected);
    });
  });

  // Parameterized tests for various addition/deletion combinations
  describe.each([
    // XS: 0-50 lines
    { additions: 0, deletions: 0, expected: "xs", description: "empty PR" },
    {
      additions: 25,
      deletions: 25,
      expected: "xs",
      description: "balanced small PR",
    },
    {
      additions: 50,
      deletions: 0,
      expected: "xs",
      description: "all additions at boundary",
    },
    {
      additions: 0,
      deletions: 50,
      expected: "xs",
      description: "all deletions at boundary",
    },

    // S: 51-200 lines
    {
      additions: 51,
      deletions: 0,
      expected: "s",
      description: "small PR lower boundary",
    },
    {
      additions: 100,
      deletions: 100,
      expected: "s",
      description: "balanced small/medium PR",
    },
    {
      additions: 200,
      deletions: 0,
      expected: "s",
      description: "small PR upper boundary",
    },
    {
      additions: 150,
      deletions: 50,
      expected: "s",
      description: "mixed small PR",
    },

    // M: 201-500 lines
    {
      additions: 201,
      deletions: 0,
      expected: "m",
      description: "medium PR lower boundary",
    },
    {
      additions: 300,
      deletions: 200,
      expected: "m",
      description: "balanced medium PR",
    },
    {
      additions: 500,
      deletions: 0,
      expected: "m",
      description: "medium PR upper boundary",
    },
    {
      additions: 400,
      deletions: 100,
      expected: "m",
      description: "mixed medium PR",
    },

    // L: 501-1000 lines
    {
      additions: 501,
      deletions: 0,
      expected: "l",
      description: "large PR lower boundary",
    },
    {
      additions: 600,
      deletions: 400,
      expected: "l",
      description: "balanced large PR",
    },
    {
      additions: 1000,
      deletions: 0,
      expected: "l",
      description: "large PR upper boundary",
    },
    {
      additions: 800,
      deletions: 200,
      expected: "l",
      description: "mixed large PR",
    },

    // XL: 1000+ lines
    {
      additions: 1001,
      deletions: 0,
      expected: "xl",
      description: "extra large PR lower boundary",
    },
    {
      additions: 5000,
      deletions: 5000,
      expected: "xl",
      description: "very large refactor",
    },
    {
      additions: 15000,
      deletions: 5000,
      expected: "xl",
      description: "massive PR",
    },
    {
      additions: 10000,
      deletions: 0,
      expected: "xl",
      description: "large feature addition",
    },
  ])(
    "Addition/deletion combinations",
    ({ additions, deletions, expected, description }) => {
      test(`${description}: +${additions}/-${deletions} = ${expected.toUpperCase()}`, () => {
        expect(categorizePRSize(additions, deletions)).toBe(expected);
      });
    },
  );

  // Edge cases
  describe("Edge cases", () => {
    test("should handle zero additions and deletions (empty PR)", () => {
      expect(categorizePRSize(0, 0)).toBe("xs");
    });

    test("should handle very large numbers", () => {
      expect(categorizePRSize(100000, 50000)).toBe("xl");
    });

    test("should treat additions and deletions equally", () => {
      // 50 additions vs 50 deletions should both be XS
      expect(categorizePRSize(50, 0)).toBe("xs");
      expect(categorizePRSize(0, 50)).toBe("xs");

      // 51 additions vs 51 deletions should both be S
      expect(categorizePRSize(51, 0)).toBe("s");
      expect(categorizePRSize(0, 51)).toBe("s");
    });

    test("should use total lines for categorization", () => {
      // 30 additions + 25 deletions = 55 total (S bucket)
      expect(categorizePRSize(30, 25)).toBe("s");

      // 100 additions + 101 deletions = 201 total (M bucket)
      expect(categorizePRSize(100, 101)).toBe("m");
    });
  });

  // Realistic distribution scenarios
  describe("Realistic scenarios", () => {
    test("should categorize typical bug fix", () => {
      // Small bug fix: few lines changed
      expect(categorizePRSize(5, 3)).toBe("xs");
    });

    test("should categorize typical feature", () => {
      // Medium feature: moderate lines added
      expect(categorizePRSize(200, 50)).toBe("m");
    });

    test("should categorize refactoring PR", () => {
      // Large refactor: many lines changed
      expect(categorizePRSize(600, 500)).toBe("xl");
    });

    test("should categorize documentation update", () => {
      // Doc update: usually small
      expect(categorizePRSize(20, 5)).toBe("xs");
    });

    test("should categorize dependency update", () => {
      // Lock file changes: can be large
      expect(categorizePRSize(3000, 2000)).toBe("xl");
    });
  });
});
