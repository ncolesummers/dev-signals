# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevSignals is an engineering metrics dashboard designed to diagnose why teams ship slowly in one-week sprints. It tracks DORA metrics and flow diagnostics to identify delivery bottlenecks at the team/system level (not individual performance).

**Key Metrics Tracked**: Deployment Frequency, Lead Time for Changes, Change Failure Rate, MTTR, PR cycle time, review wait time, PR size distribution, flaky test rate, and more. All metrics use medians and p90 aggregations to remain resilient to outliers.

## Development Commands

This project uses **Bun** as the primary runtime (not npm/yarn).

### Core Commands
```bash
bun dev          # Start development server (http://localhost:3000)
bun build        # Build for production
bun start        # Start production server
bun lint         # Run Biome linter
bun format       # Auto-format code with Biome
bun test         # Run unit tests (Bun native test runner)
```

### Database Commands
```bash
bun run drizzle-kit generate   # Create migration from schema changes
bun run drizzle-kit migrate    # Apply migrations to database
bun run drizzle-kit studio     # Open Drizzle Studio GUI
```

### Testing Commands
```bash
bun test --coverage            # Run tests with coverage report (60% threshold)
bunx playwright install        # Install E2E test browsers
bunx playwright test           # Run E2E tests
bunx playwright test --ui      # Run E2E tests in UI mode
```

### Health Check
```bash
curl http://localhost:3000/api/health
```

## Debugging & Troubleshooting with Next.js MCP

**CRITICAL**: This project uses Next.js 16, which includes built-in MCP (Model Context Protocol) support for real-time diagnostics. The `next-devtools-mcp` server is THE PRIMARY TOOL for troubleshooting running Next.js applications and should ALWAYS be used before manual file inspection or curl-based testing.

### Why MCP is Essential

- **Real-time error detection**: Access build errors, runtime errors, and TypeScript errors directly from the running dev server
- **Live application state**: Query routes, components, server actions, and configuration without reading files
- **Browser-level testing**: Execute JavaScript in actual browser context (not just HTTP requests)
- **Context-aware debugging**: Understand your app's runtime state, not just its source code

### Quick Start

1. **Always start with `init`**: Call the `mcp__next-devtools__init` tool at the beginning of ANY Next.js debugging session
   ```
   This establishes documentation requirements and sets up proper context
   ```

2. **Start your dev server**: Run `bun dev` to start Next.js with MCP enabled at `http://localhost:3000/_next/mcp`

3. **Query runtime state**: Use `mcp__next-devtools__nextjs_runtime` to access live diagnostics
   - `action='discover_servers'`: Find all running Next.js dev servers (auto-discovery on ports 3000, 3001, etc.)
   - `action='list_tools'`: See all available runtime diagnostic tools
   - `action='call_tool'`: Execute specific tools (e.g., `get_errors`, `get_logs`, `get_project_metadata`)

### Available MCP Tools

| Tool | When to Use |
|------|-------------|
| `nextjs_runtime` | **PRIMARY TOOL** - Always use FIRST for any Next.js debugging, error investigation, or state queries |
| `nextjs_docs` | Search official Next.js documentation (always prefer over assumptions or outdated knowledge) |
| `browser_eval` | Test pages with Playwright for visual verification and client-side JavaScript testing |
| `upgrade_nextjs_16` | Execute automated codemods for version upgrades |
| `enable_cache_components` | Migrate to Cache Components with automated error detection and fixes |

### Runtime Diagnostics Workflow

**IMPORTANT**: Always use `nextjs_runtime` instead of manual file searches or curl commands when investigating running applications.

1. **Check for errors**: `call_tool` with `get_errors` to retrieve all current build/runtime/type errors
2. **Review logs**: `call_tool` with `get_logs` to access development log file (includes browser console + server output)
3. **Inspect routes**: `call_tool` with `get_page_metadata` to understand page structure and rendering
4. **Query config**: `call_tool` with `get_project_metadata` to see project structure and dev server URL

### Best Practices

- **Always `init` first**: Call `mcp__next-devtools__init` at the start of every Next.js session
- **Prefer runtime over static**: Use `nextjs_runtime` before reading files or running grep/find commands
- **Use browser automation**: For page verification, use `browser_eval` (executes real JavaScript) instead of `curl` (only fetches HTML)
- **Query docs, don't assume**: Always use `nextjs_docs` for Next.js questions instead of relying on prior knowledge
- **Auto-discovery works**: No need to manually specify ports—MCP auto-discovers running servers on common ports

### Troubleshooting MCP Connection

If MCP endpoint is not available:

1. **Check Next.js version**: Must be v16+ (`bun list next`)
2. **Verify dev server is running**: `bun dev` should show server started successfully
3. **Check MCP endpoint**: Visit `http://localhost:3000/_next/mcp` in browser (should show MCP metadata)
4. **Restart dev server**: Stop and restart `bun dev` to reinitialize MCP endpoint

### Example: Debugging a Runtime Error

```
❌ DON'T: Manually read files and guess at the issue
✅ DO:
1. Call mcp__next-devtools__init
2. Call nextjs_runtime with action='list_tools'
3. Call nextjs_runtime with action='call_tool', toolName='get_errors'
4. Review actual runtime errors from the dev server
5. Call nextjs_runtime with action='call_tool', toolName='get_logs' for detailed logs
6. Use browser_eval to test the page in a real browser context
```

## Tech Stack

- **Next.js 16** (App Router) with React Compiler enabled
- **React 19.2.0**
- **Bun** - Modern JavaScript runtime
- **Supabase Postgres** - Serverless PostgreSQL
- **Drizzle ORM** - Type-safe database queries
- **Tailwind CSS v4**
- **shadcn/ui** (New York variant)
- **Biome** - Fast linter/formatter (replaces ESLint/Prettier)

## High-Level Architecture

### Data Flow
1. **Ingestion Layer** (`lib/ingestion/`): Fetches data from Azure DevOps REST API
2. **Calculation Layer** (`lib/metrics/`): Computes metrics from raw data
3. **Dashboard Layer** (`app/`): Real-time on-demand calculations for current week
4. **Batch Processing**: Weekly aggregation on Mondays (configurable via `METRICS_CALCULATION_CRON`)

### Database Schema

Three core tables in `src/lib/db/schema.ts`:

1. **`pull_requests`**: Tracks PR lifecycle, review metrics, size metrics
   - Key fields: createdAt, firstReviewAt, mergedAt, closedAt, additions, deletions, filesChanged
   - Strategic indexes on repository, createdAt, state for efficient queries

2. **`ci_runs`**: Tracks CI pipeline runs, flaky tests, failures
   - Key fields: startedAt, completedAt, conclusion, flakyTestCount, failedTests (JSONB)
   - Indexed on repository, startedAt, conclusion

3. **`deployments`**: Tracks deployment events, failures, rollbacks
   - Key fields: deployedAt, environment, deploymentStatus, isRollback
   - Indexed on repository, deployedAt, environment

**Database Pattern**: Singleton client exported from `src/lib/db/client.ts`. All schema definitions use Drizzle ORM with full TypeScript type inference (`$inferSelect`, `$inferInsert`).

### Code Organization Patterns

```
src/
├── app/                    # Next.js App Router
│   ├── api/health/        # Health check endpoint
│   ├── page.tsx           # Home page
│   ├── layout.tsx         # Root layout with Geist fonts
│   └── globals.css        # Global styles (Tailwind v4)
├── components/
│   └── ui/                # shadcn/ui components (Badge, Button, Card, Table)
├── lib/
│   ├── db/               # Database layer
│   │   ├── schema.ts     # Drizzle schema definitions
│   │   └── client.ts     # Database connection singleton
│   ├── ingestion/        # Azure DevOps data ingestion
│   ├── metrics/          # Metrics calculation logic
│   └── utils.ts          # Shared utilities (cn helper)
└── hooks/                # Custom React hooks
```

**Import Alias**: Use `@/*` for `src/*` paths (e.g., `import { db } from '@/lib/db/client'`)

### Component Patterns

- **shadcn/ui components**: Composable UI primitives with variant support via `class-variance-authority`
- **forwardRef pattern**: All components use `React.forwardRef` for ref forwarding
- **cn utility**: Combines `clsx` + `tailwind-merge` for conditional className merging
  ```typescript
  import { cn } from '@/lib/utils'
  <div className={cn("base-class", isActive && "active-class")} />
  ```

### Type Safety

- **Strict TypeScript**: `strict: true` enforced, no `any` types allowed
- **Database types**: Exported from schema as `typeof pullRequests.$inferSelect` and `typeof pullRequests.$inferInsert`
- **Drizzle ORM**: Full type inference for queries, no manual type definitions needed

## Environment Setup

Required environment variables (see `.env.example`):

```bash
DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
AZURE_DEVOPS_PAT="your_pat_here"  # Azure DevOps Personal Access Token
AZURE_DEVOPS_ORG="your_org_name"  # Organization name (projects are autodiscovered)
# Optional: Exclude specific projects from metrics
# AZURE_DEVOPS_EXCLUDE_PROJECTS="archived-project,test-sandbox"
WEEK_START_DAY="monday"
METRICS_CALCULATION_CRON="0 0 * * 1"  # Every Monday at midnight
NODE_ENV="development"
```

**First-Time Setup**:
1. `bun install`
2. Copy `.env.example` to `.env.local` and fill in values
3. `bun run drizzle-kit generate`
4. `bun run drizzle-kit migrate`
5. `bun dev`

## Metrics Definitions

See `METRICS_DEFINITIONS.md` for precise calculation methods for all 12 metrics. Key points:

- **DORA Metrics**: Deployment Frequency, Lead Time for Changes, Change Failure Rate, MTTR
- **Flow Diagnostics**: PR cycle time, review wait time, PR size distribution, flaky test rate, etc.
- **Aggregation**: Use medians and p90 (not averages) to handle outliers
- **Time Zone**: All timestamps stored in UTC, displayed in user's local time
- **Calculation Schedule**: Real-time for current week, batch processing for historical weeks

## Code Quality Standards

Enforced in CI/CD pipeline:

- **Biome checks**: All code must pass `bun lint` and `bun format --check`
- **TypeScript**: Strict mode, no type errors
- **Test coverage**: ≥60% threshold (enforced via Bun test runner)
- **Accessibility**: UI components must pass axe accessibility checks

## Key Technical Decisions

Understanding these choices helps explain architecture:

- **Bun over npm**: Faster package management and test execution
- **Biome over ESLint/Prettier**: 10-100x faster linting/formatting
- **Drizzle over Prisma**: Lighter weight, better TypeScript inference, no code generation
- **Supabase over traditional Postgres**: Serverless, auto-scaling, built-in connection pooling, plus additional features like realtime subscriptions, auth, and storage if needed in the future
- **Medians/p90 over averages**: More resilient to outliers in metrics calculations
- **React Compiler**: Automatic memoization without manual `useMemo`/`useCallback`
- **shadcn/ui**: Copy-paste components instead of node_modules dependency for full control

## Project Management

- **Project Board**: Tracked via Azure DevOps Boards (multi-project aggregation)
- **Issue Templates**: Use structured templates in `.github/ISSUE_TEMPLATE/`
  - `user_story.yml`: For feature work with acceptance criteria and test plan
  - `bug_report.yml`: For bug reports
  - Note: Repo uses GitHub for code hosting and CI; Azure DevOps for metrics tracking
- **Labels**: type (feature/story/bug), priority (P0/P1/P2), size (S/M/L), area, status
