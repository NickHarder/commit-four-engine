/**
 * End-to-end, browser-only mode: the extension's service worker runs the engine, the AI runs in
 * the offscreen worker, and moves are written through the GitHub API (routed to an in-memory GitHub).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, initialState, SENTINEL_FILE, STATE_PATH } from "@commit-four/core";
import type { BrowserContext, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeGitHub } from "../../core/test/fakeGitHub";
import { calendarHtml } from "../../core/test/fixtures";
import { profilePage, withBackground } from "./fakeProfile";
import { canRunChromium, launchWithExtension } from "./launch";

const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, "..");
const OWNER = "NickHarder";
const EMAIL = "29993711+NickHarder@users.noreply.github.com";
const canRun = canRunChromium();

describe.skipIf(!canRun)("extension on a profile page (browser-only mode)", () => {
  let gh: FakeGitHub;
  let context: BrowserContext;
  let page: Page;
  let userDir: string;
  let buildDir: string;
  /** Real (non-game) activity the owner adds during the test. */
  const extra = new Map<string, number>();
  const countsByDate = () => {
    const out = new Map<string, number>();
    for (const c of gh.history())
      if (c.author.email === EMAIL)
        out.set(c.author.date.slice(0, 10), (out.get(c.author.date.slice(0, 10)) ?? 0) + 1);
    return out;
  };
  const graph = () => {
    const out = withBackground(countsByDate());
    for (const [d, n] of extra) out.set(d, (out.get(d) ?? 0) + n);
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
    context = await launchWithExtension(buildDir, userDir);
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
          body: calendarHtml(OWNER, url.searchParams.get("from")!, url.searchParams.get("to")!, graph()),
        });
      }
      if (url.pathname === `/${OWNER}`) {
        return route.fulfill({
          contentType: "text/html",
          body: profilePage(OWNER, url, graph()),
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
    expect(counts.get("2016-01-01")).toBe(14);
    expect(counts.get("2016-01-16")).toBe(4); // column 1 bottom = first Saturday of slot 0
    expect([...counts.values()].filter((n) => n === 2)).toHaveLength(1); // one AI square
  }, 90_000);

  it("warns when GitHub shades the board differently than expected", async () => {
    const hud = page.locator(".commit-four-hud");
    expect(await hud.evaluate((h) => h.shadowRoot?.textContent ?? "")).not.toMatch(
      /differently than expected/,
    );
    // a month of steady real activity lands in 2016 (one huge day wouldn't matter: it's an
    // outlier). GitHub's scale now tops out at 10, and the pieces fade to levels 2 and 1
    for (let i = 0; i < 30; i++) extra.set(addDays("2016-06-01", i), 10);
    await page.reload();
    await hud.getByText(/shading \d+ of this year's board squares differently than expected/).waitFor({
      timeout: 30_000,
    });
  }, 60_000);

  it("starts over from Settings, and the next board skips a year with other activity", async () => {
    const sw = context.serviceWorkers()[0]!;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${new URL(sw.url()).host}/options.html`);
    await options.getByRole("button", { name: "Erase all games…" }).click();
    const go = options.getByRole("button", { name: "Erase everything" });
    expect(await go.isDisabled()).toBe(true);
    await options.getByLabel("Type the board repo name to confirm").fill("board");
    await go.click();
    await options.getByText(/Done: your board is empty/).waitFor({ timeout: 15_000 });
    expect(gh.history()).toHaveLength(1);
    expect(JSON.parse(gh.file(STATE_PATH)!).games).toEqual([]);
    expect(JSON.parse(gh.file(SENTINEL_FILE)!).owner).toBe(OWNER);
    await options.close();

    // the open board hears about it, and a new game avoids 2016 (it has the owner's own activity now)
    const hud = page.locator(".commit-four-hud");
    await hud.getByText("No games yet").waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: "New game" }).click();
    await page.waitForURL(/from=2015-12-01/, { timeout: 15_000 });
    await page.waitForFunction(() => document.querySelectorAll("td.c4-cell").length === 42, null, {
      timeout: 15_000,
    });
    await expect
      .poll(() => JSON.parse(gh.file(STATE_PATH)!).games[0]?.placement.season, { timeout: 15_000 })
      .toBe(2015);
  }, 90_000);
});
