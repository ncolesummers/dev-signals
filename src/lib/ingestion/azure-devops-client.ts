/**
 * Azure DevOps API Client
 *
 * Shared utilities for Azure DevOps API interactions with:
 * - Environment validation (zod)
 * - Retry logic with exponential backoff (p-retry)
 * - Rate limiting (token bucket pattern)
 * - Connection management
 * - Project discovery
 */

import * as azdev from "azure-devops-node-api";
import type { TeamProjectReference } from "azure-devops-node-api/interfaces/CoreInterfaces";
import pRetry, { AbortError } from "p-retry";
import { z } from "zod";
import type { AzureDevOpsConfig } from "./types";

// ============================================================================
// Environment Validation Schema
// ============================================================================

const AzureDevOpsEnvSchema = z.object({
  AZURE_DEVOPS_PAT: z
    .string()
    .min(1, "AZURE_DEVOPS_PAT environment variable is required"),
  AZURE_DEVOPS_ORG: z
    .string()
    .min(1, "AZURE_DEVOPS_ORG environment variable is required"),
  AZURE_DEVOPS_EXCLUDE_PROJECTS: z.string().optional().default(""),
  AZURE_DEVOPS_REQUEST_TIMEOUT: z
    .string()
    .optional()
    .default("30000")
    .transform((val) => Number.parseInt(val, 10))
    .refine((val) => val > 0 && val <= 300000, {
      message: "Request timeout must be between 1ms and 300000ms (5 minutes)",
    }),
  AZURE_DEVOPS_MAX_RETRIES: z
    .string()
    .optional()
    .default("3")
    .transform((val) => Number.parseInt(val, 10))
    .refine((val) => val >= 0 && val <= 10, {
      message: "Max retries must be between 0 and 10",
    }),
  AZURE_DEVOPS_RATE_LIMIT_PER_MIN: z
    .string()
    .optional()
    .default("200")
    .transform((val) => Number.parseInt(val, 10))
    .refine((val) => val > 0 && val <= 1000, {
      message: "Rate limit must be between 1 and 1000 requests per minute",
    }),
});

// ============================================================================
// Rate Limiter (Token Bucket Pattern)
// ============================================================================

/**
 * Token bucket rate limiter for Azure DevOps API
 *
 * Limits requests to a specified rate per minute to avoid hitting API rate limits.
 */
class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per millisecond
  private lastRefill: number;

  /**
   * @param requestsPerMinute - Maximum number of requests allowed per minute
   */
  constructor(requestsPerMinute: number) {
    this.maxTokens = requestsPerMinute;
    this.tokens = requestsPerMinute;
    this.refillRate = requestsPerMinute / 60000; // Convert to per millisecond
    this.lastRefill = Date.now();
  }

  /**
   * Refill tokens based on elapsed time since last refill
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Wait until a token is available, then consume it
   */
  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Calculate wait time for next token
    const tokensNeeded = 1 - this.tokens;
    const waitTime = Math.ceil(tokensNeeded / this.refillRate);

    await sleep(waitTime);
    this.tokens -= 1;
  }

  /**
   * Reset the rate limiter (useful for testing)
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }
}

// Singleton rate limiter instance (initialized lazily)
let rateLimiter: RateLimiter | null = null;

/**
 * Get or initialize the rate limiter
 */
function getRateLimiter(config: AzureDevOpsConfig): RateLimiter {
  if (!rateLimiter) {
    rateLimiter = new RateLimiter(config.rateLimitPerMinute);
  }
  return rateLimiter;
}

// ============================================================================
// Configuration & Validation
// ============================================================================

/**
 * Get and validate Azure DevOps configuration from environment variables
 *
 * @throws {z.ZodError} If environment variables are invalid
 * @returns Validated configuration object
 */
export function getAzureDevOpsConfig(): AzureDevOpsConfig {
  const env = AzureDevOpsEnvSchema.parse(process.env);

  const excludeProjects = env.AZURE_DEVOPS_EXCLUDE_PROJECTS
    ? env.AZURE_DEVOPS_EXCLUDE_PROJECTS.split(",").map((p) => p.trim())
    : [];

  return {
    pat: env.AZURE_DEVOPS_PAT,
    org: env.AZURE_DEVOPS_ORG,
    excludeProjects,
    requestTimeout: env.AZURE_DEVOPS_REQUEST_TIMEOUT,
    maxRetries: env.AZURE_DEVOPS_MAX_RETRIES,
    rateLimitPerMinute: env.AZURE_DEVOPS_RATE_LIMIT_PER_MIN,
  };
}

// ============================================================================
// Azure DevOps API Client
// ============================================================================

/**
 * Create an authenticated Azure DevOps API connection
 *
 * @param org - Azure DevOps organization name
 * @param pat - Personal Access Token for authentication
 * @returns WebApi connection instance
 */
export async function createAzureDevOpsConnection(
  org: string,
  pat: string,
): Promise<azdev.WebApi> {
  const authHandler = azdev.getPersonalAccessTokenHandler(pat);
  const orgUrl = `https://dev.azure.com/${org}`;
  return new azdev.WebApi(orgUrl, authHandler);
}

// ============================================================================
// Project Discovery
// ============================================================================

/**
 * Discover all projects in an Azure DevOps organization
 *
 * Automatically filters out excluded projects specified in configuration.
 *
 * @param connection - Azure DevOps WebApi connection
 * @param excludeProjects - List of project names to exclude
 * @returns Array of team project references
 */
export async function discoverProjects(
  connection: azdev.WebApi,
  excludeProjects: string[],
): Promise<TeamProjectReference[]> {
  const coreApi = await connection.getCoreApi();
  const allProjects = await coreApi.getProjects();

  const filteredProjects = allProjects.filter(
    (project) => !excludeProjects.includes(project.name || ""),
  );

  console.log(
    `[Azure DevOps] Discovered ${filteredProjects.length} projects (excluded ${excludeProjects.length})`,
  );

  return filteredProjects;
}

// ============================================================================
// Retry Logic with Exponential Backoff
// ============================================================================

/**
 * Determine if an error is retryable
 *
 * Retryable errors:
 * - Network errors (ECONNRESET, ETIMEDOUT, etc.)
 * - Rate limit errors (429)
 * - Server errors (5xx)
 *
 * Non-retryable errors:
 * - Authentication errors (401, 403)
 * - Not found errors (404)
 * - Bad request errors (400)
 *
 * @param error - The error to check
 * @returns true if error should be retried, false otherwise
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network errors
    if (
      message.includes("econnreset") ||
      message.includes("etimedout") ||
      message.includes("enotfound") ||
      message.includes("econnrefused")
    ) {
      return true;
    }

    // Check for HTTP status codes in error message
    if (message.includes("429") || message.includes("rate limit")) {
      console.warn("[Azure DevOps] Rate limit hit, will retry with backoff");
      return true;
    }

    // Server errors (5xx)
    if (message.match(/\b5\d{2}\b/)) {
      console.warn(
        `[Azure DevOps] Server error detected: ${message}, will retry`,
      );
      return true;
    }

    // Authentication and client errors should not be retried
    if (
      message.includes("401") ||
      message.includes("403") ||
      message.includes("404") ||
      message.includes("400")
    ) {
      return false;
    }
  }

  // Default: don't retry unknown errors
  return false;
}

/**
 * Execute an async operation with retry logic and rate limiting
 *
 * Features:
 * - Exponential backoff with jitter
 * - Rate limiting via token bucket
 * - Distinguishes between retryable and non-retryable errors
 * - Configurable retry attempts
 *
 * @param operation - Async function to execute
 * @param config - Azure DevOps configuration
 * @param operationName - Name of operation (for logging)
 * @returns Result of the operation
 * @throws {AbortError} For non-retryable errors
 * @throws {Error} After all retry attempts exhausted
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: AzureDevOpsConfig,
  operationName = "operation",
): Promise<T> {
  // Acquire rate limit token before attempting operation
  await getRateLimiter(config).acquire();

  return pRetry(
    async () => {
      try {
        return await operation();
      } catch (error) {
        // Check if error is retryable
        if (!isRetryableError(error)) {
          // Non-retryable error - abort immediately
          throw new AbortError(
            error instanceof Error ? error.message : String(error),
          );
        }

        // Retryable error - let p-retry handle it
        throw error;
      }
    },
    {
      retries: config.maxRetries,
      factor: 2, // Exponential backoff factor
      minTimeout: 1000, // Start with 1 second
      maxTimeout: 30000, // Max 30 seconds between retries
      randomize: true, // Add jitter to prevent thundering herd
      onFailedAttempt: (failedAttempt) => {
        console.warn(
          `[Azure DevOps] ${operationName} failed (attempt ${failedAttempt.attemptNumber}/${config.maxRetries + 1})`,
        );
      },
    },
  );
}

/**
 * Execute an async operation with timeout protection
 *
 * @param operation - Async function to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Name of operation (for error messages)
 * @returns Result of the operation
 * @throws {Error} If operation times out
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  operationName = "operation",
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([operation(), timeoutPromise]);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Sleep for a specified duration
 *
 * @param ms - Duration in milliseconds
 * @returns Promise that resolves after the specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Log a message with INFO level
 *
 * @param message - Message to log
 * @param metadata - Optional metadata object
 */
export function logInfo(message: string, metadata?: Record<string, unknown>) {
  if (metadata) {
    console.log(`[INFO] ${message}`, metadata);
  } else {
    console.log(`[INFO] ${message}`);
  }
}

/**
 * Log a message with WARN level
 *
 * @param message - Message to log
 * @param metadata - Optional metadata object
 */
export function logWarn(message: string, metadata?: Record<string, unknown>) {
  if (metadata) {
    console.warn(`[WARN] ${message}`, metadata);
  } else {
    console.warn(`[WARN] ${message}`);
  }
}

/**
 * Log a message with ERROR level
 *
 * @param message - Message to log
 * @param error - Optional error object
 * @param metadata - Optional metadata object
 */
export function logError(
  message: string,
  error?: unknown,
  metadata?: Record<string, unknown>,
) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (metadata) {
    console.error(`[ERROR] ${message}: ${errorMessage}`, metadata);
  } else {
    console.error(`[ERROR] ${message}: ${errorMessage}`);
  }
}
