import { test, expect, Page } from '@playwright/test';

const HARNESS_URL = 'http://localhost:3999/tests/e2e/harness.html';

async function navigateToTimeline(page: Page) {
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => {
    const content = document.getElementById('content');
    return content && content.innerHTML.length > 200 && !content.querySelector('.loading-spinner') && !content.querySelector('.error-boundary');
  }, { timeout: 10000 });
  await page.locator('[data-page="timeline"]').first().click();
  await page.waitForFunction(() => {
    const content = document.getElementById('content');
    return content && !content.querySelector('.loading-spinner') && content.innerHTML.length > 200;
  }, { timeout: 10000 });
}

test.describe('Timeline', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToTimeline(page);
  });

  test('renders timeline sessions', async ({ page }) => {
    const content = await page.textContent('#content');
    expect(content).toContain('my-api');
  });

  test('shows session count', async ({ page }) => {
    const content = await page.textContent('#content');
    // 5 sessions in the mock
    expect(content).toContain('5');
  });

  test('shows workspace names', async ({ page }) => {
    const content = await page.textContent('#content');
    expect(content).toContain('frontend-app');
  });

  test('navigation controls visible', async ({ page }) => {
    // Should have prev/next day navigation
    const content = await page.textContent('#content');
    expect(content).toMatch(/May|2026|prev|next|←|→/i);
  });
});
