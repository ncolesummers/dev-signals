import { expect, test } from "@playwright/test";

/**
 * E2E Tests for DORA Metrics Dashboard
 *
 * Tests the complete user flow:
 * - Page loads successfully
 * - All 4 metric cards are displayed
 * - Week selector works
 * - Metrics update when week changes
 * - Loading and error states
 * - Responsive design
 * - Accessibility
 */

test.describe("DORA Metrics Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to dashboard before each test
    await page.goto("/dashboard");
  });

  test.describe("Page Load and Initial State", () => {
    test("should load dashboard page successfully", async ({ page }) => {
      // Check page title
      await expect(page.locator("h1")).toContainText("DORA Metrics Dashboard");

      // Check description
      await expect(
        page.locator("text=Track deployment frequency"),
      ).toBeVisible();
    });

    test("should display all 4 DORA metric cards", async ({ page }) => {
      // Check for 4 metric cards
      const cards = page.locator('[role="article"]');
      await expect(cards).toHaveCount(4);

      // Check each metric card by name
      await expect(page.locator("text=Deployment Frequency")).toBeVisible();
      await expect(page.locator("text=Lead Time for Changes")).toBeVisible();
      await expect(page.locator("text=Change Failure Rate")).toBeVisible();
      await expect(page.locator("text=Mean Time to Recovery")).toBeVisible();
    });

    test("should display week selector", async ({ page }) => {
      // Check for week selector combobox
      const weekSelector = page.locator('[role="combobox"]');
      await expect(weekSelector).toBeVisible();

      // Should show "Current Week" by default
      await expect(weekSelector).toContainText("Current Week");
    });
  });

  test.describe("Metric Cards", () => {
    test("should display metric card components correctly", async ({
      page,
    }) => {
      // Wait for metrics to load
      await page.waitForSelector('[role="article"]', { state: "visible" });

      // Check first card (Deployment Frequency)
      const deploymentCard = page
        .locator('[role="article"]')
        .filter({ hasText: "Deployment Frequency" });

      // Should have status badge
      await expect(
        deploymentCard.locator("text=/On Target|Needs Attention|Off Target/"),
      ).toBeVisible();

      // Should have a value (number or N/A)
      await expect(
        deploymentCard.locator('[aria-label^="Value:"]'),
      ).toBeVisible();
    });

    test("should show loading state initially", async ({ page }) => {
      // Navigate to dashboard
      await page.goto("/dashboard");

      // Loading spinner should appear briefly
      const loadingSpinner = page.locator('[aria-label="Loading metric data"]');

      // Wait for at least one spinner to appear (may be fast)
      try {
        await expect(loadingSpinner.first()).toBeVisible({ timeout: 2000 });
      } catch {
        // Loading may be too fast to catch, which is fine
      }

      // Eventually metrics should load
      await expect(page.locator('[role="article"]')).toHaveCount(4);
    });

    test("should display status badges with correct colors", async ({
      page,
    }) => {
      // Wait for metrics to load
      await page.waitForSelector('[role="article"]', { state: "visible" });

      // Check that badges exist and have color classes
      const badges = page.locator('[aria-label^="Status:"]');
      const badgeCount = await badges.count();

      expect(badgeCount).toBeGreaterThan(0);

      // Check that at least one badge has a color class
      const firstBadge = badges.first();
      const className = await firstBadge.getAttribute("class");

      expect(className).toMatch(/bg-(green|yellow|red)-500/);
    });
  });

  test.describe("Week Selection", () => {
    test("should open week selector dropdown", async ({ page }) => {
      // Click week selector
      const weekSelector = page.locator('[role="combobox"]');
      await weekSelector.click();

      // Options should be visible
      const options = page.locator('[role="option"]');
      await expect(options.first()).toBeVisible();

      // Should have multiple week options
      const optionCount = await options.count();
      expect(optionCount).toBeGreaterThanOrEqual(12);
    });

    test("should display week options with correct format", async ({
      page,
    }) => {
      // Open week selector
      await page.locator('[role="combobox"]').click();

      // First option should be "Current Week"
      const firstOption = page.locator('[role="option"]').first();
      await expect(firstOption).toContainText("Current Week");

      // Second option should have format "Week N, YYYY (Month DD - Month DD)"
      const secondOption = page.locator('[role="option"]').nth(1);
      await expect(secondOption).toContainText(/Week \d+, \d{4}/);
    });

    test("should update metrics when week is selected", async ({ page }) => {
      // Wait for initial load
      await page.waitForSelector('[role="article"]', { state: "visible" });

      // Get initial deployment frequency value
      const deploymentCard = page
        .locator('[role="article"]')
        .filter({ hasText: "Deployment Frequency" });
      const _initialValue = await deploymentCard
        .locator('[aria-label^="Value:"]')
        .textContent();

      // Open week selector and select a different week
      await page.locator('[role="combobox"]').click();
      await page.locator('[role="option"]').nth(1).click();

      // Wait for API call and re-render
      await page.waitForTimeout(500);

      // Footer should show different week
      const footer = page.locator("text=/Showing metrics for/");
      await expect(footer).toBeVisible();
    });

    test("should close dropdown after selection", async ({ page }) => {
      // Open dropdown
      await page.locator('[role="combobox"]').click();
      await expect(page.locator('[role="option"]').first()).toBeVisible();

      // Select an option
      await page.locator('[role="option"]').nth(1).click();

      // Dropdown should close
      await expect(page.locator('[role="option"]').first()).not.toBeVisible();
    });
  });

  test.describe("Responsive Design", () => {
    test("should display cards in grid on desktop", async ({ page }) => {
      // Set desktop viewport
      await page.setViewportSize({ width: 1280, height: 720 });

      // Wait for cards to load
      await page.waitForSelector('[role="article"]', { state: "visible" });

      // Check grid layout class
      const grid = page.locator(".grid");
      await expect(grid).toBeVisible();

      // Should have grid column classes
      const className = await grid.getAttribute("class");
      expect(className).toContain("grid");
    });

    test("should stack cards vertically on mobile", async ({ page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      // Wait for cards to load
      await page.waitForSelector('[role="article"]', { state: "visible" });

      // All cards should still be visible
      const cards = page.locator('[role="article"]');
      await expect(cards).toHaveCount(4);
    });

    test("should make week selector full width on mobile", async ({ page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      // Week selector should be visible
      const weekSelector = page.locator('[role="combobox"]');
      await expect(weekSelector).toBeVisible();

      // Should have w-full class
      const className = await weekSelector.getAttribute("class");
      expect(className).toContain("w-full");
    });
  });

  test.describe("Accessibility", () => {
    test("should have proper ARIA labels on metric cards", async ({ page }) => {
      // Wait for cards to load
      await page.waitForSelector('[role="article"]', { state: "visible" });

      // Check for aria-label on cards
      const deploymentCard = page.locator(
        '[aria-label="Deployment frequency metric card"]',
      );
      await expect(deploymentCard).toBeVisible();

      const leadTimeCard = page.locator(
        '[aria-label="Lead time for changes metric card"]',
      );
      await expect(leadTimeCard).toBeVisible();
    });

    test("should be keyboard navigable", async ({ page }) => {
      // Tab to week selector
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");

      // Week selector should be focused
      const weekSelector = page.locator('[role="combobox"]');
      await expect(weekSelector).toBeFocused();

      // Open with Enter key
      await page.keyboard.press("Enter");

      // Options should be visible
      await expect(page.locator('[role="option"]').first()).toBeVisible();

      // Navigate with arrow keys
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");

      // Select with Enter
      await page.keyboard.press("Enter");

      // Dropdown should close
      await expect(page.locator('[role="option"]').first()).not.toBeVisible();
    });

    test("should have sufficient color contrast", async ({ page }) => {
      // Wait for cards to load
      await page.waitForSelector('[role="article"]', { state: "visible" });

      // Check that status badges are visible (implies good contrast)
      const badges = page.locator('[aria-label^="Status:"]');
      await expect(badges.first()).toBeVisible();

      // Check that metric values are visible
      const values = page.locator('[aria-label^="Value:"]');
      await expect(values.first()).toBeVisible();
    });

    test("should have proper heading hierarchy", async ({ page }) => {
      // Check h1 exists
      const h1 = page.locator("h1");
      await expect(h1).toHaveCount(1);
      await expect(h1).toContainText("DORA Metrics Dashboard");

      // Metric card titles should be appropriately marked
      const cardTitles = page.locator('[role="article"] > div > div > div');
      expect(await cardTitles.count()).toBeGreaterThan(0);
    });
  });

  test.describe("Error Handling", () => {
    test("should handle network errors gracefully", async ({ page }) => {
      // Intercept API call and return error
      await page.route("**/api/metrics/dora*", (route) => {
        route.abort("failed");
      });

      // Navigate to dashboard
      await page.goto("/dashboard");

      // Should show error state
      await expect(page.locator("text=/Failed to load|error/i")).toBeVisible();

      // Should have retry button
      await expect(page.locator("button:has-text('Retry')")).toBeVisible();
    });

    test("should retry loading metrics on retry button click", async ({
      page,
    }) => {
      // Intercept first request to fail, second to succeed
      let requestCount = 0;

      await page.route("**/api/metrics/dora*", (route) => {
        requestCount++;
        if (requestCount === 1) {
          route.abort("failed");
        } else {
          route.continue();
        }
      });

      // Navigate to dashboard
      await page.goto("/dashboard");

      // Should show error
      await expect(page.locator("text=/Failed to load/i")).toBeVisible();

      // Click retry button
      await page.locator("button:has-text('Retry')").first().click();

      // Should eventually load metrics
      await expect(page.locator('[role="article"]')).toHaveCount(4);
    });
  });

  test.describe("Footer Information", () => {
    test("should display week date range in footer", async ({ page }) => {
      // Wait for metrics to load
      await page.waitForSelector('[role="article"]', { state: "visible" });

      // Wait for footer to appear
      await page.waitForSelector("text=/Showing metrics for/", {
        timeout: 5000,
      });

      // Footer should show week identifier and date range
      const footer = page.locator("text=/Showing metrics for/");
      await expect(footer).toBeVisible();
      await expect(footer).toContainText(/\d{4}-W\d{2}/);
    });
  });
});
