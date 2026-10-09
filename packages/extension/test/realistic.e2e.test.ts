/**
 * Browser-only mode against a fake GitHub that behaves like the real one where it bit us: API GETs
 * are cacheable for 60 s, and Chrome's own HTTP cache is on. Plays quick consecutive moves,
 * changes difficulty mid-game, resigns, reloads and opens Settings from the panel.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initialState, SENTINEL_FILE, STATE_PATH } from "@commit-four/core";
import type { BrowserContext, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeGitHub } from "../../core/test/fakeGitHub";
import { calendarHtml } from "../../core/test/fixtures";
import { profilePage, withBackground } from "./fakeProfile";
import { type LocalGitHub, startLocalGitHub } from "./githubServer";
import { canRunChromium, launchWithExtension } from "./launch";

const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, "..");
const OWNER = "NickHarder";
const EMAIL = "29993711+NickHarder@users.noreply.github.com";

describe.skipIf(!canRunChromium())("browser-only mode against a caching GitHub", () => {
  let gh: FakeGitHub;
  let context: BrowserContext;
  let page: Page;
  let userDir: string;
  let buildDir: string;
  let extensionId: string;
  let github: LocalGitHub;
  const countsByDate = () => {
    const out = new Map<string, number>();
    for (const c of gh.history())
      if (c.author.email === EMAIL)
        out.set(c.author.date.slice(0, 10), (out.get(c.author.date.slice(0, 10)) ?? 0) + 1);
    return out;
  };
  const hud = () => page.locator(".commit-four-hud");
  const state = () =>
    JSON.parse(gh.file(STATE_PATH)!) as {
      games: { id: number; moves: string; status: string; difficulty: string }[];
    };

  beforeAll(async () => {
    buildDir = mkdtempSync(join(tmpdir(), "c4-ext-"));
    execFileSync("node", ["build.mjs", "--out", buildDir], { cwd: extDir });
    gh = new FakeGitHub(OWNER, "board", {
      [SENTINEL_FILE]: JSON.stringify({ commitFour: 1, owner: OWNER, boardId: "e2e" }),
      [STATE_PATH]: JSON.stringify(initialState(OWNER)),
    });
    github = await startLocalGitHub(gh, (url) => {
      if (url.pathname === `/users/${OWNER}/contributions`)
        return {
          status: 200,
          body: calendarHtml(
            OWNER,
            url.searchParams.get("from")!,
            url.searchParams.get("to")!,
            withBackground(countsByDate()),
          ),
        };
      if (url.pathname === `/${OWNER}`)
        return {
          status: 200,
          body: profilePage(OWNER, url, withBackground(countsByDate())),
        };
      return { status: 404, body: "" };
    });
    userDir = mkdtempSync(join(tmpdir(), "c4-chrome-"));
    // no Playwright routing here: it would turn off the HTTP cache this test is about
    context = await launchWithExtension(buildDir, userDir, { localGitHub: github });
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    extensionId = new URL(sw.url()).host;
    await sw.evaluate((settings) => chrome.storage.local.set({ settings }), {
      mode: "browser",
      authKind: "oauth",
      owner: OWNER,
      repo: "board",
      branch: "main",
      helperPort: 47474,
      helperToken: "",
      pat: "gho_test",
      author: { name: "Nick Harder", email: EMAIL },
    });
    page = await context.newPage();
    await page.goto(`https://github.com/${OWNER}?tab=overview&from=2016-12-01&to=2016-12-31`);
  }, 60_000);

  afterAll(async () => {
    await context?.close();
    await github?.close();
    rmSync(userDir, { recursive: true, force: true });
    rmSync(buildDir, { recursive: true, force: true });
  });

  const play = async (col: number, plies: number) => {
    await page.locator(`td.c4-cell[data-c4-col="${col}"]`).first().click();
    await page.waitForFunction(
      (n) => {
        const h = document.querySelector(".commit-four-hud")?.shadowRoot?.textContent ?? "";
        // the casual AI moves at random, so it can win early: a finished game ends a turn too
        return (
          /Your move|won game|Draw in game/.test(h) &&
          document.querySelectorAll("td.c4-cell[data-level='4'], td.c4-cell[data-level='2']").length >= n
        );
      },
      plies,
      { timeout: 20_000 },
    );
  };

  it("plays quick consecutive moves without 'changed elsewhere'", async () => {
    await hud().getByText("No games yet").waitFor({ timeout: 30_000 });
    await hud().locator("select").selectOption("casual");
    await page.getByRole("button", { name: "New game" }).click();
    await page.waitForFunction(() => document.querySelectorAll("td.c4-cell").length === 42, null, {
      timeout: 15_000,
    });
    await play(0, 2);
    await play(6, 4);
    await play(0, 6);
    expect(await hud().evaluate((h) => h.shadowRoot?.textContent ?? "")).not.toMatch(/changed elsewhere/);
    await page.waitForFunction(() => document.querySelectorAll(".c4-pending").length === 0, null, {
      timeout: 30_000,
    });
    expect(state().games[0]!.moves).toHaveLength(6);
  }, 120_000);

  it("changes difficulty mid-game", async () => {
    await hud().locator("select").selectOption("hard");
    await page.waitForFunction(() => document.querySelectorAll(".c4-pending").length === 0, null, {
      timeout: 30_000,
    });
    await play(1, 8);
    await expect.poll(() => state().games[0]!.difficulty, { timeout: 20_000 }).toBe("hard");
  }, 60_000);

  it("resigns, and the resignation survives a reload", async () => {
    // the AI may have won the last game: start another (the panel knows before the save lands)
    await page.waitForFunction(() => document.querySelectorAll(".c4-pending").length === 0, null, {
      timeout: 30_000,
    });
    const newGame = page.getByRole("button", { name: "New game" });
    if (await newGame.isVisible()) {
      const games = state().games.length;
      await newGame.click();
      await expect.poll(() => state().games.length, { timeout: 20_000 }).toBe(games + 1);
    }
    const id = state().games.at(-1)!.id;
    await page.getByRole("button", { name: "Resign" }).click();
    await hud().getByText(`You resigned game ${id}`).waitFor({ timeout: 15_000 });
    await expect.poll(() => state().games.at(-1)!.status, { timeout: 20_000 }).toBe("resigned");
    await page.reload();
    await hud().getByText(`You resigned game ${id}`).waitFor({ timeout: 30_000 });
  }, 90_000);

  it("opens Settings from the panel", async () => {
    const opened = context.waitForEvent("page", { timeout: 10_000 });
    await page.getByRole("button", { name: "Settings" }).click();
    const options = await opened;
    expect(options.url()).toBe(`chrome-extension://${extensionId}/options.html`);
  }, 30_000);
});
