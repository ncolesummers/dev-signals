# Parameterized Testing Guide

This guide explains how to use parameterized testing patterns in DevSignals to reduce test duplication and improve coverage for edge cases.

## Overview

Parameterized testing (also called data-driven testing or table-driven testing) allows you to run the same test logic with multiple input/output combinations. This reduces duplication and makes it easy to test comprehensive edge cases.

**Benefits:**
- **Less duplication**: Write test logic once, run with many inputs
- **Better coverage**: Easily test edge cases and boundaries
- **Clear failures**: Test output shows which parameter set failed
- **Easy to extend**: Add new test cases without duplicating code

## Using Bun's `describe.each()`

Bun test runner supports Jest-compatible `describe.each()` for parameterized testing:

### Basic Example

```typescript
import { describe, test, expect } from 'bun:test';

describe.each([
  { input: 1, expected: 'open' },
  { input: 2, expected: 'merged' },
  { input: 3, expected: 'closed' },
])('PR status transformation', ({ input, expected }) => {
  test(`status ${input} maps to ${expected}`, () => {
    const result = transformPRStatus(input);
    expect(result.state).toBe(expected);
  });
});
```

**Output:**
```
✓ PR status transformation > status 1 maps to open
✓ PR status transformation > status 2 maps to merged
✓ PR status transformation > status 3 maps to closed
```

## Common Use Cases

### 1. Testing State Transformations

When you have multiple state mappings (e.g., Azure DevOps PR status → internal state):

```typescript
describe.each([
  { status: 1, expectedState: 'open', description: 'Active' },
  { status: 2, expectedState: 'merged', description: 'Completed' },
  { status: 3, expectedState: 'closed', description: 'Abandoned' },
])('PR status transformation', ({ status, expectedState, description }) => {
  test(`should transform ${description} (status=${status}) to ${expectedState}`, () => {
    const pr = { status };
    const result = transformPR(pr);
    expect(result.state).toBe(expectedState);
  });
});
```

### 2. Testing Boundary Conditions

When you need to test ranges or buckets (e.g., PR size classifications):

```typescript
import { boundaryTestCases } from '@/lib/__tests__/utils/parameterized';

describe.each(
  boundaryTestCases([
    [0, 'xs'],      // Minimum value
    [50, 'xs'],     // Upper boundary
    [51, 's'],      // Lower boundary of next bucket
    [200, 's'],     // Upper boundary
    [201, 'm'],     // Lower boundary of next bucket
  ])
)('PR size boundaries', ({ value, expected, label }) => {
  test(`${label} lines should be ${expected.toUpperCase()}`, () => {
    expect(categorizePRSize(value)).toBe(expected);
  });
});
```

### 3. Testing Edge Cases

When you need to handle null/undefined/missing fields:

```typescript
describe.each([
  {
    scenario: 'null creationDate',
    pr: { pullRequestId: 1, status: 1, creationDate: null },
  },
  {
    scenario: 'undefined creationDate',
    pr: { pullRequestId: 2, status: 1, creationDate: undefined },
  },
  {
    scenario: 'undefined closedDate',
    pr: { pullRequestId: 3, status: 1, closedDate: undefined },
  },
])('Timestamp edge cases', ({ scenario, pr }) => {
  test(`should handle ${scenario}`, () => {
    const result = transformPR(pr);
    
    // createdAt should always be defined (defaults to now)
    expect(result.createdAt).toBeInstanceOf(Date);
  });
});
```

## Helper Utilities

### `boundaryTestCases()`

Creates test cases for boundary testing with descriptive labels:

```typescript
import { boundaryTestCases } from '@/lib/__tests__/utils/parameterized';

const cases = boundaryTestCases([
  [0, 'xs'],
  [50, 'xs'],
  [51, 's'],
]);

// Returns:
// [
//   { value: 0, expected: 'xs', label: '0 (boundary)' },
//   { value: 50, expected: 'xs', label: '50 (boundary)' },
//   { value: 51, expected: 's', label: '51 (boundary)' },
// ]
```

### `isDefined()`

Type guard for checking if values are not null or undefined:

```typescript
import { isDefined } from '@/lib/__tests__/utils/parameterized';

if (isDefined(value)) {
  // TypeScript knows value is not null or undefined
  console.log(value.toString());
}
```

## Real-World Examples

### Example 1: PR Size Tests

See: `src/lib/metrics/__tests__/pr-size.test.ts`

### Example 2: PR Transformation Tests

See: `src/lib/ingestion/__tests__/azure-devops.test.ts`

### Example 3: Utility Tests

See: `src/lib/__tests__/utils/parameterized.test.ts`

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test src/lib/metrics/__tests__/pr-size.test.ts
```
