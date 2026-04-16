/**
 * Cookie consent banner dismissal.
 */

import { Page } from 'playwright';
import { log } from '../core/utils';
import { config } from '../core/config';

const COOKIE_SELECTORS = config.scan.cookieSelectors;
const COOKIE_BUTTON_TEXTS = config.scan.cookieButtonTexts;

export async function dismissCookieConsent(page: Page): Promise<void> {
  log('Scanner', 'info', 'Checking for cookie consent banners...');

  // Try clicking known consent buttons by selector
  for (const sel of COOKIE_SELECTORS) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        await btn.click();
        log('Scanner', 'info', `Dismissed cookie banner via: ${sel}`);
        await page.waitForTimeout(500);
        return;
      }
    } catch (e) { log('Scanner', 'debug', `Cookie selector ${sel} failed: ${(e as Error).message}`); }
  }

  // Try finding buttons by text content
  try {
    const dismissed = await page.evaluate((texts: string[]) => {
      const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      for (const btn of buttons) {
        const text = (btn as HTMLElement).textContent?.trim().toLowerCase() || '';
        if (texts.some(t => text === t || text.includes(t))) {
          const rect = (btn as HTMLElement).getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            (btn as HTMLElement).click();
            return true;
          }
        }
      }
      return false;
    }, COOKIE_BUTTON_TEXTS);

    if (dismissed) {
      log('Scanner', 'info', 'Dismissed cookie banner via text match');
      await page.waitForTimeout(500);
    }
  } catch { /* */ }
}
