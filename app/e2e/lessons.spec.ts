import { test, expect } from '@playwright/test';
import { open, collectErrors } from './_setup';

test('a starter lesson tracks objectives and shows a debrief', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page);
  await expect(page.locator('app-csf-strip .csf').first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole('link', { name: 'Learn', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lessons' })).toBeVisible();

  // Start lesson 1 "Watch a healthy plant".
  const card = page.locator('.lesson', { hasText: 'Watch a healthy plant' });
  await card.getByRole('button', { name: /Start lesson/ }).click();

  // The lesson HUD appears with the objective checklist.
  const hud = page.locator('app-lesson-hud .hud');
  await expect(hud).toBeVisible({ timeout: 10_000 });
  await expect(hud).toContainText('Start time with RUN');

  // Do the objectives.
  await page.locator('#run-toggle').click();
  await page.getByRole('button', { name: '10×', exact: true }).click();
  await expect(hud.locator('li.done')).toHaveCount(2, { timeout: 15_000 }); // run + fast

  // Wait out the 3 minutes of plant time (fast-forwarded).
  await expect(page.locator('app-debrief .card')).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('app-debrief .banner.pass')).toBeVisible();
  await expect(page.locator('app-debrief .obj li.done')).toHaveCount(3);

  await page.getByRole('button', { name: 'Back to lessons' }).click();
  // Completion is remembered.
  await expect(page.locator('.lesson', { hasText: 'Watch a healthy plant' })).toContainText('done');

  expect(errors).toEqual([]);
});

test('the reactor-trip lesson runs its scripted trip and checks objectives', async ({ page }) => {
  await open(page);
  await expect(page.locator('app-csf-strip .csf').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('link', { name: 'Learn', exact: true }).click();
  await page
    .locator('.lesson', { hasText: 'Respond to a reactor trip' })
    .getByRole('button', { name: /Start lesson/ })
    .click();
  await page.getByRole('button', { name: '10×', exact: true }).click();

  const hud = page.locator('app-lesson-hud .hud');
  // "Confirm the reactor has tripped" objective ticks once the scripted trip fires.
  await expect(hud.locator('li', { hasText: 'reactor has tripped' })).toHaveClass(/done/, {
    timeout: 25_000,
  });
  // acknowledge the alarms to progress
  await page.getByRole('link', { name: 'Alarms', exact: true }).click();
  await page.getByRole('button', { name: 'ACK ALL VISIBLE' }).click();
  await expect(hud.locator('li', { hasText: 'Acknowledge all alarms' })).toHaveClass(/done/);
});

test('the safeguards lesson tracks the automatic loss-of-coolant response', async ({ page }) => {
  await open(page);
  await expect(page.locator('app-csf-strip .csf').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('link', { name: 'Learn', exact: true }).click();
  await page
    .locator('.lesson', { hasText: 'Loss of coolant and safety injection' })
    .getByRole('button', { name: /Start lesson/ })
    .click();
  await page.getByRole('button', { name: '10×', exact: true }).click();

  const hud = page.locator('app-lesson-hud .hud');
  await expect(hud).toBeVisible({ timeout: 10_000 });
  // The break, trip and safety injection are all automatic.
  await expect(hud.locator('li', { hasText: 'Safety injection actuates' })).toHaveClass(/done/, {
    timeout: 30_000,
  });
  await expect(hud.locator('li', { hasText: 'Containment isolates' })).toHaveClass(/done/);

  // The learn-mode coach recognises the loss of coolant.
  await expect(page.locator('app-coach-bar .coach')).toContainText(/coolant is being lost/i);
});

test('a hint can be shown and ending a lesson gives a debrief', async ({ page }) => {
  await open(page);
  await expect(page.locator('app-csf-strip .csf').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('link', { name: 'Learn', exact: true }).click();
  await page
    .locator('.lesson', { hasText: 'Change reactor power' })
    .getByRole('button', { name: /Start lesson/ })
    .click();

  const hud = page.locator('app-lesson-hud .hud');
  await expect(hud).toBeVisible();
  await hud.getByRole('button', { name: /Hint/ }).click();
  await expect(hud.locator('.hinttext')).toBeVisible();

  await hud.getByRole('button', { name: 'End lesson' }).click();
  await expect(page.locator('app-debrief .banner.fail')).toBeVisible();
});
