/**
 * Type declarations for @testing-library/jest-dom matchers
 * Extends Bun's expect() with DOM-specific assertions
 */

import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "bun:test" {
  interface Matchers<T = unknown>
    extends TestingLibraryMatchers<typeof expect.stringContaining, T> {}
  interface AsymmetricMatchers
    extends TestingLibraryMatchers<typeof expect.stringContaining, unknown> {}
}
