# Test Preview Workflow

This file exists solely to test the GitHub Actions preview workflow.

When this PR is opened, the workflow should:
1. Create a Neon preview branch (`preview/pr-{number}`)
2. Run database migrations on the preview branch
3. Run integration tests against the preview database
4. Deploy to Vercel preview environment
5. Comment on the PR with preview URL and database info

**Expected outcome**: PR comment with preview deployment URL and Neon preview branch details.

This file can be deleted after the test is successful.
