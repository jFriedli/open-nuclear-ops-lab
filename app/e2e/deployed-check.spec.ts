import { test, expect } from '@playwright/test';

// Manual post-deploy verification against the real GitHub Pages site.
//   DEPLOYED_URL=https://…/open-nuclear-ops-lab/ npx playwright test e2e/deployed-check.spec.ts
const URL = process.env['DEPLOYED_URL'];

test('the deployed site loads, runs the engine, and completes a LOOP scenario', async ({ page }) => {
  test.skip(!URL, 'set DEPLOYED_URL to run this check');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(URL!);
  await expect(page).toHaveTitle(/Open Nuclear Ops Lab/);
  await expect(page.locator('app-csf-strip .csf').first()).toBeVisible({ timeout: 30_000 });

  await page.locator('#run-toggle').click();
  await page.getByRole('button', { name: '5×', exact: true }).click();
  await expect
    .poll(async () => {
      const p = (await page.locator('svg.mimic .big').first().textContent()) ?? '0';
      return Number(p.replace('%', ''));
    }, { timeout: 30_000 })
    .toBeGreaterThan(95);

  await page.getByRole('link', { name: 'Scenario / Instructor', exact: true }).click();
  await page.getByText('Loss of Off-Site Power (LOOP)').click();
  await page.getByRole('button', { name: /START SCENARIO/ }).click();
  await page.getByRole('button', { name: '10×', exact: true }).click();

  await page.getByRole('link', { name: 'Electrical', exact: true }).click();
  await expect(page.getByText('LOST', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/RUNNING/).first()).toBeVisible();

  await page.getByRole('link', { name: 'Alarms', exact: true }).click();
  await page.getByRole('button', { name: 'ACK ALL VISIBLE' }).click();
  await expect(page.locator('.alarmpill')).toContainText('0 UNACK');

  expect(errors, errors.join('\n')).toEqual([]);
});
