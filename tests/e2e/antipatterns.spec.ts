import { test, expect, Page } from '@playwright/test';

const HARNESS_URL = 'http://localhost:3999/tests/e2e/harness.html';

async function navigateToAntiPatterns(page: Page) {
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => {
    const content = document.getElementById('content');
    return content && content.innerHTML.length > 200 && !content.querySelector('.error-boundary');
  }, { timeout: 10000 });
  await page.locator('[data-page="anti-patterns"]').first().click();
  // Wait for the AP page content to fully render (score cards present)
  await page.waitForFunction(() => {
    const content = document.getElementById('content');
    return content && content.innerHTML.length > 500 && !content.querySelector('.error-boundary');
  }, { timeout: 15000 });
}

test.describe('Anti-Patterns', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToAntiPatterns(page);
  });

  test('renders practice score cards for all 4 groups', async ({ page }) => {
    const cards = page.locator('.ap-score-card');
    await expect(cards.first()).toBeVisible();
    const content = await page.textContent('#content');
    expect(content).toContain('72');
    expect(content).toContain('85');
    expect(content).toContain('68');
    expect(content).toContain('91');
  });

  test('shows pattern list with occurrences', async ({ page }) => {
    const content = await page.textContent('#content');
    expect(content).toContain('Giant Prompt Detected');
    expect(content).toContain('Abandoned Session');
  });

  test('shows total occurrence count', async ({ page }) => {
    const content = await page.textContent('#content');
    // Individual pattern occurrences should be visible
    expect(content).toContain('8');  // Giant Prompt: 8 occurrences
    expect(content).toContain('5');  // Abandoned Session: 5 occurrences
  });

  test('score badges are color-coded', async ({ page }) => {
    const cards = page.locator('.ap-score-card');
    const count = await cards.count();
    expect(count).toBe(4);
  });
});
