import { test, expect, type Page } from '@playwright/test';

const errs = (page: Page) => {
  const e: string[] = [];
  page.on('console', (m) => m.type() === 'error' && e.push(m.text()));
  page.on('pageerror', (x) => e.push(String(x)));
  return e;
};

test('interlocks reject illegal commands with an explanation', async ({ page }) => {
  const errors = errs(page);
  await page.goto('/');
  await expect(page.locator('app-csf-strip .csf').first()).toBeVisible({ timeout: 20_000 });
  // Keep the clock paused so plant state is frozen at full power for the test.

  await page.getByRole('link', { name: 'Reactor', exact: true }).click();
  await page.getByRole('button', { name: 'MANUAL REACTOR TRIP' }).click();
  await expect(page.getByText('TRIPPED')).toBeVisible();

  // Immediately trying to reset the trip must be rejected (parameters not yet in band)…
  await page.getByRole('button', { name: 'RESET TRIP' }).click();
  await expect(page.locator('#cmd-toast')).toContainText(/reset band|blocked/i);

  // …and putting rod control back to AUTO after a trip is also rejected.
  await page.getByRole('button', { name: 'Take manual' }).click();
  await page.getByRole('button', { name: 'Return to auto' }).click();
  await expect(page.locator('#cmd-toast')).toContainText(/AUTO after a reactor trip/);

  expect(errors).toEqual([]);
});

test('instrument fault produces channel disagreement without a real process excursion', async ({
  page,
}) => {
  const errors = errs(page);
  await page.goto('/');
  await expect(page.locator('app-csf-strip .csf').first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole('link', { name: 'Scenario / Instructor', exact: true }).click();
  await page.getByText('Generic Instrumentation Failure').click();
  await page.getByRole('button', { name: /START SCENARIO/ }).click();
  await page.getByRole('button', { name: '10×', exact: true }).click();

  // Let the scripted instrument faults apply (t=20..70s).
  await page.waitForTimeout(9000);

  // The plant itself stays healthy: no reactor trip.
  await page.getByRole('link', { name: 'Reactor', exact: true }).click();
  await expect(page.getByText('TRIPPED')).toHaveCount(0);

  // But an instrument alarm should be present.
  await page.getByRole('link', { name: 'Alarms', exact: true }).click();
  await expect(page.locator('td', { hasText: /disagreement|channel/i }).first()).toBeVisible({
    timeout: 20_000,
  });

  expect(errors).toEqual([]);
});

test('an HMI-layer fault shows the integrity banner while protection still acts', async ({ page }) => {
  const errors = errs(page);
  await page.goto('/');
  await expect(page.locator('app-csf-strip .csf').first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole('link', { name: 'Scenario / Instructor', exact: true }).click();
  await page.getByText('HMI Fault — SG-1 Level Frozen On Screen').click();
  await page.getByRole('button', { name: /START SCENARIO/ }).click();
  await page.getByRole('button', { name: '10×', exact: true }).click();

  // The indication-integrity banner appears once the HMI fault is active.
  await expect(page.locator('.integrity-bar')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.integrity-bar')).toContainText('sg1_level');

  // Feedwater is lost too; despite the frozen gauge, the reactor still trips.
  await page.getByRole('link', { name: 'Reactor', exact: true }).click();
  await expect(page.getByText('TRIPPED')).toBeVisible({ timeout: 20_000 });

  expect(errors).toEqual([]);
});

test('a session can be exported and replayed deterministically', async ({ page }) => {
  const errors = errs(page);
  await page.goto('/');
  await expect(page.locator('app-csf-strip .csf').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('#run-toggle').click();
  await page.getByRole('button', { name: '10×', exact: true }).click();

  await page.getByRole('link', { name: 'Reactor', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'MANUAL REACTOR TRIP' }).click();
  await expect(page.getByText('TRIPPED')).toBeVisible();
  await page.waitForTimeout(1500);

  await page.getByRole('link', { name: 'Scenario / Instructor', exact: true }).click();
  const sessionBox = page.getByPlaceholder(/Session JSON/);
  await page.getByRole('button', { name: 'Export current session' }).click();
  await expect.poll(async () => (await sessionBox.inputValue()).length, { timeout: 10_000 }).toBeGreaterThan(50);
  const sessionJson = await sessionBox.inputValue();
  expect(sessionJson).toContain('nol-session-v1');
  expect(sessionJson).toContain('trip_reactor');

  await page.getByRole('button', { name: 'Load & replay session' }).click();
  await expect(page.locator('.panel .sm', { hasText: /Replayed session/ })).toBeVisible();

  // Replayed state carries the trip.
  await page.getByRole('link', { name: 'Reactor', exact: true }).click();
  await expect(page.getByText('TRIPPED')).toBeVisible();

  expect(errors).toEqual([]);
});

test('trends view records and plots selected variables', async ({ page }) => {
  const errors = errs(page);
  await page.goto('/');
  await expect(page.locator('app-csf-strip .csf').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('#run-toggle').click();
  await page.getByRole('button', { name: '5×', exact: true }).click();

  await page.getByRole('link', { name: 'Trends', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(3000);
  // legend shows a live value for a default-selected variable
  await expect(page.locator('.legend b.num').first()).not.toHaveText('--');

  expect(errors).toEqual([]);
});
