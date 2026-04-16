/**
 * Lazy content loading trigger — scrolls through the page to activate
 * lazy-loaded images, infinite scroll, and deferred content.
 */

import { Page } from 'playwright';
import { log } from '../core/utils';

export async function triggerLazyContent(page: Page): Promise<void> {
  log('Scanner', 'info', 'Scrolling to trigger lazy content...');

  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const step = 100;
  const pause = 200;

  // Scroll down slowly
  for (let y = 0; y < scrollHeight; y += step) {
    await page.evaluate((scrollY: number) => window.scrollTo(0, scrollY), y);
    await page.waitForTimeout(pause);
  }

  // Scroll to bottom
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // Wait for loading indicators to disappear
  try {
    await page.waitForFunction(() => {
      const loaders = document.querySelectorAll('[data-loading], .loading, .skeleton, [class*="skeleton"], [class*="spinner"]');
      return Array.from(loaders).every(el => {
        const style = window.getComputedStyle(el);
        return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
      });
    }, { timeout: 5000 });
  } catch { /* timeout is fine — no loaders or still loading */ }

  log('Scanner', 'info', 'Lazy content loading complete');
}
