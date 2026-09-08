import { test, expect, devices } from '@playwright/test';
import { collectErrors } from './_setup';

test.use({ ...devices['Pixel 7'] });

test('the app is usable on a phone-sized screen', async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() =>
      localStorage.setItem('nol.prefs.v1', JSON.stringify({ onboarded: true, beginnerMode: true })),
    );
    await page.goto('/');
    await expect(page.locator('app-csf-strip .csf').first()).toBeVisible({ timeout: 20_000 });

    // Nav is behind a hamburger.
    await expect(page.locator('.sidenav')).not.toBeInViewport();
    await page.locator('.menu-btn').click();
    await expect(page.locator('.sidenav')).toBeInViewport();
    await page.getByRole('link', { name: 'Reactor', exact: true }).click();
    await expect(page.locator('.sidenav')).not.toBeInViewport();
    await expect(page.locator('nol-reactor')).toBeVisible();

    // No horizontal overflow of the document.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);

    // Core controls are reachable and tap-sized.
    const runBox = await page.locator('#run-toggle').boundingBox();
    expect(runBox!.height).toBeGreaterThanOrEqual(28);

    expect(errors).toEqual([]);
  });
