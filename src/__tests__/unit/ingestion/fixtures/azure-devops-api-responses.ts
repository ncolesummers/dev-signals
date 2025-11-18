import { faker } from "@faker-js/faker";
import type {
  Comment,
  GitPullRequestCommentThread,
  IdentityRefWithVote,
} from "azure-devops-node-api/interfaces/GitInterfaces";

/**
 * Test Fixtures for Azure DevOps API Responses
 *
 * Uses Faker to generate realistic test data for PR review timestamp enrichment.
 * All factory functions generate fresh data on each call for test isolation.
 */

// ============================================================================
// Comment Factories
// ============================================================================

export function createComment(overrides?: Partial<Comment>): Comment {
  return {
    id: faker.number.int({ min: 1, max: 100000 }),
    content: faker.lorem.paragraph(),
    publishedDate: faker.date.recent({ days: 30 }),
    isDeleted: false,
    author: {
      displayName: faker.person.fullName(),
      uniqueName: faker.internet.email(),
      id: faker.string.uuid(),
    },
    ...overrides,
  };
}

export function createDeletedComment(overrides?: Partial<Comment>): Comment {
  return createComment({
    isDeleted: true,
    content: "",
    ...overrides,
  });
}

// ============================================================================
// Thread Factories
// ============================================================================

export function createThread(
  overrides?: Partial<GitPullRequestCommentThread>,
): GitPullRequestCommentThread {
  const publishedDate = faker.date.recent({ days: 30 });

  return {
    id: faker.number.int({ min: 1, max: 100000 }),
    publishedDate,
    comments: [
      createComment({ publishedDate }), // First comment matches thread date
    ],
    isDeleted: false,
    status: 1, // Active
    ...overrides,
  };
}

export function createThreadWithMultipleComments(
  commentCount = 3,
  overrides?: Partial<GitPullRequestCommentThread>,
): GitPullRequestCommentThread {
  const publishedDate = faker.date.recent({ days: 30 });
  const comments: Comment[] = [];

  // First comment matches thread published date
  comments.push(createComment({ publishedDate }));

  // Subsequent comments are after the first
  for (let i = 1; i < commentCount; i++) {
    comments.push(
      createComment({
        publishedDate: faker.date.soon({
          days: 5,
          refDate: publishedDate,
        }),
      }),
    );
  }

  return {
    ...createThread({ comments }),
    ...overrides,
  };
}

export function createDeletedThread(
  overrides?: Partial<GitPullRequestCommentThread>,
): GitPullRequestCommentThread {
  return createThread({
    isDeleted: true,
    comments: [],
    ...overrides,
  });
}

export function createEmptyThread(
  overrides?: Partial<GitPullRequestCommentThread>,
): GitPullRequestCommentThread {
  return createThread({
    comments: [],
    ...overrides,
  });
}

// ============================================================================
// Reviewer Factories
// ============================================================================

/**
 * Azure DevOps vote values:
 * - 10: Approved
 * - 5: Approved with suggestions
 * - 0: No vote
 * - -5: Waiting for author
 * - -10: Rejected
 */
export function createReviewer(
  overrides?: Partial<IdentityRefWithVote>,
): IdentityRefWithVote {
  return {
    id: faker.string.uuid(),
    displayName: faker.person.fullName(),
    uniqueName: faker.internet.email(),
    vote: 0, // No vote by default
    ...overrides,
  };
}

export function createApprover(
  overrides?: Partial<IdentityRefWithVote>,
): IdentityRefWithVote {
  return createReviewer({
    vote: 10, // Approved
    ...overrides,
  });
}

export function createApproverWithSuggestions(
  overrides?: Partial<IdentityRefWithVote>,
): IdentityRefWithVote {
  return createReviewer({
    vote: 5, // Approved with suggestions
    ...overrides,
  });
}

export function createRejecter(
  overrides?: Partial<IdentityRefWithVote>,
): IdentityRefWithVote {
  return createReviewer({
    vote: -10, // Rejected
    ...overrides,
  });
}

export function createWaitingForAuthor(
  overrides?: Partial<IdentityRefWithVote>,
): IdentityRefWithVote {
  return createReviewer({
    vote: -5, // Waiting for author
    ...overrides,
  });
}

// ============================================================================
// Scenario Factories (Common Test Cases)
// ============================================================================

/**
 * Scenario: PR with single review comment
 */
export function createPRWithSingleReview() {
  const reviewDate = faker.date.recent({ days: 5 });
  const reviewer = createApprover();

  return {
    threads: [
      createThread({
        publishedDate: reviewDate,
        comments: [
          createComment({
            publishedDate: reviewDate,
            author: {
              displayName: reviewer.displayName,
              uniqueName: reviewer.uniqueName,
              id: reviewer.id,
            },
          }),
        ],
      }),
    ],
    reviewers: [reviewer],
    expectedFirstReview: reviewDate,
    expectedApproval: reviewDate,
  };
}

/**
 * Scenario: PR with multiple reviewers, different review times
 */
export function createPRWithMultipleReviewers() {
  const firstReviewDate = faker.date.recent({ days: 10 });
  const secondReviewDate = faker.date.soon({
    days: 2,
    refDate: firstReviewDate,
  });
  const approvalDate = faker.date.soon({
    days: 1,
    refDate: secondReviewDate,
  });

  const reviewer1 = createWaitingForAuthor({
    displayName: "Alice Smith",
  });
  const reviewer2 = createApproverWithSuggestions({
    displayName: "Bob Jones",
  });
  const reviewer3 = createApprover({ displayName: "Carol White" });

  return {
    threads: [
      createThread({
        publishedDate: firstReviewDate,
        comments: [
          createComment({
            publishedDate: firstReviewDate,
            author: {
              displayName: reviewer1.displayName,
              uniqueName: reviewer1.uniqueName,
              id: reviewer1.id,
            },
          }),
        ],
      }),
      createThread({
        publishedDate: secondReviewDate,
        comments: [
          createComment({
            publishedDate: secondReviewDate,
            author: {
              displayName: reviewer2.displayName,
              uniqueName: reviewer2.uniqueName,
              id: reviewer2.id,
            },
          }),
        ],
      }),
      createThread({
        publishedDate: approvalDate,
        comments: [
          createComment({
            publishedDate: approvalDate,
            author: {
              displayName: reviewer3.displayName,
              uniqueName: reviewer3.uniqueName,
              id: reviewer3.id,
            },
          }),
        ],
      }),
    ],
    reviewers: [reviewer1, reviewer2, reviewer3],
    expectedFirstReview: firstReviewDate,
    expectedApproval: approvalDate, // Carol's approval
  };
}

/**
 * Scenario: PR with no reviews (no threads, no reviewers)
 */
export function createPRWithNoReviews() {
  return {
    threads: [],
    reviewers: [],
    expectedFirstReview: null,
    expectedApproval: null,
  };
}

/**
 * Scenario: PR with comments but no approvals
 */
export function createPRWithCommentsButNoApproval() {
  const reviewDate = faker.date.recent({ days: 5 });
  const reviewer = createReviewer({ vote: 0 }); // No vote

  return {
    threads: [
      createThread({
        publishedDate: reviewDate,
        comments: [
          createComment({
            publishedDate: reviewDate,
            author: {
              displayName: reviewer.displayName,
              uniqueName: reviewer.uniqueName,
              id: reviewer.id,
            },
          }),
        ],
      }),
    ],
    reviewers: [reviewer],
    expectedFirstReview: reviewDate,
    expectedApproval: null,
  };
}

/**
 * Scenario: PR with deleted threads (should be filtered out)
 */
export function createPRWithDeletedThreads() {
  const deletedThreadDate = faker.date.recent({ days: 10 });
  const activeThreadDate = faker.date.recent({ days: 5 });
  const reviewer = createApprover();

  return {
    threads: [
      createDeletedThread({
        publishedDate: deletedThreadDate, // Older but deleted
      }),
      createThread({
        publishedDate: activeThreadDate,
        comments: [
          createComment({
            publishedDate: activeThreadDate,
            author: {
              displayName: reviewer.displayName,
              uniqueName: reviewer.uniqueName,
              id: reviewer.id,
            },
          }),
        ],
      }),
    ],
    reviewers: [reviewer],
    expectedFirstReview: activeThreadDate, // Deleted thread should be ignored
    expectedApproval: activeThreadDate,
  };
}

/**
 * Scenario: PR with empty threads (no comments)
 */
export function createPRWithEmptyThreads() {
  const emptyThreadDate = faker.date.recent({ days: 10 });
  const validThreadDate = faker.date.recent({ days: 5 });
  const reviewer = createApprover();

  return {
    threads: [
      createEmptyThread({
        publishedDate: emptyThreadDate,
      }),
      createThread({
        publishedDate: validThreadDate,
        comments: [
          createComment({
            publishedDate: validThreadDate,
            author: {
              displayName: reviewer.displayName,
              uniqueName: reviewer.uniqueName,
              id: reviewer.id,
            },
          }),
        ],
      }),
    ],
    reviewers: [reviewer],
    expectedFirstReview: validThreadDate, // Empty thread should be ignored
    expectedApproval: validThreadDate,
  };
}

/**
 * Scenario: PR with approval but no matching thread
 * (Reviewer approved without commenting)
 */
export function createPRWithApprovalButNoComment() {
  const approver = createApprover();

  return {
    threads: [],
    reviewers: [approver],
    expectedFirstReview: null, // No threads
    expectedApproval: null, // Cannot infer approval time without thread
  };
}

/**
 * Scenario: PR with rejection (vote = -10)
 */
export function createPRWithRejection() {
  const reviewDate = faker.date.recent({ days: 5 });
  const reviewer = createRejecter();

  return {
    threads: [
      createThread({
        publishedDate: reviewDate,
        comments: [
          createComment({
            publishedDate: reviewDate,
            author: {
              displayName: reviewer.displayName,
              uniqueName: reviewer.uniqueName,
              id: reviewer.id,
            },
            content: "This needs significant changes before approval.",
          }),
        ],
      }),
    ],
    reviewers: [reviewer],
    expectedFirstReview: reviewDate,
    expectedApproval: null, // Rejected, not approved
  };
}
