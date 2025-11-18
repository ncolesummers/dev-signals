/**
 * Next.js Instrumentation Hook
 *
 * This file runs ONCE when the Next.js server starts, before any requests
 * are handled. Used for OpenTelemetry (OTEL) setup for observability.
 *
 * NOTE: Database migrations are handled by GitHub Actions workflows, NOT here.
 * See .github/workflows/preview.yml and .github/workflows/production.yml
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import { registerOTel } from "@vercel/otel";

/**
 * Register function - called once on server startup
 *
 * This runs before the Next.js app starts accepting requests.
 * Only runs on the server (not in browser or during build).
 */
export async function register() {
  // Only run on server-side (not in edge runtime or browser)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("[Instrumentation] Initializing OpenTelemetry...");
    registerOTel("dev-signals");
    console.log("[Instrumentation] ✅ OTEL registered");
  }
}
