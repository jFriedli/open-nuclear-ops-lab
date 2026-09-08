import { test, expect } from '@playwright/test';
import { open } from './_setup';

// Not part of the CI gate — run manually to refresh docs/screenshots:
//   npx playwright test e2e/screenshots.spec.ts
const SHOTS = '../docs/screenshots';

test('welcome screen', async ({ page }) => {
  test.skip(!process.env['SHOTS'], 'set SHOTS=1 to regenerate docs screenshots');
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.goto('/');
  await expect(page.locator('app-welcome')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/welcome.png` });
});

test('mobile', async ({ page }) => {
  test.skip(!process.env['SHOTS'], 'set SHOTS=1 to regenerate docs screenshots');
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.locator('app-csf-strip .csf').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('#run-toggle').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/mobile-overview.png` });
  await page.locator('.menu-btn').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/mobile-nav.png` });
});

test('capture documentation screenshots', async ({ page }) => {
  test.skip(!process.env['SHOTS'], 'set SHOTS=1 to regenerate docs screenshots');
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await expect(page.locator('app-csf-strip .csf').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('#run-toggle').click();
  await page.getByRole('button', { name: '5×', exact: true }).click();
  await page.waitForTimeout(3000);

  await page.screenshot({ path: `${SHOTS}/overview.png` });

  await page.getByRole('link', { name: 'Reactor', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/reactor.png` });

  // Kick off the LOOP scenario for a more interesting alarm/electrical shot.
  await page.getByRole('link', { name: 'Scenario / Instructor', exact: true }).click();
  await page.getByText('Loss of Off-Site Power (LOOP)').click();
  await page.screenshot({ path: `${SHOTS}/scenario.png` });
  await page.getByRole('button', { name: /START SCENARIO/ }).click();
  await page.getByRole('button', { name: '10×', exact: true }).click();
  await page.waitForTimeout(6000);

  await page.getByRole('link', { name: 'Electrical', exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/electrical.png` });

  await page.getByRole('link', { name: 'Alarms', exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/alarms.png` });

  await page.getByRole('link', { name: 'Trends', exact: true }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/trends.png` });

  await page.getByRole('link', { name: 'Safety Functions', exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/safety.png` });

  // HMI-layer fault: the indication-integrity banner + a spoofed gauge.
  await page.getByRole('link', { name: 'Scenario / Instructor', exact: true }).click();
  await page.getByText('HMI Fault - SG-1 Level Frozen On Screen').click();
  await page.getByRole('button', { name: /START SCENARIO/ }).click();
  await page.getByRole('button', { name: '10×', exact: true }).click();
  await page.waitForTimeout(7000);
  await page.getByRole('link', { name: 'Secondary / Turbine', exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/hmi-fault.png` });
});
