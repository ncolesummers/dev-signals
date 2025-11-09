# DevSignals

**Engineering metrics dashboard for diagnosing why we ship slowly.**

DevSignals tracks DORA metrics and flow diagnostics to help teams understand delivery bottlenecks in one-week sprints. Built with Next.js 16, Bun, TypeScript, and Neon Postgres.

---

## 📊 What We Track

### DORA Metrics
- **Deployment Frequency** - How often we ship to production
- **Lead Time for Changes** - Time from commit to production
- **Change Failure Rate** - % of deployments that fail *(stubbed in MVP)*
- **Mean Time to Recovery (MTTR)** - Time to restore after failure *(stubbed in MVP)*

### Flow Diagnostics
- **PR Cycle Time** - Time from PR open to merge (p50/p90)
- **PR Review Wait** - Time to first review (p50/p90)
- **PR Size Distribution** - Breakdown by lines changed
- **% Merged by Wednesday** - Sprint health indicator
- **Flaky Test Rate** - Pipeline reliability
- **Failed Pipeline Runs** - Build quality

### Ritual Aids
- **Reviewer SLA** - % of PRs reviewed within 24h
- **Blocked PR Panel** - PRs stuck or waiting

📖 **See [METRICS_DEFINITIONS.md](./METRICS_DEFINITIONS.md) for detailed definitions and targets.**

---

## 🚀 Quick Start

### Prerequisites
- **Bun** 1.3+ ([install](https://bun.sh))
- **Node.js** 20+ (for tooling compatibility)
- **Neon Postgres** account ([sign up](https://neon.tech))
- **Azure DevOps Personal Access Token (PAT)** with appropriate permissions

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/ncolesummers/dev-signals.git
   cd dev-signals
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` and add:
   - `DATABASE_URL` - Your Neon Postgres connection string
   - `AZURE_DEVOPS_PAT` - Azure DevOps Personal Access Token
   - `AZURE_DEVOPS_ORG` - Your Azure DevOps organization name
   - (Optional) `AZURE_DEVOPS_EXCLUDE_PROJECTS` - Comma-separated list of projects to exclude

   **Note:** Projects are automatically discovered from your Azure DevOps organization.

4. **Set up the database**
   ```bash
   # Generate migration
   bun run drizzle-kit generate

   # Run migration
   bun run drizzle-kit migrate
   ```

5. **Run the development server**
   ```bash
   bun dev
   ```

   Open [http://localhost:3000](http://localhost:3000) to see the app.

   **Health check:** [http://localhost:3000/api/health](http://localhost:3000/api/health)

---

## 🏗️ Tech Stack

| Category | Technology |
|----------|-----------|
| **Framework** | Next.js 16 (App Router) |
| **Runtime** | Bun |
| **Language** | TypeScript |
| **Database** | Neon Postgres + Drizzle ORM |
| **Styling** | Tailwind CSS v4 |
| **Components** | shadcn/ui |
| **Linting** | Biome |
| **CI/CD** | GitHub Actions (this repo) |
| **Metrics Source** | Azure DevOps (multi-project tracking) |
| **Testing** | Vitest (unit) + Playwright (E2E) |

---

## 🧪 Testing

### Unit Tests
```bash
# Run tests
bun test

# Run with coverage (60% threshold)
bun test --coverage
```

### E2E Tests (Playwright)
```bash
# Install Playwright browsers
bunx playwright install

# Run E2E tests
bunx playwright test

# Run in UI mode
bunx playwright test --ui
```

### Accessibility Tests
```bash
# Included in Playwright tests
bunx playwright test --grep "accessibility"
```

---

## 🛠️ Development

### Project Structure
```
dev-signals/
├── src/
│   ├── app/              # Next.js App Router pages & API routes
│   │   ├── api/health/   # Health check endpoint
│   │   └── page.tsx      # Home page
│   ├── components/       # React components
│   │   └── ui/           # shadcn/ui components
│   ├── lib/              # Utilities and business logic
│   │   ├── db/           # Database schema & client
│   │   ├── metrics/      # Metrics calculation functions
│   │   └── ingestion/    # Data ingestion from Azure DevOps
│   └── hooks/            # Custom React hooks
├── .github/
│   ├── ISSUE_TEMPLATE/   # User story & bug report templates
│   └── workflows/        # CI/CD workflows
├── drizzle/              # Database migrations
├── METRICS_DEFINITIONS.md # Comprehensive metrics documentation
└── package.json
```

### Available Scripts
```bash
bun dev          # Start development server
bun build        # Build for production
bun start        # Start production server
bun lint         # Run Biome linter
bun format       # Format code with Biome
bun test         # Run unit tests
```

### Database Migrations
```bash
# Create a new migration after schema changes
bun run drizzle-kit generate

# Apply migrations
bun run drizzle-kit migrate

# Open Drizzle Studio (database GUI)
bun run drizzle-kit studio
```

---

## 📋 Project Management

- **Codebase:** This repo is hosted on [GitHub](https://github.com/ncolesummers/dev-signals)
- **Metrics Tracking:** Aggregates engineering metrics from Azure DevOps projects
- **Issue Tracking:** [Issues](https://github.com/ncolesummers/dev-signals/issues)
- **Milestones:** MVP (F1-F4), Enhancements (F5-F7)

**Architecture Note:** This dashboard repo uses GitHub for code hosting and CI/CD, but tracks PR/deployment metrics from Azure DevOps organizations and projects.

### Issue Labels
We use a comprehensive labeling system:
- **Type:** `feature`, `story`, `bug`, `chore`
- **Priority:** `priority:P0` (critical), `priority:P1` (high), `priority:P2` (medium)
- **Size:** `size:S` (1-2 days), `size:M` (3-5 days), `size:L` (5+ days)
- **Area:** `area:ingestion`, `area:calc`, `area:dashboard`, `area:tests`, etc.
- **Status:** `status:blocked`, `status:needs-design`, `status:ready`

---

## 🤝 Contributing

1. Pick a story from the [backlog](https://github.com/ncolesummers/dev-signals/issues?q=is%3Aissue+is%3Aopen+label%3Astory)
2. Create a feature branch: `git checkout -b US1.1-scaffold-app`
3. Implement the story following acceptance criteria
4. Write tests (unit + E2E)
5. Ensure CI passes (lint, typecheck, tests)
6. Create a PR with reference to the story issue

### Code Quality Standards
- **Coverage:** Maintain ≥ 60% test coverage
- **Linting:** All code must pass Biome checks
- **Types:** Strict TypeScript, no `any` types
- **Accessibility:** All UI must pass axe checks

---

## 🚢 Deployment

### Vercel (Recommended)
1. Push to `main` branch
2. Vercel auto-deploys from GitHub
3. Add environment variables in Vercel dashboard
4. Database migrations run automatically via `postbuild` script

### Manual Deployment
```bash
# Build the app
bun run build

# Start production server
bun start
```

---

## 📚 Documentation

- **[METRICS_DEFINITIONS.md](./METRICS_DEFINITIONS.md)** - Comprehensive metrics documentation
- **[.env.example](./.env.example)** - Environment variable template
- **[GitHub Issues](https://github.com/ncolesummers/dev-signals/issues)** - User stories and bugs

---

## 🐛 Troubleshooting

### Database Connection Issues
```bash
# Verify DATABASE_URL is set
echo $DATABASE_URL

# Test connection
bun run drizzle-kit studio
```

### Build Failures
```bash
# Clear cache and reinstall
rm -rf .next node_modules
bun install
bun build
```

### CI Failures
- Check [GitHub Actions](https://github.com/ncolesummers/dev-signals/actions) for logs
- Ensure all tests pass locally before pushing
- Verify Biome linting: `bun run lint`

---

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details.

---

## 🙏 Acknowledgments

Built with:
- [Next.js](https://nextjs.org) by Vercel
- [Bun](https://bun.sh) by Jarred Sumner
- [shadcn/ui](https://ui.shadcn.com) by shadcn
- [Drizzle ORM](https://orm.drizzle.team) by Drizzle Team
- [Neon](https://neon.tech) for serverless Postgres

---

**Questions?** Open an [issue](https://github.com/ncolesummers/dev-signals/issues/new/choose) or check the [project board](https://github.com/users/ncolesummers/projects/5).
