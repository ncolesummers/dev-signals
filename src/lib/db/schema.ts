import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Pull Requests table
 * Stores metadata about pull requests for tracking PR cycle time, review time, etc.
 *
 * AZURE DEVOPS API MAPPING:
 * - createdAt ← creationDate (available)
 * - closedAt ← closedDate (available)
 * - mergedAt ← closedDate when status="completed" (approximation)
 * - firstReviewAt ← NOT AVAILABLE in basic API (null for now, enrichment planned in US2.1b)
 * - approvedAt ← NOT AVAILABLE in basic API (null for now, enrichment planned in US2.1b)
 *
 * KNOWN LIMITATIONS:
 * - Review timestamps require Pull Request Threads API (future enrichment)
 * - mergedAt uses closedAt as approximation (adequate for DORA lead time)
 *
 * MULTI-PROJECT SUPPORT:
 * - Projects are autodiscovered from the organization via Core API
 * - Use projectName field to filter metrics per project or aggregate across all
 */
export const pullRequests = pgTable(
  "pull_requests",
  {
    id: serial("id").primaryKey(),
    // Azure DevOps PR identifiers
    prNumber: integer("pr_number").notNull(),
    repoName: varchar("repo_name", { length: 255 }).notNull(),
    orgName: varchar("org_name", { length: 255 }).notNull(), // Azure DevOps organization
    projectName: varchar("project_name", { length: 255 }).notNull(), // Azure DevOps project

    // PR metadata
    title: text("title").notNull(),
    author: varchar("author", { length: 255 }).notNull(),
    state: varchar("state", { length: 50 }).notNull(), // open, closed, merged

    // Timestamps
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    closedAt: timestamp("closed_at"),
    mergedAt: timestamp("merged_at"),

    // Review metrics
    firstReviewAt: timestamp("first_review_at"),
    approvedAt: timestamp("approved_at"),

    // PR size metrics
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    changedFiles: integer("changed_files").notNull().default(0),

    // Additional metadata
    labels: jsonb("labels").default([]), // Array of label names
    isDraft: boolean("is_draft").default(false),
    baseBranch: varchar("base_branch", { length: 255 }).default("main"),
    headBranch: varchar("head_branch", { length: 255 }),

    // System timestamps
    ingestedAt: timestamp("ingested_at").defaultNow(),
  },
  (table) => ({
    prNumberIdx: index("pr_number_idx").on(table.prNumber),
    repoNameIdx: index("repo_name_idx").on(table.repoName),
    projectNameIdx: index("project_name_idx").on(table.projectName),
    mergedAtIdx: index("merged_at_idx").on(table.mergedAt),
    createdAtIdx: index("created_at_idx").on(table.createdAt),
  }),
);

/**
 * CI Runs table
 * Stores CI pipeline run data for tracking flaky tests, pipeline failures, etc.
 *
 * AZURE DEVOPS API MAPPING:
 * - Maps to Azure Pipelines API
 * - Autodiscovered from all projects in organization
 */
export const ciRuns = pgTable(
  "ci_runs",
  {
    id: serial("id").primaryKey(),

    // CI run identifiers
    runId: varchar("run_id", { length: 255 }).notNull().unique(),
    workflowName: varchar("workflow_name", { length: 255 }).notNull(),

    // Repository context
    repoName: varchar("repo_name", { length: 255 }).notNull(),
    orgName: varchar("org_name", { length: 255 }).notNull(), // Azure DevOps organization
    projectName: varchar("project_name", { length: 255 }).notNull(), // Azure DevOps project
    branch: varchar("branch", { length: 255 }),
    commitSha: varchar("commit_sha", { length: 255 }), // Git commit SHA for linking and flaky detection

    // PR association (nullable for non-PR runs)
    prNumber: integer("pr_number"),

    // Run status
    status: varchar("status", { length: 50 }).notNull(), // success, failure, cancelled, in_progress
    conclusion: varchar("conclusion", { length: 50 }), // success, failure, cancelled, skipped, etc.

    // Timestamps
    startedAt: timestamp("started_at").notNull(),
    completedAt: timestamp("completed_at"),

    // Failure tracking
    isFlaky: boolean("is_flaky").default(false),
    flakyTestCount: integer("flaky_test_count").default(0), // Number of flaky tests detected in this run
    failureReason: text("failure_reason"),

    // Additional metadata
    jobsCount: integer("jobs_count").default(0),
    failedJobsCount: integer("failed_jobs_count").default(0),

    // System timestamps
    ingestedAt: timestamp("ingested_at").defaultNow(),
  },
  (table) => ({
    runIdIdx: index("run_id_idx").on(table.runId),
    projectNameIdxCi: index("ci_project_name_idx").on(table.projectName),
    prNumberIdx: index("ci_pr_number_idx").on(table.prNumber),
    commitShaIdx: index("ci_commit_sha_idx").on(table.commitSha),
    statusIdx: index("status_idx").on(table.status),
    startedAtIdx: index("started_at_idx").on(table.startedAt),
    isFlakyIdx: index("is_flaky_idx").on(table.isFlaky),
  }),
);

/**
 * Deployments table
 * Stores deployment events for DORA metrics (deployment frequency, change failure rate, MTTR)
 *
 * AZURE DEVOPS API MAPPING:
 * - Maps to Azure Pipelines deployment/release events
 * - Autodiscovered from all projects in organization
 */
export const deployments = pgTable(
  "deployments",
  {
    id: serial("id").primaryKey(),

    // Deployment identifiers
    deploymentId: varchar("deployment_id", { length: 255 }).notNull().unique(),
    environment: varchar("environment", { length: 100 }).notNull(), // production, staging, etc.

    // Repository context
    repoName: varchar("repo_name", { length: 255 }), // Nullable for manual deployments
    orgName: varchar("org_name", { length: 255 }).notNull(), // Azure DevOps organization
    projectName: varchar("project_name", { length: 255 }).notNull(), // Azure DevOps project

    // Deployment details
    commitSha: varchar("commit_sha", { length: 40 }).notNull(),
    deployedBy: varchar("deployed_by", { length: 255 }),
    notes: text("notes"), // Optional notes for manual deployments (incidents, context, etc.)

    // Status
    status: varchar("status", { length: 50 }).notNull(), // success, failure, in_progress, rolled_back

    // Timestamps
    startedAt: timestamp("started_at").notNull(),
    completedAt: timestamp("completed_at"),

    // Failure tracking (for Change Failure Rate)
    isFailed: boolean("is_failed").default(false),
    failureReason: text("failure_reason"),

    // Recovery tracking (for MTTR)
    isRollback: boolean("is_rollback").default(false),
    rollbackOf: integer("rollback_of"), // references deployments.id
    recoveredAt: timestamp("recovered_at"),

    // Associated PRs (for lead time calculation)
    relatedPRs: jsonb("related_prs").default([]), // Array of PR numbers

    // System timestamps
    ingestedAt: timestamp("ingested_at").defaultNow(),
  },
  (table) => ({
    deploymentIdIdx: index("deployment_id_idx").on(table.deploymentId),
    projectNameIdxDeploy: index("deploy_project_name_idx").on(
      table.projectName,
    ),
    environmentIdx: index("environment_idx").on(table.environment),
    statusIdx: index("deployment_status_idx").on(table.status),
    startedAtIdx: index("deployment_started_at_idx").on(table.startedAt),
    isFailedIdx: index("is_failed_idx").on(table.isFailed),
  }),
);

// Type exports for TypeScript
export type PullRequest = typeof pullRequests.$inferSelect;
export type NewPullRequest = typeof pullRequests.$inferInsert;

export type CIRun = typeof ciRuns.$inferSelect;
export type NewCIRun = typeof ciRuns.$inferInsert;

export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;
