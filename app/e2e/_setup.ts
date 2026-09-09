import type { Page } from '@playwright/test';

/**
 * Navigate to the app with the first-run welcome screen already dismissed and
 * Learn mode on (its default). Keeps specs focused on behaviour.
 */
export async function open(page: Page, url = '/'): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        'nol.prefs.v1',
        JSON.stringify({ onboarded: true, learnMode: true }),
      );
    } catch {
      /* ignore */
    }
  });
  await page.goto(url);
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // A deep-link reload against the static test server returns 404 for the
    // route path (the SPA still loads via 404.html, exactly like GitHub Pages).
    if (/Failed to load resource.*404/.test(t)) return;
    errors.push(t);
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
