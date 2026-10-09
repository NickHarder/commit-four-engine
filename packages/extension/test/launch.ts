/**
 * Shared Chromium launcher for the extension e2e tests.
 * - routes the extension service worker's requests through Playwright (off by default!), so the
 *   fakes see them
 * - installs a safety net: any github.com / api.github.com request a test doesn't explicitly fake
 *   is aborted, so a test can never read from or write to the real GitHub
 *
 * Playwright routing turns Chrome's HTTP cache off. A test that needs the real cache passes
 * `hostResolverRules` instead, which send every GitHub host to a local server (see
 * `githubServer.ts`), so the real GitHub stays unreachable without any routing.
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

export async function launchWithExtension(
  buildDir: string,
  userDir: string,
  opts: { localGitHub?: { hostResolverRules: string; spkiHash: string } } = {},
): Promise<BrowserContext> {
  const local = opts.localGitHub;
  // Playwright's headless mode can't load extensions; Chrome's own new headless mode can.
  const context = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: [
      "--headless=new",
      `--disable-extensions-except=${buildDir}`,
      `--load-extension=${buildDir}`,
      ...(local
        ? [
            // a proxy resolves hosts itself and would bypass the mapping (and reach the real GitHub)
            "--no-proxy-server",
            `--host-resolver-rules=${local.hostResolverRules}`,
            `--ignore-certificate-errors-spki-list=${local.spkiHash}`,
          ]
        : []),
    ],
  });
  if (!local) {
    // Registered first, so every test-specific route (registered later) takes precedence.
    await context.route(/^https:\/\/([a-z0-9-]+\.)*github\.com(\/|$)/, (route) =>
      route.abort("blockedbyclient"),
    );
  }
  return context;
}
