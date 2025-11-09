/**
 * Shared Type Definitions for Azure DevOps Ingestion
 *
 * This module contains common types used across PR and CI run ingestion modules.
 */

import type { TeamProjectReference } from "azure-devops-node-api/interfaces/CoreInterfaces";

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Azure DevOps configuration extracted from environment variables
 */
export interface AzureDevOpsConfig {
  /** Personal Access Token for Azure DevOps API */
  pat: string;
  /** Organization name in Azure DevOps */
  org: string;
  /** List of project names to exclude from ingestion */
  excludeProjects: string[];
  /** Request timeout in milliseconds (default: 30000) */
  requestTimeout: number;
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Rate limit threshold in requests per minute (default: 200) */
  rateLimitPerMinute: number;
}

// ============================================================================
// Ingestion Result Types
// ============================================================================

/**
 * Error encountered during ingestion
 */
export interface IngestionError {
  /** Project name where error occurred (optional) */
  project?: string;
  /** Human-readable error message */
  message: string;
  /** Original error object (optional) */
  error?: unknown;
}

/**
 * Base result interface for all ingestion operations
 */
export interface BaseIngestionResult {
  /** Whether the overall ingestion succeeded */
  success: boolean;
  /** Number of projects processed */
  projectsProcessed: number;
  /** List of errors encountered */
  errors: IngestionError[];
}

/**
 * Result of PR ingestion operation
 */
export interface IngestionResult extends BaseIngestionResult {
  /** Number of PRs newly inserted */
  prsIngested: number;
  /** Number of PRs updated with newer data */
  prsUpdated: number;
  /** Number of PRs enriched with review timestamps */
  prsEnriched: number;
  /** Number of PRs with review data */
  prsWithReviews: number;
  /** Number of PRs with approval data */
  prsWithApprovals: number;
  /** Number of errors during enrichment */
  enrichmentErrors: number;
}

/**
 * Step metric for WDK-compatible tracking
 */
export interface StepMetric {
  /** Name of the step */
  stepName: string;
  /** Start timestamp (Unix ms) */
  startTime: number;
  /** Duration in milliseconds */
  duration: number;
  /** Step completion status */
  status: "success" | "error" | "timeout" | "skipped";
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of CI run ingestion operation
 */
export interface CIIngestionResult extends BaseIngestionResult {
  /** Number of CI runs newly inserted */
  runsIngested: number;
  /** Number of CI runs updated with newer data */
  runsUpdated: number;
  /** Number of runs identified as flaky */
  flakyRunsDetected: number;
  /** Step-by-step metrics for performance tracking */
  metrics?: StepMetric[];
}

/**
 * Result of PR ingestion for a single project
 */
export interface ProjectIngestionResult {
  /** Name of the project */
  projectName: string;
  /** Number of PRs newly inserted */
  prsIngested: number;
  /** Number of PRs updated with newer data */
  prsUpdated: number;
  /** Number of PRs enriched with review timestamps */
  prsEnriched: number;
  /** Number of PRs with review data */
  prsWithReviews: number;
  /** Number of PRs with approval data */
  prsWithApprovals: number;
  /** Number of errors during enrichment */
  enrichmentErrors: number;
  /** Errors encountered during project ingestion */
  errors: IngestionError[];
}

/**
 * Result of CI run ingestion for a single project
 */
export interface ProjectCIIngestionResult {
  /** Name of the project */
  projectName: string;
  /** Number of CI runs newly inserted */
  runsIngested: number;
  /** Number of CI runs updated with newer data */
  runsUpdated: number;
  /** Errors encountered during project ingestion */
  errors: IngestionError[];
}

// ============================================================================
// Azure DevOps API Types
// ============================================================================

/**
 * Re-export commonly used Azure DevOps types for convenience
 */
export type { TeamProjectReference };

/**
 * Type guard to check if a value is a valid project reference
 */
export function isValidProject(
  project: TeamProjectReference | undefined,
): project is TeamProjectReference {
  return project !== undefined && typeof project.name === "string";
}
