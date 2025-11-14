import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-black">
      <main className="flex w-full max-w-4xl flex-col items-center gap-12 px-6 py-16 text-center">
        {/* Hero Section */}
        <div className="space-y-6">
          <h1 className="text-5xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-6xl md:text-7xl">
            DevSignals
          </h1>
          <p className="mx-auto max-w-2xl text-xl text-zinc-600 dark:text-zinc-400">
            Diagnose why your team ships slowly with actionable engineering
            metrics
          </p>
        </div>

        {/* Value Proposition */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h3 className="mb-2 font-semibold text-zinc-950 dark:text-zinc-50">
              DORA Metrics
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Track deployment frequency, lead time, change failure rate, and
              MTTR
            </p>
          </div>
          <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h3 className="mb-2 font-semibold text-zinc-950 dark:text-zinc-50">
              Flow Diagnostics
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Identify bottlenecks in PR reviews, CI/CD, and deployment
              pipelines
            </p>
          </div>
          <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h3 className="mb-2 font-semibold text-zinc-950 dark:text-zinc-50">
              Weekly Insights
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Real-time metrics for the current week with historical trends
            </p>
          </div>
          <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h3 className="mb-2 font-semibold text-zinc-950 dark:text-zinc-50">
              Team-Focused
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              System-level diagnostics, not individual performance tracking
            </p>
          </div>
        </div>

        {/* CTA Button */}
        <div className="flex flex-col gap-4 sm:flex-row">
          <Link href="/dashboard">
            <Button size="lg" className="min-w-[200px]">
              View Dashboard
            </Button>
          </Link>
          <Link href="/api/health">
            <Button size="lg" variant="outline" className="min-w-[200px]">
              API Health
            </Button>
          </Link>
        </div>

        {/* Footer */}
        <p className="text-sm text-zinc-500 dark:text-zinc-600">
          Built with Next.js 16, React 19, and Tailwind CSS
        </p>
      </main>
    </div>
  );
}
