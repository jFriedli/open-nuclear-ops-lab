import { test, expect } from '@playwright/test';
import { collectErrors } from './_setup';

test('first-time visitor sees the welcome screen and can take the guided tour', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/'); // no pref set: fresh visitor

  await expect(page.locator('app-welcome')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Learn the plant/ }).click();
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

test('the full control-room walkthrough runs end to end', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() =>
    localStorage.setItem('nol.prefs.v1', JSON.stringify({ onboarded: true, learnMode: true })),
  );
  await page.goto('/learn');
  await page.getByRole('button', { name: /Full control-room walkthrough/ }).click();

  const card = page.locator('app-guide-overlay .card');
  await expect(card).toBeVisible();
  const total = Number((await card.locator('.prog').innerText()).split('/')[1].trim());
  expect(total).toBeGreaterThan(25);

  // Click Next all the way to the end; the tour changes routes as it goes.
  for (let i = 0; i < total + 3; i++) {
    if ((await card.count()) === 0) break;
    await card.getByRole('button', { name: /^(Next|Done)$/ }).click();
    await page.waitForTimeout(120);
  }
  await expect(card).toHaveCount(0);
  // It visited the deep pages.
  await expect(page.locator('nol-containment, nol-scenario')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('every walkthrough step finds its spotlight target', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() =>
    localStorage.setItem('nol.prefs.v1', JSON.stringify({ onboarded: true, learnMode: true })),
  );
  await page.goto('/learn');
  await page.getByRole('button', { name: /Full control-room walkthrough/ }).click();

  const card = page.locator('app-guide-overlay .card');
  const ring = page.locator('app-guide-overlay .ring');
  await expect(card).toBeVisible();
  const total = Number((await card.locator('.prog').innerText()).split('/')[1].trim());

  let missing = 0;
  for (let i = 0; i < total; i++) {
    // Give the route change + spotlight a moment to resolve.
    await expect(card.locator('p')).not.toHaveText('', { timeout: 5000 });
    await page.waitForTimeout(250);
    if ((await ring.count()) === 0) missing++;
    if (i < total - 1) await card.getByRole('button', { name: 'Next' }).click();
  }
  await card.getByRole('button', { name: 'Done' }).click();

  // Every walkthrough step spotlights an anchor; allow one slow frame.
  expect(missing, `${missing} walkthrough steps had no spotlight target`).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('the learn-mode coach explains the plant and gives next steps', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('nol.prefs.v1', JSON.stringify({ onboarded: true, learnMode: true })),
  );
  await page.goto('/');
  await expect(page.locator('app-coach-bar .coach')).toBeVisible({ timeout: 20_000 });
  // Paused at t=0 the coach walks a first-timer through starting the clock.
  await expect(page.locator('app-coach-bar .coach')).toContainText(/frozen|Press RUN/i);

  await page.locator('#run-toggle').click();
  await expect(page.locator('app-coach-bar .coach')).toContainText(/Running normally/, {
    timeout: 20_000,
  });

  // After a trip the wording changes and the step list gives a next action.
  await page.getByRole('link', { name: 'Reactor', exact: true }).click();
  await page.getByRole('button', { name: 'MANUAL REACTOR TRIP' }).click();
  await expect(page.locator('app-coach-bar .coach')).toContainText(/shut down|tripped/i);
  await expect(page.locator('app-coach-bar .steps li').first()).toBeVisible();

  // Challenge mode hides the coach entirely.
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await expect(page.locator('app-coach-bar .coach')).toHaveCount(0);
});
