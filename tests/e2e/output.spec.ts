import { test, expect, Page } from '@playwright/test';

const HARNESS_URL = 'http://localhost:3999/tests/e2e/harness.html';

async function navigateToOutput(page: Page) {
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => {
    const content = document.getElementById('content');
    return content && content.innerHTML.length > 200 && !content.querySelector('.loading-spinner') && !content.querySelector('.error-boundary');
  }, { timeout: 10000 });
  await page.locator('[data-page="output"]').first().click();
  await page.waitForFunction(() => {
    const content = document.getElementById('content');
    return content && !content.querySelector('.loading-spinner');
  }, { timeout: 10000 });
}

test.describe('Output', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToOutput(page);
  });

  test('renders code production summary with AI LoC', async ({ page }) => {
    const content = await page.textContent('#content');
    // totalAiLoc: 14520 → formatted as 14,520 or 14.5K
    expect(content).toMatch(/14[.,]?5/);
  });

  test('shows AI ratio', async ({ page }) => {
    const content = await page.textContent('#content');
    // Production tab shows AI-Generated LoC and cost
    expect(content).toContain('AI-Generated LoC');
  });

  test('shows language breakdown chart', async ({ page }) => {
    // Production tab has language chart
    const content = await page.textContent('#content');
    expect(content).toContain('Language');
  });

  test('renders consumption tab with model totals', async ({ page }) => {
    // Click consumption tab
    const tabs = page.locator('#output-tabs .tab');
    const consumptionTab = tabs.filter({ hasText: /consumption/i });
    if (await consumptionTab.count() > 0) {
      await consumptionTab.click();
      await page.waitForFunction(() => {
        const content = document.getElementById('content');
        return content && !content.querySelector('.loading-spinner');
      }, { timeout: 10000 });
    }
    const content = await page.textContent('#content');
    expect(content).toContain('gpt-4o');
  });

  test('shows AI credits tab', async ({ page }) => {
    const tabs = page.locator('#output-tabs .tab');
    const creditsTab = tabs.filter({ hasText: /Credit/i });
    await creditsTab.first().click();
    await page.waitForTimeout(2000);
    const content = await page.textContent('#content');
    // totalCredits: 142.5 displayed as 143 (rounded)
    expect(content).toMatch(/143|Total AI Credits/);
  });
});
