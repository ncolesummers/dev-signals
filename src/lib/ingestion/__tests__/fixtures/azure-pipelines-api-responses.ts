import { faker } from "@faker-js/faker";
import type { Build } from "azure-devops-node-api/interfaces/BuildInterfaces";

/**
 * Test Fixtures for Azure Pipelines API Responses
 *
 * Uses Faker to generate realistic test data for CI run ingestion and flaky detection.
 * All factory functions generate fresh data on each call for test isolation.
 */

// ============================================================================
// Build Factories
// ============================================================================

/**
 * Create a Build object with sensible defaults
 * Azure DevOps BuildStatus: None=0, InProgress=1, Completed=2, Cancelling=4, Postponed=8, NotStarted=32
 * Azure DevOps BuildResult: None=0, Succeeded=2, PartiallySucceeded=4, Failed=8, Canceled=32
 */
export function createBuild(overrides?: Partial<Build>): Build {
  const buildId = faker.number.int({ min: 1, max: 100000 });
  const buildNumber = `${faker.date.recent({ days: 30 }).toISOString().split("T")[0]}.${faker.number.int({ min: 1, max: 99 })}`;
  const startTime = faker.date.recent({ days: 30 });
  const finishTime = faker.date.soon({ days: 1, refDate: startTime });

  return {
    id: buildId,
    buildNumber,
    status: 2, // Completed
    result: 2, // Succeeded
    sourceBranch: "refs/heads/main",
    sourceVersion: faker.git.commitSha(),
    startTime,
    finishTime,
    definition: {
      id: faker.number.int({ min: 1, max: 100 }),
      name: `${faker.word.noun()}-pipeline`,
    },
    repository: {
      id: faker.string.uuid(),
      name: `${faker.word.noun()}-repo`,
      type: "TfsGit",
    },
    ...overrides,
  };
}

/**
 * Create a successful build
 */
export function createSuccessfulBuild(overrides?: Partial<Build>): Build {
  return createBuild({
    status: 2, // Completed
    result: 2, // Succeeded
    ...overrides,
  });
}

/**
 * Create a failed build
 */
export function createFailedBuild(overrides?: Partial<Build>): Build {
  return createBuild({
    status: 2, // Completed
    result: 8, // Failed
    ...overrides,
  });
}

/**
 * Create a partially succeeded build
 */
export function createPartiallySucceededBuild(
  overrides?: Partial<Build>,
): Build {
  return createBuild({
    status: 2, // Completed
    result: 4, // PartiallySucceeded
    ...overrides,
  });
}

/**
 * Create a cancelled build
 */
export function createCancelledBuild(overrides?: Partial<Build>): Build {
  return createBuild({
    status: 2, // Completed
    result: 32, // Canceled
    ...overrides,
  });
}

/**
 * Create an in-progress build
 */
export function createInProgressBuild(overrides?: Partial<Build>): Build {
  return createBuild({
    status: 1, // InProgress
    result: 0, // None
    finishTime: undefined,
    ...overrides,
  });
}

// ============================================================================
// Scenario Factories (Common Test Cases)
// ============================================================================

/**
 * Scenario: Flaky pattern - same commit, one failed, one succeeded within 24h
 */
export function createFlakyBuildScenario() {
  const commitSha = faker.git.commitSha();
  const firstRunTime = faker.date.recent({ days: 5 });
  const retryTime = new Date(firstRunTime.getTime() + 1000 * 60 * 30); // 30 minutes later

  const failedBuild = createFailedBuild({
    sourceVersion: commitSha,
    startTime: firstRunTime,
    finishTime: new Date(firstRunTime.getTime() + 1000 * 60 * 15), // 15 min duration
  });

  const succeededBuild = createSuccessfulBuild({
    sourceVersion: commitSha,
    startTime: retryTime,
    finishTime: new Date(retryTime.getTime() + 1000 * 60 * 15), // 15 min duration
  });

  return {
    builds: [failedBuild, succeededBuild],
    commitSha,
    isFlaky: true,
    description: "Failed then passed on same commit within 30 minutes",
  };
}

/**
 * Scenario: Flaky pattern - multiple retries on same commit
 */
export function createMultipleRetryFlakyScenario() {
  const commitSha = faker.git.commitSha();
  const baseTime = faker.date.recent({ days: 5 });

  const builds: Build[] = [
    createFailedBuild({
      sourceVersion: commitSha,
      startTime: baseTime,
      finishTime: new Date(baseTime.getTime() + 1000 * 60 * 15),
    }),
    createFailedBuild({
      sourceVersion: commitSha,
      startTime: new Date(baseTime.getTime() + 1000 * 60 * 20),
      finishTime: new Date(baseTime.getTime() + 1000 * 60 * 35),
    }),
    createSuccessfulBuild({
      sourceVersion: commitSha,
      startTime: new Date(baseTime.getTime() + 1000 * 60 * 40),
      finishTime: new Date(baseTime.getTime() + 1000 * 60 * 55),
    }),
  ];

  return {
    builds,
    commitSha,
    isFlaky: true,
    description: "Failed twice, then passed on third attempt",
  };
}

/**
 * Scenario: NOT flaky - all builds passed on same commit
 */
export function createAllPassingScenario() {
  const commitSha = faker.git.commitSha();
  const baseTime = faker.date.recent({ days: 5 });

  const builds: Build[] = [
    createSuccessfulBuild({
      sourceVersion: commitSha,
      startTime: baseTime,
    }),
    createSuccessfulBuild({
      sourceVersion: commitSha,
      startTime: new Date(baseTime.getTime() + 1000 * 60 * 20),
    }),
  ];

  return {
    builds,
    commitSha,
    isFlaky: false,
    description: "All builds passed - not flaky",
  };
}

/**
 * Scenario: NOT flaky - all builds failed on same commit
 */
export function createAllFailingScenario() {
  const commitSha = faker.git.commitSha();
  const baseTime = faker.date.recent({ days: 5 });

  const builds: Build[] = [
    createFailedBuild({
      sourceVersion: commitSha,
      startTime: baseTime,
    }),
    createFailedBuild({
      sourceVersion: commitSha,
      startTime: new Date(baseTime.getTime() + 1000 * 60 * 20),
    }),
  ];

  return {
    builds,
    commitSha,
    isFlaky: false,
    description: "All builds failed - not flaky (consistent failure)",
  };
}

/**
 * Scenario: NOT flaky - single build only
 */
export function createSingleBuildScenario() {
  const commitSha = faker.git.commitSha();
  const build = createSuccessfulBuild({
    sourceVersion: commitSha,
  });

  return {
    builds: [build],
    commitSha,
    isFlaky: false,
    description: "Single build - not enough data to detect flaky",
  };
}

/**
 * Scenario: NOT flaky - builds outside 24h window
 */
export function createOutsideTimeWindowScenario() {
  const commitSha = faker.git.commitSha();
  const firstRunTime = faker.date.recent({ days: 10 });
  const retryTime = new Date(firstRunTime.getTime() + 1000 * 60 * 60 * 25); // 25 hours later

  const builds: Build[] = [
    createFailedBuild({
      sourceVersion: commitSha,
      startTime: firstRunTime,
      finishTime: new Date(firstRunTime.getTime() + 1000 * 60 * 15),
    }),
    createSuccessfulBuild({
      sourceVersion: commitSha,
      startTime: retryTime,
      finishTime: new Date(retryTime.getTime() + 1000 * 60 * 15),
    }),
  ];

  return {
    builds,
    commitSha,
    isFlaky: false,
    description: "Failed then passed but outside 24h window - not flaky",
  };
}

/**
 * Scenario: Different commits - should not be grouped
 */
export function createDifferentCommitsScenario() {
  const commit1 = faker.git.commitSha();
  const commit2 = faker.git.commitSha();
  const baseTime = faker.date.recent({ days: 5 });

  const builds: Build[] = [
    createFailedBuild({
      sourceVersion: commit1,
      startTime: baseTime,
    }),
    createSuccessfulBuild({
      sourceVersion: commit2,
      startTime: new Date(baseTime.getTime() + 1000 * 60 * 20),
    }),
  ];

  return {
    builds,
    commits: [commit1, commit2],
    isFlaky: false,
    description: "Different commits - should not be grouped as flaky",
  };
}

/**
 * Scenario: Builds with different branches
 */
export function createDifferentBranchesScenario() {
  const commitSha = faker.git.commitSha();
  const baseTime = faker.date.recent({ days: 5 });

  const builds: Build[] = [
    createFailedBuild({
      sourceVersion: commitSha,
      sourceBranch: "refs/heads/main",
      startTime: baseTime,
    }),
    createSuccessfulBuild({
      sourceVersion: commitSha,
      sourceBranch: "refs/heads/feature-branch",
      startTime: new Date(baseTime.getTime() + 1000 * 60 * 20),
    }),
  ];

  return {
    builds,
    commitSha,
    isFlaky: true, // Same commit SHA = flaky, even if different branches
    description: "Same commit on different branches - still flaky pattern",
  };
}

/**
 * Scenario: In-progress builds (should be excluded from flaky detection)
 */
export function createInProgressScenario() {
  const commitSha = faker.git.commitSha();
  const baseTime = faker.date.recent({ days: 1 });

  const builds: Build[] = [
    createFailedBuild({
      sourceVersion: commitSha,
      startTime: baseTime,
    }),
    createInProgressBuild({
      sourceVersion: commitSha,
      startTime: new Date(baseTime.getTime() + 1000 * 60 * 20),
    }),
  ];

  return {
    builds,
    commitSha,
    isFlaky: false,
    description: "In-progress build should not be counted for flaky detection",
  };
}

/**
 * Scenario: Partially succeeded builds (treated as failures for flaky detection)
 */
export function createPartiallySucceededScenario() {
  const commitSha = faker.git.commitSha();
  const baseTime = faker.date.recent({ days: 5 });

  const builds: Build[] = [
    createPartiallySucceededBuild({
      sourceVersion: commitSha,
      startTime: baseTime,
    }),
    createSuccessfulBuild({
      sourceVersion: commitSha,
      startTime: new Date(baseTime.getTime() + 1000 * 60 * 20),
    }),
  ];

  return {
    builds,
    commitSha,
    isFlaky: true,
    description: "Partially succeeded then fully succeeded - flaky pattern",
  };
}
