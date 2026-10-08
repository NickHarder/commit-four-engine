/**
 * End-to-end, browser-only mode: the extension's service worker runs the engine, the AI runs in
 * the offscreen worker, and moves are written through the GitHub API (routed to an in-memory GitHub).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initialState, SENTINEL_FILE, STATE_PATH } from "@commit-four/core";
import { type BrowserContext, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeGitHub } from "../../core/test/fakeGitHub";
import { calendarHtml } from "../../core/test/fixtures";

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, "..");
const OWNER = "NickHarder";
const EMAIL = "29993711+NickHarder@users.noreply.github.com";
const canRun = existsSync(chromium.executablePath());

describe.skipIf(!canRun)("extension on a profile page (browser-only mode)", () => {
  let gh: FakeGitHub;
  let context: BrowserContext;
  let page: Page;
  let userDir: string;
  let buildDir: string;
  const countsByDate = () => {
    const out = new Map<string, number>();
    for (const c of gh.history())
      if (c.author.email === EMAIL)
        out.set(c.author.date.slice(0, 10), (out.get(c.author.date.slice(0, 10)) ?? 0) + 1);
    return out;
  };

  beforeAll(async () => {
    buildDir = mkdtempSync(join(tmpdir(), "c4-ext-"));
    execFileSync("node", ["build.mjs", "--out", buildDir], { cwd: extDir });
    gh = new FakeGitHub(OWNER, "board", {
      [SENTINEL_FILE]: JSON.stringify({ commitFour: 1, owner: OWNER, boardId: "e2e" }),
      [STATE_PATH]: JSON.stringify(initialState(OWNER)),
    });
    userDir = mkdtempSync(join(tmpdir(), "c4-chrome-"));
    context = await chromium.launchPersistentContext(userDir, {
      headless: false,
      args: ["--headless=new", `--disable-extensions-except=${buildDir}`, `--load-extension=${buildDir}`],
    });
    await context.route("https://api.github.com/**", async (route) => {
      const req = route.request();
      const res = await gh.fetch(req.url(), {
        method: req.method(),
        headers: await req.allHeaders(),
        body: req.postData() ?? undefined,
      });
      await route.fulfill({ status: res.status, contentType: "application/json", body: await res.text() });
    });
    await context.route("https://github.com/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === `/users/${OWNER}/contributions`) {
        return route.fulfill({
          contentType: "text/html",
          body: calendarHtml(
            OWNER,
            url.searchParams.get("from")!,
            url.searchParams.get("to")!,
            countsByDate(),
          ),
        });
      }
      if (url.pathname === `/${OWNER}`) {
        return route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html><head><meta name="user-login" content="${OWNER}"></head><body><main>${calendarHtml(OWNER, "2016-01-01", "2016-12-31", countsByDate())}</main></body></html>`,
        });
      }
      return route.fulfill({ status: 404, body: "" });
    });
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await sw.evaluate((settings) => chrome.storage.local.set({ settings }), {
      mode: "browser",
      owner: OWNER,
      repo: "board",
      branch: "main",
      helperPort: 47474,
      helperToken: "",
      pat: "github_pat_test_token",
      author: { name: "Nick Harder", email: EMAIL },
    });
    page = await context.newPage();
    await page.goto(`https://github.com/${OWNER}?tab=overview&from=2016-12-01&to=2016-12-31`);
  }, 60_000);

  afterAll(async () => {
    await context?.close();
    rmSync(userDir, { recursive: true, force: true });
    rmSync(buildDir, { recursive: true, force: true });
  });

  it("plays a move with the AI in the offscreen worker and writes through the API", async () => {
    await page.locator(".commit-four-hud").getByText("No games yet").waitFor({ timeout: 30_000 });
    await page.locator(".commit-four-hud select").selectOption("casual");
    await page.getByRole("button", { name: "New game" }).click();
    await page.waitForFunction(() => document.querySelectorAll("td.c4-cell").length === 42, null, {
      timeout: 15_000,
    });
    await page.locator('td.c4-cell[data-c4-col="0"]').first().click();
    await page
      .locator(".commit-four-hud")
      .getByText(/Your move/)
      .waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => document.querySelectorAll(".c4-pending").length === 0, null, {
      timeout: 30_000,
    });
    const state = JSON.parse(gh.file(STATE_PATH)!);
    expect(state.games[0].moves).toMatch(/^1[1-7]$/);
    const counts = countsByDate();
    expect(counts.get("2016-01-01")).toBe(4);
    expect(counts.get("2016-01-16")).toBe(4); // column 1 bottom = first Saturday of slot 0
    expect([...counts.values()].filter((n) => n === 2)).toHaveLength(1); // one AI square
  }, 90_000);
});
