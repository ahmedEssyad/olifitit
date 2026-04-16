/**
 * Multi-page crawling — discovers links and scans each page.
 */

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../core/config';
import { log } from '../core/utils';
import { CLIOptions, SiteMap } from './types';
import { scan } from './index';

const VIEWPORT_HEIGHT = config.browser.viewportHeight;
const MAX_PAGES = config.scan.maxPages;

export async function discoverLinks(page: Page, baseUrl: string): Promise<string[]> {
  const base = new URL(baseUrl);
  const links = await page.evaluate((origin: string) => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    return anchors
      .map(a => {
        try {
          const href = (a as HTMLAnchorElement).href;
          const url = new URL(href);
          return url.origin === origin ? url.origin + url.pathname : null;
        } catch { return null; }
      })
      .filter((u): u is string => u !== null);
  }, base.origin);

  // Deduplicate and normalize
  const seen = new Set<string>();
  return links.filter(link => {
    const normalized = link.replace(/\/+$/, '') || '/';
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    // Skip non-page resources
    if (normalized.match(/\.(pdf|zip|png|jpg|jpeg|gif|svg|css|js|xml|json|ico|woff|woff2|ttf|mp4|mp3)$/i)) return false;
    return true;
  });
}

export function urlToSlug(url: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  const parsed = new URL(url);
  let pathname = parsed.pathname.replace(/^\//, '').replace(/\/+$/, '');
  if (!pathname) pathname = 'index';
  return pathname.replace(/\//g, '-');
}

export async function crawl(url: string, outputDir: string, options?: Partial<CLIOptions>): Promise<void> {
  log('Crawler', 'info', `Starting multi-page crawl of ${url}`);

  const pagesDir = path.join(outputDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });

  const visited = new Set<string>();
  const queue: string[] = [url];
  const siteMap: SiteMap = { baseUrl: url, pages: [], timestamp: new Date().toISOString() };

  const browser = await chromium.launch({ headless: true });

  const contextOptions: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    extraHTTPHeaders?: Record<string, string>;
  } = {
    viewport: { width: 1440, height: VIEWPORT_HEIGHT },
    deviceScaleFactor: 2,
  };

  if (options?.authHeader) {
    const [key, ...valueParts] = options.authHeader.split(':');
    contextOptions.extraHTTPHeaders = { [key.trim()]: valueParts.join(':').trim() };
  }

  const context = await browser.newContext(contextOptions);

  if (options?.authCookie) {
    const cookies = options.authCookie.split(';').map(c => {
      const [name, ...vParts] = c.trim().split('=');
      const parsed = new URL(url);
      return { name: name.trim(), value: vParts.join('=').trim(), domain: parsed.hostname, path: '/' };
    });
    await context.addCookies(cookies);
  }

  // First pass: discover all pages
  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const currentUrl = queue.shift()!;
    const normalized = currentUrl.replace(/\/+$/, '') || currentUrl;
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    log('Crawler', 'info', `Discovering: ${currentUrl} (${visited.size}/${MAX_PAGES})`);

    const page = await context.newPage();
    try {
      await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1000);

      const title = await page.title();
      const links = await discoverLinks(page, url);

      siteMap.pages.push({
        url: currentUrl,
        title,
        slug: urlToSlug(currentUrl, url),
        links,
      });

      for (const link of links) {
        const normLink = link.replace(/\/+$/, '') || link;
        if (!visited.has(normLink) && !queue.includes(link)) {
          queue.push(link);
        }
      }
    } catch (err) {
      log('Crawler', 'warn', `Failed to load ${currentUrl}: ${err}`);
    }
    await page.close();
  }

  await browser.close();

  // Write site map
  fs.writeFileSync(path.join(outputDir, 'site-map.json'), JSON.stringify(siteMap, null, 2));
  log('Crawler', 'info', `Discovered ${siteMap.pages.length} pages`);

  // Second pass: scan each page
  for (const pageInfo of siteMap.pages) {
    const pageOutputDir = path.join(pagesDir, pageInfo.slug);
    fs.mkdirSync(pageOutputDir, { recursive: true });

    log('Crawler', 'info', `Scanning page: ${pageInfo.url} → ${pageInfo.slug}/`);
    try {
      await scan(pageInfo.url, pageOutputDir, options);
    } catch (err) {
      log('Crawler', 'error', `Failed to scan ${pageInfo.url}: ${err}`);
    }
  }

  // Also scan the main page into the root output dir
  log('Crawler', 'info', 'Scanning main page into root output...');
  await scan(url, outputDir, options);

  log('Crawler', 'info', `Crawl complete. ${siteMap.pages.length} pages scanned.`);
}
