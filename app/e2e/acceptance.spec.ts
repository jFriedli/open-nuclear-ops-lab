import { test, expect, type Page } from '@playwright/test';

// Mirrors the project's "final acceptance scenario", driven through the real UI
// against the production build.

const noConsoleErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
};

async function simClock(page: Page): Promise<number> {
  const txt = await page.locator('.clk').innerText();
  const [m, s] = txt.trim().split(':').map(Number);
  return m * 60 + s;
}

test('loads, runs a stable plant, then a LOOP scenario with correct protective actions', async ({
  page,
}) => {
  const errors = noConsoleErrors(page);

  await page.goto('/');
  // 1-2: app + engine load, plant starts stable
  await expect(page.locator('.brand strong')).toHaveText('OPEN NUCLEAR OPS LAB');
  await expect(page.locator('app-csf-strip .csf').first()).toBeVisible({ timeout: 20_000 });

  // Overview mimic renders
  await expect(page.locator('svg.mimic')).toBeVisible();

  // 3: run and observe a stable trend
  await page.locator('#run-toggle').click();
  await page.getByRole('button', { name: '5×', exact: true }).click();

  // The plant settles into a stable full-power state (no reactor trip, ~100%).
  await expect
    .poll(async () => {
      const p = (await page.locator('svg.mimic .big').first().textContent()) ?? '0';
      return Number(p.replace('%', ''));
    }, { timeout: 30_000 })
    .toBeGreaterThan(95);
  // No challenged safety function in the clean baseline.
  await expect
    .poll(async () => {
      const s = await page.locator('app-csf-strip .csf i').allInnerTexts();
      return s.filter((x) => x === 'CHALLENGED').length;
    }, { timeout: 20_000 })
    .toBe(0);

  // 4: start "Loss of Off-Site Power"
  await page.getByRole('link', { name: 'Scenario / Instructor', exact: true }).click();
  await page.getByText('Loss of Off-Site Power (LOOP)').click();
  await page.getByRole('button', { name: /START SCENARIO/ }).click();
  await expect(page.locator('.panel .dim.sm', { hasText: /Loaded/ })).toBeVisible();
  await expect(page.locator('#run-toggle')).toContainText('PAUSE');

  await page.getByRole('button', { name: '10×', exact: true }).click();

  // 5-8: wait past the event (t=20s) and the trip cascade
  await expect
    .poll(async () => simClock(page), { timeout: 30_000, intervals: [500] })
    .toBeGreaterThan(70);

  await page.getByRole('link', { name: 'Electrical', exact: true }).click();
  await expect(page.getByText('LOST', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/RUNNING/).first()).toBeVisible(); // a diesel

  await page.getByRole('link', { name: 'Reactor', exact: true }).click();
  await expect(page.getByText('TRIPPED')).toBeVisible();
  // fission power has collapsed
  const npwr = parseFloat(
    (await page.locator('nol-readout', { hasText: 'Neutron power' }).locator('.val').first().textContent()) ?? '99',
  );
  expect(npwr).toBeLessThan(10);
  // 7: decay heat remains — indicated thermal power stays well above zero
  const thermal = parseFloat(
    (await page.locator('nol-readout', { hasText: 'Thermal power' }).locator('.val').first().textContent()) ?? '0',
  );
  expect(thermal).toBeGreaterThan(10);
  expect(thermal).toBeLessThan(250);

  // 9: acknowledge alarms
  await page.getByRole('link', { name: 'Alarms', exact: true }).click();
  await page.getByRole('button', { name: 'ACK ALL VISIBLE' }).click();
  await expect(page.locator('.alarmpill')).toContainText('0 UNACK');

  // 10: event timeline recorded the trips
  await page.getByRole('link', { name: 'Event Log', exact: true }).click();
  await expect(page.locator('tr.c-trip').first()).toBeVisible();
  await expect(page.locator('tbody', { hasText: 'REACTOR_TRIP' })).toBeVisible();

  // 11: pause and inspect
  await expect(page.locator('#run-toggle')).toContainText('PAUSE');
  await page.locator('#run-toggle').click();
  await expect(page.locator('#run-toggle')).toContainText('RUN');
  const t1 = await simClock(page);
  await page.waitForTimeout(1500);
  expect(await simClock(page)).toBe(t1);

  // 12: reset / start another scenario
  await page.getByRole('button', { name: 'RESET', exact: true }).click();
  await expect.poll(async () => simClock(page), { timeout: 10_000 }).toBeLessThan(5);

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});
