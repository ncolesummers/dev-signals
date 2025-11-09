# DevSignals Metrics Definitions

This document defines all metrics tracked by DevSignals and their calculation methods.

## Purpose

DevSignals helps diagnose why we ship slowly in one-week sprints by tracking **team and system metrics only** (not individual performance). All metrics use **medians and p90** aggregations to understand typical and worst-case performance.

---

## DORA Metrics

### 1. Deployment Frequency
**What:** How often we deploy to production
**Why:** Higher deployment frequency indicates better flow and smaller batch sizes
**Calculation:** Count of successful deployments to production per week
**Target:** Daily (5+ per week)
**Data source:** `deployments` table where `environment = 'production'` and `status = 'success'`

### 2. Lead Time for Changes
**What:** Time from first commit to production deployment
**Why:** Shorter lead time means faster value delivery
**Calculation:** Median and p90 of `(deployment.completedAt - pr.createdAt)` for merged PRs
**Target:** < 1 day (median), < 3 days (p90)
**Data source:** `deployments.completedAt - pull_requests.createdAt` for merged PRs
**Notes:**
- Only count PRs that were actually deployed (linked via `deployments.relatedPRs`)
- Exclude draft PRs and PRs merged to non-main branches

### 3. Change Failure Rate (CFR)
**What:** Percentage of deployments that fail or require rollback
**Why:** Lower CFR indicates higher quality and better testing
**Calculation:** `(failed deployments / total deployments) * 100`
**Target:** < 15%
**Data source:** `deployments` table where `isFailed = true` or `isRollback = true`
**Notes:** Stub early in MVP - will be refined based on incident tracking

### 4. Mean Time to Recovery (MTTR)
**What:** Time to restore service after a failed deployment
**Why:** Lower MTTR indicates better incident response
**Calculation:** Median and p90 of `(deployment.recoveredAt - deployment.completedAt)` for failed deployments
**Target:** < 1 hour
**Data source:** `deployments.recoveredAt - deployments.completedAt` for failed deployments
**Notes:** Stub early in MVP - requires incident tracking and recovery timestamps

---

## Flow Diagnostic Metrics

### 5. PR Cycle Time
**What:** Total time from PR open to merge
**Why:** Identifies bottlenecks in the review and merge process
**Calculation:** Median and p90 of `(pr.mergedAt - pr.createdAt)` for merged PRs
**Target:** < 4 hours (median), < 1 day (p90)
**Data source:** `pull_requests.mergedAt - pull_requests.createdAt`
**Filters:** Exclude draft PRs, only include merged PRs

### 6. PR Review Wait Time
**What:** Time from PR open to first review
**Why:** Long wait times indicate reviewer availability issues
**Calculation:** Median and p90 of `(pr.firstReviewAt - pr.createdAt)`
**Target:** < 2 hours (median), < 8 hours (p90)
**Data source:** `pull_requests.firstReviewAt - pull_requests.createdAt`
**Counter-metric:** Reviewer load (number of PRs per reviewer)

### 7. PR Size Distribution
**What:** Distribution of PR sizes by lines changed
**Why:** Smaller PRs are easier to review and less risky
**Calculation:** Histogram of `(pr.additions + pr.deletions)` in buckets:
- XS: 0-50 lines
- S: 51-200 lines
- M: 201-500 lines
- L: 501-1000 lines
- XL: 1000+ lines
**Target:** 80% of PRs are S or smaller
**Data source:** `pull_requests.additions + pull_requests.deletions`

### 8. Percentage Merged by Wednesday
**What:** What % of PRs opened Monday-Tuesday are merged by Wednesday EOD
**Why:** Indicates if we're on track to ship by end of week
**Calculation:** `(PRs merged by Wed / PRs opened Mon-Tue) * 100`
**Target:** > 70%
**Data source:** `pull_requests` filtered by created/merged timestamps and week boundaries
**Notes:** Week starts on **Monday** (configurable)

### 9. Flaky Test Rate
**What:** Percentage of CI runs that fail due to flaky tests
**Why:** Flaky tests slow down development and erode trust in CI
**Calculation:** `(flaky CI runs / total CI runs) * 100`
**Target:** < 5%
**Data source:** `ci_runs.isFlaky = true`
**Notes:** Requires manual flagging or pattern detection for flaky failures

### 10. Failed Pipeline Runs
**What:** Percentage of CI pipeline runs that fail
**Why:** High failure rate indicates code quality or infrastructure issues
**Calculation:** `(failed CI runs / total CI runs) * 100`
**Target:** < 20%
**Data source:** `ci_runs.status = 'failure'`

---

## Ritual Aid Metrics

### 11. Reviewer SLA: % < 24 hours
**What:** Percentage of PRs that receive first review within 24 hours
**Why:** Supports sprint rituals and keeps work flowing
**Calculation:** `(PRs with firstReviewAt within 24h / total PRs) * 100`
**Target:** > 80%
**Data source:** `pull_requests` where `(firstReviewAt - createdAt) < 24 hours`

### 12. Blocked PR Panel
**What:** List of PRs currently blocked (by label or staleness)
**Why:** Makes blockers visible for daily standup
**Calculation:** List of PRs with `labels` containing "blocked" OR open > 3 days with no reviews
**Target:** 0 blocked PRs
**Data source:** `pull_requests` filtered by labels and timestamps

---

## Counter-Metric Guardrails

To prevent gaming metrics, we track these counter-metrics:

| Primary Metric | Counter-Metric | Why |
|----------------|----------------|-----|
| PR Cycle Time | PR Size | Avoid tiny PRs that are trivial |
| PR Review Wait | Reviewer Load | Ensure reviews aren't rushed |
| Deployment Frequency | Change Failure Rate | Avoid shipping broken code |
| Lead Time | Test Coverage | Don't skip testing to ship faster |

---

## Calculation Schedule

- **Real-time:** Dashboard queries calculate on-demand for current week
- **Batch:** Weekly aggregation runs every Monday at midnight (configurable via `METRICS_CALCULATION_CRON`)
- **Retention:** Keep raw data for 90 days, aggregated metrics for 1 year

---

## Data Quality

### Required Fields
All metrics calculations must handle missing data gracefully:
- PRs without `firstReviewAt` are excluded from review wait time
- Deployments without `relatedPRs` are excluded from lead time
- CI runs without `conclusion` are treated as in-progress

### Time Zones
All timestamps stored in UTC. Week boundaries calculated based on `WEEK_START_DAY` environment variable.

---

## Metric Evolution

This is v1.0 of the metrics definitions. As we learn what matters, we will:
1. Add new metrics based on sprint retrospectives
2. Deprecate metrics that don't drive action
3. Refine targets based on historical data

**Last updated:** 2025-01-08
