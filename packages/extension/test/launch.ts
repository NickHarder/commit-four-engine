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
import { type BrowserContext, chromium, type Worker } from "playwright-core";

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

/**
 * The Commit Four service worker, once its extension APIs are usable. Taking the first service
 * worker the moment it appears isn't enough: on a slow CI machine an evaluate found `chrome`
 * without `chrome.storage`, so pick ours by its script URL and wait until storage answers.
 */
export async function extensionWorker(context: BrowserContext, timeoutMs = 30_000): Promise<Worker> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const sw = context.serviceWorkers().find((w) => /^chrome-extension:\/\/[a-p]{32}\/sw\.js$/.test(w.url()));
    const ready = sw
      ? await sw.evaluate(() => typeof chrome !== "undefined" && !!chrome.storage?.local).catch(() => false)
      : false;
    if (sw && ready) return sw;
    if (Date.now() > deadline) throw new Error("the Commit Four service worker never became ready");
    await new Promise((r) => setTimeout(r, 100));
  }
}
