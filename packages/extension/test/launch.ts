/**
 * Shared Chromium launcher for the extension e2e tests.
 * - routes the extension service worker's requests through Playwright (off by default!), so the
 *   fakes see them
 * - installs a safety net: any github.com / api.github.com request a test doesn't explicitly fake
 *   is aborted, so a test can never read from or write to the real GitHub
 */
import { type BrowserContext, chromium } from "playwright-core";

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

export const canRunChromium = (): boolean => {
  try {
    return !!chromium.executablePath();
  } catch {
    return false;
  }
};

export async function launchWithExtension(buildDir: string, userDir: string): Promise<BrowserContext> {
  // Playwright's headless mode can't load extensions; Chrome's own new headless mode can.
  const context = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: ["--headless=new", `--disable-extensions-except=${buildDir}`, `--load-extension=${buildDir}`],
  });
  // Registered first, so every test-specific route (registered later) takes precedence.
  await context.route(/^https:\/\/([a-z0-9-]+\.)*github\.com(\/|$)/, (route) =>
    route.abort("blockedbyclient"),
  );
  return context;
}
