/**
 * End-to-end: real Chromium + the unpacked extension on a stand-in github.com profile page,
 * talking to the real local helper, which writes to an in-memory GitHub.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiWriter, GameEngine, initialState, SENTINEL_FILE, STATE_PATH } from "@commit-four/core";
import type { BrowserContext, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHelperServer } from "../../cli/src/server";
import { FakeGitHub } from "../../core/test/fakeGitHub";
import { calendarHtml } from "../../core/test/fixtures";
import { profilePage, withBackground } from "./fakeProfile";
import { canRunChromium, launchWithExtension } from "./launch";

const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, "..");
const OWNER = "NickHarder";
const EMAIL = "29993711+NickHarder@users.noreply.github.com";
const TOKEN = "e2e-pairing-token-0123456789";
const canRun = canRunChromium();

describe.skipIf(!canRun)("extension on a profile page (companion mode)", () => {
  let gh: FakeGitHub;
  let engine: GameEngine;
  let server: ReturnType<typeof createHelperServer>;
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
    engine = new GameEngine({
      writer: new ApiWriter({ owner: OWNER, repo: "board", token: "t", fetch: gh.fetch, minIntervalMs: 0 }),
      owner: OWNER,
      pieceAuthor: { name: "Nick Harder", email: EMAIL },
      chooser: () => 3,
    });
    await engine.load();
    server = createHelperServer({
      engine,
      token: TOKEN,
      port: 0,
      status: { pending: 0 },
      meta: { owner: OWNER, repo: "board", version: "e2e" },
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;

    userDir = mkdtempSync(join(tmpdir(), "c4-chrome-"));
    context = await launchWithExtension(buildDir, userDir);
    await context.route("https://github.com/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === `/users/${OWNER}/contributions`) {
        return route.fulfill({
          contentType: "text/html",
          body: calendarHtml(
            OWNER,
            url.searchParams.get("from")!,
            url.searchParams.get("to")!,
            withBackground(countsByDate()),
          ),
        });
      }
      if (url.pathname === `/${OWNER}`) {
        return route.fulfill({
          contentType: "text/html",
          body: profilePage(OWNER, url, withBackground(countsByDate())),
        });
      }
      return route.fulfill({ status: 404, body: "not found" });
    });
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await sw.evaluate((settings) => chrome.storage.local.set({ settings }), {
      mode: "companion",
      owner: OWNER,
      repo: "board",
      branch: "main",
      helperPort: port,
      helperToken: TOKEN,
      pat: "",
    });
    page = await context.newPage();
    await page.goto(`https://github.com/${OWNER}?tab=overview&from=2016-12-01&to=2016-12-31`);
  }, 60_000);

  afterAll(async () => {
    await context?.close();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    rmSync(userDir, { recursive: true, force: true });
    rmSync(buildDir, { recursive: true, force: true });
  });

  it("starts a game, paints moves instantly and confirms them once GitHub's graph has them", async () => {
    await page.locator(".commit-four-hud").getByText("No games yet").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "New game" }).click();
    await page.waitForFunction(() => document.querySelectorAll("td.c4-cell").length === 42, null, {
      timeout: 15_000,
    });
    // the season anchor is pending until GitHub "shows" it
    expect(await page.locator('td[data-date="2016-01-01"]').getAttribute("data-level")).toBe("4");

    await page.locator('td.c4-cell[data-c4-col="3"]').first().click();
    // human piece (column 4, bottom = Saturday Feb 6) is painted immediately; AI answers on top (Fri Feb 5)
    await page.waitForFunction(
      () => document.querySelector('td[data-date="2016-02-06"]')?.getAttribute("data-level") === "4",
      null,
      { timeout: 5_000 },
    );
    await page.waitForFunction(
      () => document.querySelector('td[data-date="2016-02-05"]')?.getAttribute("data-level") === "2",
      null,
      { timeout: 10_000 },
    );
    await engine.flush();
    expect(Object.fromEntries(countsByDate())).toEqual({
      "2016-01-01": 14,
      "2016-02-06": 4,
      "2016-02-05": 2,
    });

    // the poller sees the real counts and drops the pending outlines
    await page.waitForFunction(() => document.querySelectorAll(".c4-pending").length === 0, null, {
      timeout: 20_000,
    });
    await page
      .locator(".commit-four-hud")
      .getByText(/GitHub caught up/)
      .waitFor({ timeout: 5_000 });
    await page
      .locator(".commit-four-hud")
      .getByText(/Your move/)
      .waitFor();
    expect(JSON.parse(gh.file(STATE_PATH)!).games[0].moves).toBe("44");
  }, 90_000);

  it("ignores clicks outside the board and on other people's profiles", async () => {
    const before = gh.history().length;
    await page.locator('td[data-date="2016-06-01"]').click();
    await page.waitForTimeout(500);
    expect(gh.history().length).toBe(before);
  });
});
