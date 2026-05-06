import { test, expect, Page } from '@playwright/test';

const HARNESS_URL = 'http://localhost:3999/tests/e2e/harness.html';

async function navigateToContextHealth(page: Page) {
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => {
    const content = document.getElementById('content');
    return content && content.innerHTML.length > 200 && !content.querySelector('.loading-spinner') && !content.querySelector('.error-boundary');
  }, { timeout: 10000 });
  await page.locator('[data-page="config-health"]').first().click();
  await page.waitForFunction(() => {
    const content = document.getElementById('content');
    return content && !content.querySelector('.loading-spinner') && content.innerHTML.length > 500 && !content.querySelector('.error-boundary');
  }, { timeout: 15000 });
  // Click the Context Management sub-tab
  const mgmtTab = page.locator('[data-tab="context-mgmt"]');
  if (await mgmtTab.count() > 0) {
    await mgmtTab.first().click();
    await page.waitForFunction(() => {
      const content = document.getElementById('content');
      return content && content.textContent.includes('Context Score') && !content.querySelector('.loading-spinner');
    }, { timeout: 15000 });
  }
}

test.describe('Context Management', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToContextHealth(page);
    // Click the Context Management sub-tab if present
    const mgmtTab = page.locator('[data-tab="context-mgmt"], button:has-text("Context Management")');
    if (await mgmtTab.count() > 0) {
      await mgmtTab.first().click();
      await page.waitForFunction(() => {
        const content = document.getElementById('content');
        return content && !content.querySelector('.loading-spinner');
      }, { timeout: 10000 });
    }
  });

  test('renders overall context score', async ({ page }) => {
    const content = await page.textContent('#content');
    // overallScore: 74
    expect(content).toContain('74');
  });

  test('shows workspace table with names', async ({ page }) => {
    const content = await page.textContent('#content');
    expect(content).toContain('my-api');
    expect(content).toContain('frontend-app');
  });

  test('shows compaction stats', async ({ page }) => {
    const content = await page.textContent('#content');
    // totalCompactions: 12
    expect(content).toContain('12');
  });

  test('workspace rows are clickable for drill-down', async ({ page }) => {
    // Click on a workspace row to expand
    const row = page.locator('tr:has-text("my-api"), [data-workspace="ws-1"]').first();
    await row.click();
    await page.waitForTimeout(1000);
    const content = await page.textContent('#content');
    expect(content).toMatch(/Local Agent|session|28|35/i);
  });

  test('shows CLI sessions without per-request token data', async ({ page }) => {
    const row = page.locator('tr:has-text("my-api"), [data-workspace="ws-1"]').first();
    await row.click();
    await page.waitForTimeout(1000);
    const content = await page.textContent('#content');
    expect(content).toContain('GitHub Copilot CLI');
  });

  test('shows sessions with per-request token data', async ({ page }) => {
    const row = page.locator('tr:has-text("my-api"), [data-workspace="ws-1"]').first();
    await row.click();
    await page.waitForTimeout(1000);
    const content = await page.textContent('#content');
    expect(content).toContain('Local Agent');
  });
});
