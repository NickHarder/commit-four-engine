/**
 * End-to-end, the no-terminal path: install the extension, Sign in with GitHub (device flow),
 * Set up my board (the repo gets created), then play a move on the profile. GitHub is faked.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SENTINEL_FILE, STATE_PATH } from "@commit-four/core";
import type { BrowserContext, Route } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeAccount } from "../../core/test/fakeAccount";
import { calendarHtml } from "../../core/test/fixtures";
import { profilePage, withBackground } from "./fakeProfile";
import { canRunChromium, launchWithExtension } from "./launch";

const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, "..");
const OWNER = "NickHarder";
const EMAIL = "29993711+NickHarder@users.noreply.github.com";
const canRun = canRunChromium();

describe.skipIf(!canRun)("sign in with GitHub, create the board, play", () => {
  const account = new FakeAccount(OWNER, 29993711);
  let context: BrowserContext;
  let userDir: string;
  let buildDir: string;
  let extensionId: string;

  const countsByDate = () => {
    const out = new Map<string, number>();
    for (const c of account.repo("commit-four-board")?.history() ?? []) {
      if (c.author.email === EMAIL)
        out.set(c.author.date.slice(0, 10), (out.get(c.author.date.slice(0, 10)) ?? 0) + 1);
    }
    return out;
  };

  const forward = async (route: Route) => {
    const req = route.request();
    const res = await account.fetch(req.url(), {
      method: req.method(),
      headers: await req.allHeaders(),
      body: req.postData() ?? undefined,
    });
    await route.fulfill({ status: res.status, contentType: "application/json", body: await res.text() });
  };

  beforeAll(async () => {
    buildDir = mkdtempSync(join(tmpdir(), "c4-ext-"));
    execFileSync("node", ["build.mjs", "--out", buildDir], {
      cwd: extDir,
      env: { ...process.env, COMMIT_FOUR_CLIENT_ID: account.clientId },
    });
    userDir = mkdtempSync(join(tmpdir(), "c4-chrome-"));
    context = await launchWithExtension(buildDir, userDir);
    await context.route("https://api.github.com/**", forward);
    await context.route("https://github.com/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/login/")) return forward(route);
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
      return route.fulfill({ status: 404, body: "" });
    });
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    extensionId = new URL(sw.url()).host;
  }, 60_000);

  afterAll(async () => {
    await context?.close();
    rmSync(userDir, { recursive: true, force: true });
    rmSync(buildDir, { recursive: true, force: true });
  });

  it("goes from a fresh install to a move on the graph without a terminal", async () => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByRole("button", { name: "Sign in with GitHub" }).click();
    await options.locator("#user-code").getByText("WDJB-MJHT").waitFor({ timeout: 10_000 });
    await options.getByText("Signed in as").waitFor({ timeout: 15_000 });
    expect(await options.locator("#login").textContent()).toBe(`@${OWNER}`);

    await options.getByRole("button", { name: "Set up my board" }).click();
    await options.getByText(`Created ${OWNER}/commit-four-board.`).waitFor({ timeout: 15_000 });
    const repo = account.repo("commit-four-board")!;
    expect(JSON.parse(repo.file(SENTINEL_FILE)!).owner).toBe(OWNER);
    expect(repo.history().every((c) => c.author.email === "engine@commit-four.invalid")).toBe(true);
    const playHref = await options.locator("#play-link").getAttribute("href");
    // the profile's default (last 12 months) view: New game picks the board's year from the graph
    expect(playHref).toBe(`https://github.com/${OWNER}`);

    const page = await context.newPage();
    await page.goto(playHref!);
    await page.locator(".commit-four-hud").getByText("No games yet").waitFor({ timeout: 30_000 });
    await page.locator(".commit-four-hud select").selectOption("casual");
    await page.getByRole("button", { name: "New game" }).click();
    // 2016 is the newest empty year on this graph, so the page moves to the 2016 view
    await page.waitForURL(/from=2016-12-01/, { timeout: 15_000 });
    await page.waitForFunction(() => document.querySelectorAll("td.c4-cell").length === 42, null, {
      timeout: 15_000,
    });
    await page.locator('td.c4-cell[data-c4-col="3"]').first().click();
    await page
      .locator(".commit-four-hud")
      .getByText(/Your move/)
      .waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => document.querySelectorAll(".c4-pending").length === 0, null, {
      timeout: 30_000,
    });
    expect(JSON.parse(repo.file(STATE_PATH)!).games[0].moves).toMatch(/^4[1-7]$/);
    expect(countsByDate().get("2016-02-06")).toBe(4);
  }, 120_000);
});
