/**
 * Generates the Chrome Web Store images into packages/extension/store-assets/ from the real
 * extension running against the test fakes (a fictional account, no real data):
 *
 *   C4_STORE_ASSETS=1 npx vitest run packages/extension/test/store-assets.test.ts
 *
 * Skipped in normal test runs.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiWriter, GameEngine, initialState, SENTINEL_FILE, STATE_PATH } from "@commit-four/core";
import type { BrowserContext, Page } from "playwright-core";
import { afterAll, beforeAll, describe, it } from "vitest";
import { FakeGitHub } from "../../core/test/fakeGitHub";
import { calendarHtml } from "../../core/test/fixtures";
import { canRunChromium, extensionWorker, launchWithExtension } from "./launch";

const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, "..");
const outDir = join(extDir, "store-assets");
const OWNER = "alex-codes";
const EMAIL = "alex@example.com";
const SIZE = { width: 1280, height: 800 };

/**
 * A plain profile page in GitHub's light colors, without GitHub's logo or chrome. Drawn at 1.5x
 * so the board reads well in a 1280x800 screenshot.
 */
function profile(counts: Map<string, number>): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="user-login" content="${OWNER}"><title>${OWNER}</title>
<style>
  html { zoom: 1.5; }
  body { margin: 0; background: #fff; color: #1f2328; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
  .bar { height: 40px; background: #f6f8fa; border-bottom: 1px solid #d1d9e0; display: flex; align-items: center; gap: 12px; padding: 0 28px; }
  .url { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: #59636e; background: #fff; border: 1px solid #d1d9e0; border-radius: 6px; padding: 2px 10px; }
  .who { margin-left: auto; display: flex; align-items: center; gap: 8px; font-weight: 600; }
  .who i { width: 22px; height: 22px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #d0d7de, #8c959f); }
  main { max-width: 790px; margin: 18px auto 0; padding: 0 20px; }
  .tabs { border-bottom: 1px solid #d1d9e0; margin-bottom: 14px; padding-bottom: 6px; color: #59636e; }
  .tabs b { color: #1f2328; border-bottom: 2px solid #fd8c73; padding-bottom: 7px; }
  .js-calendar-graph { border: 1px solid #d1d9e0; border-radius: 6px; padding: 12px 14px; }
  .js-calendar-graph h2 { font-size: 15px; font-weight: 400; margin: 0 0 8px; }
  table.ContributionCalendar-grid { border-spacing: 3px; border-collapse: separate; }
  td.ContributionCalendar-day { width: 10px; height: 10px; padding: 0; border-radius: 2px; outline: 1px solid rgb(31 35 40 / 0.05); outline-offset: -1px; }
  td[data-level="0"] { background: #eff2f5; } td[data-level="1"] { background: #aceebb; }
  td[data-level="2"] { background: #4ac26b; } td[data-level="3"] { background: #2da44e; }
  td[data-level="4"] { background: #116329; }
  td.ContributionCalendar-label { width: 0; padding: 0; }
  .sr-only, tool-tip { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style></head><body>
<div class="bar"><span class="url">github.com/${OWNER}?from=2016-12-01&amp;to=2016-12-31</span><span class="who"><i></i>${OWNER}</span></div>
<main><div class="tabs"><b>Overview</b> &nbsp;&nbsp; Repositories &nbsp;&nbsp; Projects</div>
${calendarHtml(OWNER, "2016-01-01", "2016-12-31", counts)}
</main></body></html>`;
}

const PROMO = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 440px; height: 280px; overflow: hidden; }
  body { background: linear-gradient(135deg, #0d1117 0%, #10301c 100%); color: #fff;
    font: 15px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
    display: flex; align-items: center; gap: 26px; padding: 0 30px; box-sizing: border-box; }
  .grid { display: grid; grid-template-columns: repeat(7, 18px); gap: 4px; flex: none; }
  .grid i { width: 18px; height: 18px; border-radius: 3px; background: #161b22; outline: 1px solid #30363d; outline-offset: -1px; }
  .grid i.h { background: #39d353; outline: none; } .grid i.a { background: #006d32; outline: none; }
  .grid i.w { box-shadow: 0 0 0 2px #e3b341; }
  h1 { font-size: 32px; line-height: 1.1; margin: 0 0 8px; letter-spacing: -0.5px; white-space: nowrap; }
  p { margin: 0; color: #c9d1d9; }
</style></head><body>
<div class="grid">${(() => {
  // rows top to bottom; h = yours, a = the AI's, w = the winning four
  const rows = [".......", ".......", "...h...", "..ha...", ".hah...", "hahaa.."];
  const win = new Set(["2,3", "3,2", "4,1", "5,0"]);
  return rows
    .flatMap((r, y) =>
      [...r].map((c, x) => {
        const cls = [c === "h" ? "h" : c === "a" ? "a" : "", win.has(`${y},${x}`) ? "w" : ""]
          .join(" ")
          .trim();
        return `<i class="${cls}"></i>`;
      }),
    )
    .join("");
})()}</div>
<div><h1>Commit Four</h1><p>Four in a row against an AI, played on your own GitHub contribution graph.</p></div>
</body></html>`;

/** The large (marquee) promo tile, 1400x560: the same design as the small tile, with more room. */
const MARQUEE = PROMO.replace("width: 440px; height: 280px;", "width: 1400px; height: 560px;")
  .replace("gap: 26px; padding: 0 30px;", "gap: 80px; padding: 0 120px;")
  .replace(
    "grid-template-columns: repeat(7, 18px); gap: 4px;",
    "grid-template-columns: repeat(7, 46px); gap: 10px;",
  )
  .replace("width: 18px; height: 18px; border-radius: 3px;", "width: 46px; height: 46px; border-radius: 8px;")
  .replace(
    "outline: 1px solid #30363d; outline-offset: -1px; }",
    "outline: 2px solid #30363d; outline-offset: -2px; }",
  )
  .replace("box-shadow: 0 0 0 2px #e3b341;", "box-shadow: 0 0 0 4px #e3b341;")
  .replace("font-size: 32px;", "font-size: 84px;")
  .replace("font: 15px/1.4", "font: 30px/1.4")
  .replace("margin: 0 0 8px;", "margin: 0 0 20px;");

describe.skipIf(!process.env.C4_STORE_ASSETS || !canRunChromium())("Chrome Web Store images", () => {
  let gh: FakeGitHub;
  let context: BrowserContext;
  let page: Page;
  let userDir: string;
  let buildDir: string;
  let extensionId: string;
  const countsByDate = () => {
    const out = new Map<string, number>();
    for (const c of gh.history())
      if (c.author.email === EMAIL)
        out.set(c.author.date.slice(0, 10), (out.get(c.author.date.slice(0, 10)) ?? 0) + 1);
    return out;
  };
  const shoot = (p: Page, name: string) =>
    p.screenshot({ path: join(outDir, name), type: "png", animations: "disabled", caret: "hide" });

  beforeAll(async () => {
    mkdirSync(outDir, { recursive: true });
    buildDir = mkdtempSync(join(tmpdir(), "c4-ext-"));
    execFileSync("node", ["build.mjs", "--out", buildDir], { cwd: extDir });
    gh = new FakeGitHub(OWNER, "commit-four-board", {
      [SENTINEL_FILE]: JSON.stringify({ commitFour: 1, owner: OWNER, boardId: "store" }),
      [STATE_PATH]: JSON.stringify(initialState(OWNER)),
    });
    // game 1, already won: your bottom row (columns 3-6) under the AI's three
    const ai = [2, 3, 4];
    const seed = new GameEngine({
      writer: new ApiWriter({
        owner: OWNER,
        repo: "commit-four-board",
        token: "t",
        fetch: gh.fetch,
        minIntervalMs: 0,
      }),
      owner: OWNER,
      pieceAuthor: { name: "Alex Rivera", email: EMAIL },
      chooser: () => ai.shift()!,
    });
    await seed.load();
    await (await seed.newGame({ difficulty: "hard", humanFirst: true, season: 2016 })).written;
    for (const [ply, col] of [
      [0, 2],
      [2, 3],
      [4, 4],
      [6, 5],
    ] as const)
      await (await seed.move(1, ply, col)).written;

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
      if (url.pathname === `/users/${OWNER}/contributions`)
        return route.fulfill({
          contentType: "text/html",
          body: calendarHtml(
            OWNER,
            url.searchParams.get("from")!,
            url.searchParams.get("to")!,
            countsByDate(),
          ),
        });
      if (url.pathname === `/${OWNER}`)
        return route.fulfill({ contentType: "text/html", body: profile(countsByDate()) });
      return route.fulfill({ status: 404, body: "" });
    });
    const sw = await extensionWorker(context);
    extensionId = new URL(sw.url()).host;
    await sw.evaluate((settings) => chrome.storage.local.set({ settings }), {
      mode: "browser",
      authKind: "oauth",
      owner: OWNER,
      repo: "commit-four-board",
      branch: "main",
      helperPort: 47474,
      helperToken: "",
      pat: "gho_store_assets",
      author: { name: "Alex Rivera", email: EMAIL },
    });
    page = await context.newPage();
    await page.setViewportSize(SIZE);
  }, 120_000);

  afterAll(async () => {
    await context?.close();
    rmSync(userDir, { recursive: true, force: true });
    rmSync(buildDir, { recursive: true, force: true });
  });

  it("screenshot: a finished game, with the winning four highlighted", async () => {
    await page.goto(`https://github.com/${OWNER}?tab=overview&from=2016-12-01&to=2016-12-31`);
    await page.locator(".commit-four-hud").getByText("You won game 1").waitFor({ timeout: 30_000 });
    await page.mouse.move(5, 5);
    await shoot(page, "screenshot-2-won.png");
  }, 60_000);

  it("screenshot: a game in progress, both shades, the panel saying it's your move", async () => {
    const hud = page.locator(".commit-four-hud");
    await hud.locator("select").selectOption("hard");
    await page.getByRole("button", { name: "New game" }).click();
    await page.waitForFunction(() => document.querySelectorAll("td.c4-cell").length === 42, null, {
      timeout: 15_000,
    });
    for (const col of [3, 2, 3, 4]) {
      await page.locator(`td.c4-cell[data-c4-col="${col}"]`).first().click();
      await hud.getByText(/Your move/).waitFor({ timeout: 20_000 });
      await page.waitForFunction(() => document.querySelectorAll(".c4-pending").length === 0, null, {
        timeout: 30_000,
      });
    }
    await hud.getByText(/GitHub caught up/).waitFor({ timeout: 30_000 });
    await page.mouse.move(5, 5);
    await shoot(page, "screenshot-1-playing.png");
  }, 120_000);

  it("screenshot: the settings page", async () => {
    const options = await context.newPage();
    await options.setViewportSize(SIZE);
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByText("Signed in as").waitFor({ timeout: 10_000 });
    await options.addStyleTag({ content: "html { scrollbar-width: none; }" });
    await shoot(options, "screenshot-3-settings.png");
    await options.close();
  }, 30_000);

  it("store icon (the extension's own 128 px icon)", () => {
    copyFileSync(join(buildDir, "icons", "icon-128.png"), join(outDir, "store-icon-128.png"));
  });

  it("marquee promo tile", async () => {
    const tile = await context.newPage();
    await tile.setViewportSize({ width: 1400, height: 560 });
    await tile.setContent(MARQUEE);
    await shoot(tile, "promo-marquee-1400x560.png");
    await tile.close();
  }, 30_000);

  it("small promo tile", async () => {
    const tile = await context.newPage();
    await tile.setViewportSize({ width: 440, height: 280 });
    await tile.setContent(PROMO);
    await shoot(tile, "promo-small-440x280.png");
    await tile.close();
  }, 30_000);
});
