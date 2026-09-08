import { test, expect } from '@playwright/test';
import { collectErrors } from './_setup';

test('first-time visitor sees the welcome screen and can take the guided tour', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/'); // no pref set: fresh visitor

  await expect(page.locator('app-welcome')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Take the 2-minute tour/ }).click();
  await expect(page.locator('app-welcome')).toHaveCount(0);

  // The tour overlay is up and drives the user.
  const card = page.locator('app-guide-overlay .card');
  await expect(card).toBeVisible();
  await expect(card.locator('.prog')).toContainText('/');

  // Advance to the "Press RUN" step, then press RUN and confirm it auto-advances.
  await card.getByRole('button', { name: 'Next' }).click();
  await expect(card).toContainText(/Press RUN/i);
  const before = await card.locator('.prog').innerText();
  await page.locator('#run-toggle').click();
  await expect.poll(async () => card.locator('.prog').innerText(), { timeout: 5000 }).not.toBe(before);

  // Walk the rest of the tour to the end.
  for (let i = 0; i < 30; i++) {
    if ((await card.count()) === 0) break;
    await card.getByRole('button', { name: /^(Next|Skip step|Done)$/ }).click();
    await page.waitForTimeout(150);
  }
  await expect(card).toHaveCount(0);

  // Onboarding is remembered.
  await page.reload();
  await expect(page.locator('app-welcome')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('beginner status bar explains the plant in plain language', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('nol.prefs.v1', JSON.stringify({ onboarded: true, beginnerMode: true })),
  );
  await page.goto('/');
  await expect(page.locator('app-plant-status-bar .bar')).toContainText(/Running normally/, {
    timeout: 20_000,
  });

  // After a trip the wording changes and gives a next step.
  await page.locator('#run-toggle').click();
  await page.getByRole('link', { name: 'Reactor', exact: true }).click();
  await page.getByRole('button', { name: 'MANUAL REACTOR TRIP' }).click();
  await expect(page.locator('app-plant-status-bar .bar')).toContainText(/shut down|tripped/i);
  await expect(page.locator('app-plant-status-bar .advice')).toBeVisible();
});
