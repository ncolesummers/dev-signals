/**
 * Parameterized Testing Utilities
 *
 * Utilities and helper functions for data-driven/parameterized testing with Bun test runner.
 * Reduces test duplication and improves coverage for edge cases.
 *
 * ## Usage with Bun's `describe.each()`
 *
 * Bun test runner supports Jest-compatible `describe.each()` for parameterized testing:
 *
 * @example
 * ```typescript
 * import { describe, test, expect } from 'bun:test';
 *
 * describe.each([
 *   { input: 1, expected: 'open' },
 *   { input: 2, expected: 'merged' },
 *   { input: 3, expected: 'closed' },
 * ])('PR status transformation', ({ input, expected }) => {
 *   test(`status ${input} maps to ${expected}`, () => {
 *     const result = transformStatus(input);
 *     expect(result).toBe(expected);
 *   });
 * });
 * ```
 *
 * ## Benefits
 *
 * - **Reduces duplication**: Write test logic once, run for multiple inputs
 * - **Better coverage**: Easily test edge cases and boundaries
 * - **Clear failures**: Test output shows which parameter set failed
 * - **Maintainable**: Add new test cases without duplicating code
 */

/**
 * Type guard to check if a value is defined (not null or undefined)
 *
 * @example
 * ```typescript
 * if (isDefined(value)) {
 *   // TypeScript knows value is not null or undefined
 *   console.log(value.toString());
 * }
 * ```
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Helper to create test cases for boundary testing
 *
 * Useful for testing ranges like PR size buckets or time thresholds.
 *
 * @param boundaries - Array of [value, expected] tuples
 * @returns Array of test case objects with descriptive labels
 *
 * @example
 * ```typescript
 * const prSizeCases = boundaryTestCases([
 *   [0, 'xs'],      // Lower boundary
 *   [50, 'xs'],     // Upper boundary of XS
 *   [51, 's'],      // Lower boundary of S
 *   [200, 's'],     // Upper boundary of S
 * ]);
 *
 * describe.each(prSizeCases)('PR size classification', ({ value, expected, label }) => {
 *   test(`${label} lines should be ${expected}`, () => {
 *     expect(getPRSize(value)).toBe(expected);
 *   });
 * });
 * ```
 */
export function boundaryTestCases<T, E>(
  boundaries: Array<[T, E]>,
): Array<{ value: T; expected: E; label: string }> {
  return boundaries.map(([value, expected]) => ({
    value,
    expected,
    label: `${value} (boundary)`,
  }));
}
