# Database Migration Guide

This document explains how database migrations work in DevSignals and how to safely make schema changes.

## Table of Contents

- [Overview](#overview)
- [How Migrations Work](#how-migrations-work)
- [Making Schema Changes](#making-schema-changes)
- [Preview → Production Workflow](#preview--production-workflow)
- [Breaking vs Non-Breaking Changes](#breaking-vs-non-breaking-changes)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

---

## Overview

DevSignals uses **GitHub Actions-based migrations** instead of runtime migrations. This approach:

- ✅ **Prevents race conditions** - Migrations run once, not per serverless instance
- ✅ **Enables preview testing** - Neon preview branches provide isolated databases
- ✅ **Ensures atomic deployments** - Failed migrations prevent deployment
- ✅ **Provides clear audit trail** - All migrations logged in GitHub Actions

**Key principle**: Migrations are a **deployment-time concern**, not a runtime concern.

---

## How Migrations Work

### Architecture

```
Developer creates PR
  ↓
Preview Workflow (.github/workflows/preview.yml)
  ├─ Create Neon preview branch
  ├─ Run migrations on preview database
  ├─ Run integration tests
  └─ Deploy to Vercel preview
  ↓
Team reviews PR (tests passing, preview works)
  ↓
PR merged to main
  ↓
Production Workflow (.github/workflows/production.yml)
  ├─ Run migrations on production database
  └─ Deploy to Vercel production
  ↓
Cleanup Workflow (.github/workflows/cleanup.yml)
  └─ Delete Neon preview branch
```

### Three GitHub Actions Workflows

1. **`preview.yml`** - Runs on PR open/update
   - Creates isolated Neon preview branch (e.g., `preview/pr-123`)
   - Runs `bun run drizzle-kit migrate` against preview database
   - Runs integration tests against migrated database
   - Deploys to Vercel preview environment
   - Comments on PR with preview URL and database info

2. **`production.yml`** - Runs on merge to main
   - Runs `bun run drizzle-kit migrate` against production database
   - Runs smoke tests to verify migration success
   - Deploys to Vercel production

3. **`cleanup.yml`** - Runs when PR closes
   - Deletes Neon preview branch
   - Vercel automatically archives preview deployments

### Why Not Runtime Migrations?

**Problem**: Using `instrumentation.ts` for migrations causes race conditions in serverless environments.

- Vercel deploys create multiple Lambda instances simultaneously
- Each instance runs `instrumentation.ts` on cold start
- Drizzle ORM lacks advisory locking (unlike Prisma)
- Result: Multiple instances try to apply migrations concurrently → undefined behavior

**Solution**: GitHub Actions runs migrations **once** before deployment, in a controlled single-process environment.

---

## Making Schema Changes

### Step 1: Update Schema

Edit `src/lib/db/schema.ts` with your changes:

```typescript
// Example: Add a new column
export const pullRequests = pgTable(
  "pull_requests",
  {
    // ... existing columns
    reviewerCount: integer("reviewer_count"), // New column
  }
);
```

### Step 2: Generate Migration

```bash
bun run drizzle-kit generate
```

This creates a new migration file in `drizzle/migrations/` with:
- SQL statements to apply changes
- Timestamp-based filename (e.g., `0003_amazing_hulk.sql`)

### Step 3: Test Locally (Optional)

```bash
# Apply migration to your local database
bun run drizzle-kit migrate

# Or test in Drizzle Studio
bun run drizzle-kit studio
```

### Step 4: Commit Migration Files

```bash
git add drizzle/migrations/0003_*.sql src/lib/db/schema.ts
git commit -m "feat(db): add reviewer_count column to pull_requests"
```

### Step 5: Open Pull Request

```bash
git push origin your-branch-name
# Create PR on GitHub
```

The **preview workflow** will automatically:
1. Create a Neon preview branch
2. Apply your migration to the preview database
3. Run tests to verify schema changes work
4. Deploy a preview environment

### Step 6: Verify Preview

- Check the PR comment for preview URL and database info
- Test the preview deployment
- Verify integration tests pass
- Review the migration SQL in the GitHub Actions log

### Step 7: Merge to Production

When PR is merged to `main`, the **production workflow** will:
1. Apply migrations to production database
2. Run smoke tests
3. Deploy to Vercel production

---

## Preview → Production Workflow

### What Happens in Preview

**Neon creates an isolated database branch:**
- Branch name: `preview/pr-{number}`
- Based on production schema
- Completely isolated (changes don't affect production)
- Automatic cleanup when PR closes

**Migration testing:**
- Migrations run on preview database first
- Integration tests verify schema changes work
- Catch issues before production deployment

### What Happens in Production

**When you merge the PR:**
- GitHub Actions runs migrations against production database
- Same migration files, same SQL
- Vercel deployment waits for migrations to complete
- Failed migrations = no deployment (atomic)

**No manual promotion needed:**
- Merging PR **is** the promotion
- No separate "apply migrations" step
- Fully automated pipeline

---

## Breaking vs Non-Breaking Changes

### Non-Breaking Changes (Safe for Continuous Deployment)

✅ **Adding new tables**
```sql
CREATE TABLE new_table (...);
```

✅ **Adding new columns with defaults**
```sql
ALTER TABLE pull_requests ADD COLUMN reviewer_count INTEGER DEFAULT 0;
```

✅ **Adding indexes**
```sql
CREATE INDEX idx_reviewer_count ON pull_requests(reviewer_count);
```

✅ **Adding constraints with defaults**
```sql
ALTER TABLE pull_requests ADD COLUMN status TEXT DEFAULT 'pending';
```

**Deploy flow**: Run migration → Deploy code immediately

---

### Breaking Changes (Requires Multi-Step Deployment)

❌ **Renaming columns**
❌ **Removing columns**
❌ **Changing column types**
❌ **Adding NOT NULL without defaults**

**Solution**: Use the **Expand-Contract Pattern**

#### Example: Renaming a Column

**Step 1: Expand** (Add new column alongside old)
```sql
-- Migration 1
ALTER TABLE pull_requests ADD COLUMN merged_at_utc TIMESTAMP;

-- Copy data
UPDATE pull_requests SET merged_at_utc = merged_at;
```

```typescript
// Code writes to BOTH columns
await db.insert(pullRequests).values({
  mergedAt: new Date(),      // Old column (keep)
  mergedAtUtc: new Date(),   // New column
});
```

Deploy this change. Wait for rollout to complete.

**Step 2: Contract** (Remove old column)
```sql
-- Migration 2 (separate PR, after Step 1 is deployed)
ALTER TABLE pull_requests DROP COLUMN merged_at;
```

```typescript
// Code only uses new column
await db.insert(pullRequests).values({
  mergedAtUtc: new Date(),   // Only new column
});
```

Deploy this change.

---

## Rollback Procedures

### Scenario 1: Migration Failed in Preview

**Symptoms**: Preview workflow fails, PR shows failed checks

**Solution**:
1. Check GitHub Actions log for error details
2. Fix the schema or migration SQL
3. Commit fix and push
4. Preview workflow re-runs automatically

**No production impact** - preview databases are isolated.

### Scenario 2: Migration Failed in Production

**Symptoms**: Production workflow fails before deployment

**Solution**:
1. **Don't panic** - Vercel deployment is blocked, production still running old code
2. Check GitHub Actions log for error
3. Create a revert commit:
   ```bash
   git revert HEAD
   git push origin main
   ```
4. Or push a hotfix that fixes the migration

**Key**: Failed migrations prevent deployment, so production schema is unchanged.

### Scenario 3: Migration Succeeded, But Code Breaks Production

**Symptoms**: Migration applied successfully, but deployed code has bugs

**Solution**:
1. **Immediate**: Revert via Vercel dashboard (instant rollback to previous deployment)
2. **Fix forward**: Create new PR with fix, merge to deploy
3. **Schema rollback** (if needed):
   - Create new migration that undoes changes
   - Deploy via normal PR workflow

**Avoid manual database changes** - always use migrations for audit trail.

---

## Troubleshooting

### Migration Timeout in GitHub Actions

**Error**: `Migration timed out after 30s`

**Causes**:
- Large data migration
- Missing index causing slow queries
- Database under load

**Solutions**:
```typescript
// For large data migrations, use batching
const batchSize = 1000;
const chunks = chunk(allRecords, batchSize);

for (const chunk of chunks) {
  await db.update(table).set({ ... }).where(...);
  await new Promise(resolve => setTimeout(resolve, 100)); // Brief pause
}
```

### Neon Preview Branch Not Created

**Error**: `Failed to create Neon branch`

**Causes**:
- Invalid `NEON_API_KEY` secret
- Neon project quota exceeded
- Branch already exists

**Solutions**:
1. Verify GitHub secrets are set correctly
2. Check Neon dashboard for branch limits
3. Delete stale branches manually if needed

### Migration Applied Locally But Not in Preview

**Error**: Preview workflow shows migration already applied

**Cause**: Migration was run locally first, then Drizzle metadata table was pushed to preview branch

**Solution**:
```bash
# Don't run migrations locally for preview testing
# Let GitHub Actions handle it

# If you need to test, use a separate local database
DATABASE_URL="postgresql://local-test-db-url" bun run drizzle-kit migrate
```

### Tests Pass Locally But Fail in Preview

**Cause**: Test data fixtures may not account for new schema

**Solution**:
1. Update test factories to include new columns
2. Add migration-specific tests
3. Run integration tests locally before pushing:
   ```bash
   bun test src/__tests__/integration/
   ```

---

## Best Practices

### DO ✅

- Test migrations on preview branches before merging
- Use Drizzle's `migrate` function (not manual SQL)
- Keep migrations small and focused
- Add comments to complex migrations
- Use expand-contract for breaking changes
- Let GitHub Actions handle migrations automatically

### DON'T ❌

- Run migrations manually in production
- Skip preview testing for schema changes
- Make breaking changes without multi-step deployment
- Modify migration files after they're committed
- Use `instrumentation.ts` for migrations (causes race conditions)
- Bypass GitHub Actions workflows

---

## Required GitHub Secrets

Ensure these secrets are configured in **Settings → Secrets and variables → Actions**:

| Secret | Description | Where to Get It |
|--------|-------------|-----------------|
| `NEON_API_KEY` | Neon API key for preview branches | [Neon Console](https://console.neon.tech/app/settings/api-keys) |
| `NEON_PROJECT_ID` | Your Neon project ID | Neon project URL or dashboard |
| `PRODUCTION_DATABASE_URL` | Production database connection string | Neon production branch |
| `VERCEL_TOKEN` | Vercel deployment token | [Vercel Settings](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | Vercel organization ID | Vercel project settings |
| `VERCEL_PROJECT_ID` | Vercel project ID | Vercel project settings |

---

## Further Reading

- [Drizzle ORM Migrations](https://orm.drizzle.team/docs/migrations)
- [Neon Branching](https://neon.tech/docs/guides/branching)
- [Vercel GitHub Integration](https://vercel.com/docs/deployments/git)
- [Expand-Contract Pattern](https://www.tim-wellhausen.de/papers/ExpandAndContract.pdf)
