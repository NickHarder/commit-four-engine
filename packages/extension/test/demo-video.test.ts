/**
 * Records the Chrome Web Store promo video: the real extension, scripted, on a mock profile of a
 * fictional account, against the test fakes (no real GitHub). You lose to the Perfect AI.
 *
 *   C4_DEMO_VIDEO=1 npx vitest run packages/extension/test/demo-video.test.ts
 *
 * Writes packages/extension/store-assets/commit-four-demo-1080p.mp4 (and a thumbnail), with an
 * 8-bit soundtrack and sound effects from demoAudio.ts on the moments they belong to. Needs ffmpeg
 * with libx264. Skipped in normal test runs.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chooseMove,
  initialState,
  Position,
  SENTINEL_FILE,
  Solver,
  STATE_PATH,
  WIDTH,
} from "@commit-four/core";
import { PERFECT_BOOK } from "@commit-four/core/defaultBook";
import type { BrowserContext, Page } from "playwright-core";
import { afterAll, beforeAll, describe, it } from "vitest";
import { FakeGitHub } from "../../core/test/fakeGitHub";
import { calendarHtml } from "../../core/test/fixtures";
import { type Sfx, soundtrackWav } from "./demoAudio";
import { CURSOR_SCRIPT, captionScript, demoCard, demoProfile } from "./demoScenes";
import { withBackground } from "./fakeProfile";
import { canRunChromium, extensionWorker, launchWithExtension } from "./launch";

const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, "..");
const outDir = join(extDir, "store-assets");
const OWNER = "alex-codes";
const EMAIL = "alex@example.com";
/** How long GitHub takes to show a new commit on the graph, so "pending" squares are visible. */
const GRAPH_LAG_MS = 1200;

/** Deterministic random numbers for the human's moves. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * The human's columns for a short, believable loss: Casual play (takes wins, blocks threats)
 * against the Perfect AI with the extension's own settings, over a range of seeds; the shortest
 * game the AI wins with a double threat (the human's last move had no safe answer).
 */
function planLoss(): { human: number[]; moves: number[] } {
  let best: { human: number[]; moves: number[] } | null = null;
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seeded(seed);
    const solver = new Solver({ ttLog2Size: 22 });
    const moves: number[] = [];
    const human: number[] = [];
    let aiWon = false;
    let forced = false;
    while (moves.length < 42) {
      const pos = Position.fromMoves(moves);
      const humanToMove = moves.length % 2 === 0;
      if (humanToMove) {
        forced = ![...Array(WIDTH).keys()].some((c) => {
          if (!pos.canPlay(c)) return false;
          const p = pos.clone();
          p.play(c);
          return !p.canWinNext();
        });
      }
      const col = humanToMove
        ? chooseMove(moves, { difficulty: "casual", rng }).col
        : chooseMove(moves, { difficulty: "perfect", solver, book: PERFECT_BOOK }).col;
      const wins = pos.isWinningMove(col);
      moves.push(col);
      if (humanToMove) human.push(col);
      if (wins) {
        aiWon = !humanToMove;
        break;
      }
    }
    if (aiWon && forced && (!best || moves.length < best.moves.length)) best = { human, moves };
  }
  if (!best) throw new Error("no short loss found");
  return best;
}

describe.skipIf(!process.env.C4_DEMO_VIDEO || !canRunChromium())("demo video", () => {
  let gh: FakeGitHub;
  let context: BrowserContext;
  let page: Page;
  let userDir: string;
  let buildDir: string;
  let work: string;
  /** When each commit was first seen (the fake's commits are stable objects). */
  const seen = new Map<object, number>();

  /** Board commits GitHub "shows" so far: each one appears GRAPH_LAG_MS after it was written. */
  const graphCounts = () => {
    const now = Date.now();
    const out = new Map<string, number>();
    for (const c of gh.history()) {
      if (c.author.email !== EMAIL || now - (seen.get(c) ?? now) < GRAPH_LAG_MS) continue;
      out.set(c.author.date.slice(0, 10), (out.get(c.author.date.slice(0, 10)) ?? 0) + 1);
    }
    return withBackground(out);
  };
  const noteCommits = () => {
    for (const c of gh.history()) if (!seen.has(c)) seen.set(c, Date.now());
  };

  beforeAll(async () => {
    mkdirSync(outDir, { recursive: true });
    work = mkdtempSync(join(tmpdir(), "c4-demo-"));
    buildDir = mkdtempSync(join(tmpdir(), "c4-ext-"));
    execFileSync("node", ["build.mjs", "--out", buildDir], { cwd: extDir });
    gh = new FakeGitHub(OWNER, "commit-four-board", {
      [SENTINEL_FILE]: JSON.stringify({ commitFour: 1, owner: OWNER, boardId: "demo" }),
      [STATE_PATH]: JSON.stringify(initialState(OWNER)),
    });
    userDir = mkdtempSync(join(tmpdir(), "c4-chrome-"));
    context = await launchWithExtension(buildDir, userDir, {
      // 2x has no rounding: at 1.5x the page height can't land on exactly 720
      window: { width: 1280, height: 720, scale: 2 },
    });
    await context.addInitScript(CURSOR_SCRIPT);
    await context.route("https://api.github.com/**", async (route) => {
      const req = route.request();
      const res = await gh.fetch(req.url(), {
        method: req.method(),
        headers: await req.allHeaders(),
        body: req.postData() ?? undefined,
      });
      noteCommits();
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
            graphCounts(),
          ),
        });
      if (url.pathname === `/${OWNER}`)
        return route.fulfill({ contentType: "text/html", body: demoProfile(OWNER, graphCounts()) });
      return route.fulfill({ status: 404, body: "" });
    });
    const sw = await extensionWorker(context);
    await sw.evaluate((settings) => chrome.storage.local.set({ settings }), {
      mode: "browser",
      authKind: "oauth",
      owner: OWNER,
      repo: "commit-four-board",
      branch: "main",
      helperPort: 47474,
      helperToken: "",
      pat: "gho_demo",
      author: { name: "Alex Rivera", email: EMAIL },
    });
    page = await context.newPage();
    // the window size includes the browser's toolbars: grow it until the page area is 1280x720
    const cdp = await context.newCDPSession(page);
    const { windowId } = (await cdp.send("Browser.getWindowForTarget")) as { windowId: number };
    for (let i = 0; i < 4; i++) {
      const a = await page.evaluate(() => ({ h: innerHeight, oh: outerHeight }));
      if (a.h === 720) break;
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { height: a.oh + (720 - a.h) } });
      await page.waitForTimeout(300);
    }
    await page.waitForFunction(() => innerWidth === 1280 && innerHeight === 720, null, { timeout: 5_000 });
    await cdp.detach();
  }, 120_000);

  afterAll(async () => {
    await context?.close();
    for (const d of [userDir, buildDir, work]) if (d) rmSync(d, { recursive: true, force: true });
  });

  it("records the promo video", async () => {
    const plan = planLoss();

    // --- cards -----------------------------------------------------------------------------------
    const cards = {
      hook1: demoCard({ title: "Bored while coding?", size: 92 }),
      hook2: demoCard({ title: "Done jumping a dino<br>over cacti?", size: 84 }),
      title: demoCard({
        board: true,
        title: "Commit Four",
        subtitle: "Four in a row against an AI,<br>right on your GitHub contribution graph.",
      }),
      end: demoCard({
        title: "Can you beat it?",
        size: 92,
        subtitle: "Commit Four · free on the Chrome Web Store",
        note: "Unofficial · not affiliated with GitHub",
      }),
    };
    const cardPage = await context.newPage();
    for (const [name, html] of Object.entries(cards)) {
      await cardPage.setContent(html);
      await cardPage.screenshot({ path: join(work, `${name}.png`) });
    }
    await cardPage.close();

    // --- the game, recorded ----------------------------------------------------------------------
    await page.goto(`https://github.com/${OWNER}?tab=overview&from=2016-12-01&to=2016-12-31`);
    const hud = page.locator(".commit-four-hud");
    await hud.getByText("No games yet").waitFor({ timeout: 30_000 });
    await page.mouse.move(1210, 330);
    // GitHub's heading only changes on reload; here it follows the graph, so the count climbs
    await page.evaluate((owner) => {
      const h2 = document.querySelector("#c4-total");
      setInterval(async () => {
        const html = await (
          await fetch(`/users/${owner}/contributions?from=2016-01-01&to=2016-12-31`)
        ).text();
        const m = /\d[\d,]* contributions? in 2016/.exec(html);
        if (h2 && m) h2.textContent = m[0];
      }, 400);
    }, OWNER);

    const cdp = await context.newCDPSession(page);
    const frames: { file: string; t: number }[] = [];
    cdp.on(
      "Page.screencastFrame",
      (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
        const file = join(work, `f${String(frames.length).padStart(5, "0")}.jpg`);
        writeFileSync(file, Buffer.from(f.data, "base64"));
        frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
        void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
      },
    );
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080 });
    await page.waitForTimeout(300);
    const first =
      frames[0] &&
      execFileSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        frames[0].file,
      ])
        .toString()
        .trim();
    if (first !== "1920,1080") throw new Error(`screencast frames are ${first}, expected 1920,1080`);

    const pause = (ms: number) => page.waitForTimeout(ms);
    /** Sound effects, at wall-clock seconds (the screencast's clock). */
    const sounds: { t: number; sfx: Sfx }[] = [];
    const sound = (sfx: Sfx) => sounds.push({ t: Date.now() / 1000, sfx });
    /** Stretches the edit keeps at full length (the page is still, so few frames arrive). */
    const holds: [number, number][] = [];
    const hold = async (ms: number) => {
      const from = Date.now() / 1000;
      await pause(ms);
      holds.push([from, Date.now() / 1000]);
    };
    const caption = (text: string | null) => page.evaluate(captionScript(text));
    const glide = async (sel: string) => {
      const box = (await page.locator(sel).first().boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
    };
    const clickAt = async (sel: string, sfx: Sfx = "pop") => {
      await glide(sel);
      await page.mouse.down();
      sound(sfx);
      await pause(60);
      await page.mouse.up();
    };
    /**
     * The camera: a transform on <body>, so the cursor and captions (on <html>) stay put. "year"
     * frames the heading, the whole year and the Commit Four panel; "board" moves in on the game,
     * within the calendar card.
     */
    const camera = async (shot: "year" | "board") => {
      sound("whoosh");
      await page.evaluate((shot) => {
        const b = document.body;
        const was = b.style.transform;
        b.style.transition = "none";
        b.style.transform = "none";
        const union = (sel: string) => {
          const rs = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect());
          const x0 = Math.min(...rs.map((r) => r.left));
          const y0 = Math.min(...rs.map((r) => r.top));
          return {
            x0,
            y0,
            w: Math.max(...rs.map((r) => r.right)) - x0,
            h: Math.max(...rs.map((r) => r.bottom)) - y0,
          };
        };
        const year = union("#c4-total, .js-calendar-graph, .commit-four-hud");
        const card = union(".js-calendar-graph");
        const board = union("td.c4-cell");
        b.style.transform = was;
        void b.offsetWidth; // start the transition from where the camera was
        b.style.transformOrigin = "0 0";
        b.style.transition = "transform .8s cubic-bezier(.4, 0, .2, 1)";
        const [W, H] = [innerWidth, innerHeight - 100]; // room at the bottom for the captions
        let s: number;
        let tx: number;
        let ty: number;
        if (shot === "year") {
          s = Math.min((W - 48) / year.w, (H - 24) / year.h);
          tx = (W - year.w * s) / 2 - year.x0 * s;
          ty = 22 - year.y0 * s;
        } else {
          // the board centred, but never past the card's left edge (that's the sidebar)
          s = Math.min(3.6, (H - 40) / card.h);
          tx = Math.min(W / 2 - (board.x0 + board.w / 2) * s, 24 - card.x0 * s);
          ty = (H - card.h * s) / 2 - card.y0 * s;
        }
        b.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      }, shot);
      await pause(850);
    };
    const hudText = () => hud.evaluate((h) => h.shadowRoot?.textContent ?? "");

    // the wide shot first: a GitHub profile, then in to the graph
    await hold(1100);
    await camera("year");
    await glide(".commit-four-hud >> select");
    sound("tick");
    await hud.locator("select").selectOption("perfect");
    await pause(350);
    await clickAt(".commit-four-hud >> button[name=newGame]", "tick");
    await page.waitForFunction(() => document.querySelectorAll("td.c4-cell").length === 42, null, {
      timeout: 15_000,
    });
    await caption("Click a column. Every piece is a real commit.");
    await pause(300);

    const captions: Record<number, string> = {
      3: "Impress your coworkers with all those contributions.",
      6: "(Definitely not a vanity metric ;)",
    };
    for (let i = 0; i < plan.human.length; i++) {
      if (captions[i]) await caption(captions[i]!);
      if (i === plan.human.length - 1) {
        // the trap: point at the square the AI will win on, then block the other threat anyway
        await caption("Uh-oh. Two threats at once…");
        sound("uhoh");
        await glide(`td.c4-cell[data-c4-col="${plan.moves.at(-1)}"]`);
        await hold(700);
      }
      await clickAt(`td.c4-cell[data-c4-col="${plan.human[i]}"]`);
      await page.waitForFunction(
        () =>
          /Your move|won game/.test(
            document.querySelector(".commit-four-hud")?.shadowRoot?.textContent ?? "",
          ),
        null,
        { timeout: 20_000 },
      );
      sound("bloop"); // the AI's piece
      await pause(i === plan.human.length - 1 ? 200 : 380);
    }
    if (!/The AI won/.test(await hudText())) throw new Error(`expected an AI win: ${await hudText()}`);
    const lostAt = Date.now() / 1000;
    sounds.push({ t: lostAt + 0.3, sfx: "womp" });
    await page.mouse.move(1180, 640, { steps: 10 });
    await caption("Perfect AI 1 · You 0");
    // in on the AI's four. No waiting for every square to turn solid: the extension writes at most
    // 6 times a minute (GitHub's guidance), so after a game this fast the last squares stay pending
    await hold(300);
    await camera("board");
    await hold(1500);
    await cdp.send("Page.stopScreencast");
    frames.push({ file: frames.at(-1)!.file, t: Date.now() / 1000 });

    // --- edit -------------------------------------------------------------------------------------
    // frames -> constant 30 fps; idle stretches (waiting on the AI or GitHub) are trimmed to keep
    // the pace up, except the holds
    const list = [];
    const durs: number[] = [];
    for (let i = 0; i < frames.length - 1; i++) {
      const [a, b] = [frames[i]!.t, frames[i + 1]!.t];
      const held = holds.reduce(
        (sum, [from, to]) => sum + Math.max(0, Math.min(b, to) - Math.max(a, from)),
        0,
      );
      durs.push(Math.min(b - a, 0.55 + held));
      list.push(`file '${frames[i]!.file}'`, `duration ${durs[i]!.toFixed(4)}`);
    }
    list.push(`file '${frames.at(-1)!.file}'`);
    /** Where a wall-clock moment of the recording lands in the trimmed capture. */
    const captureTime = (t: number) => {
      let out = 0;
      for (let i = 0; i < durs.length; i++) {
        if (t < frames[i + 1]!.t) return out + Math.min(Math.max(0, t - frames[i]!.t), durs[i]!);
        out += durs[i]!;
      }
      return out;
    };
    writeFileSync(join(work, "frames.txt"), `ffconcat version 1.0\n${list.join("\n")}\n`);
    const capture = join(work, "capture.mp4");
    const ff = (args: string[]) =>
      execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    ff([
      ...["-f", "concat", "-safe", "0", "-i", join(work, "frames.txt")],
      ...["-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p"],
      ...["-c:v", "libx264", "-crf", "16", "-preset", "medium", capture],
    ]);
    const captureSecs = Number(
      execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", capture])
        .toString()
        .trim(),
    );

    const parts: { input: string[]; secs: number }[] = [
      { input: ["-loop", "1", "-framerate", "30", "-t", "1.7", "-i", join(work, "hook1.png")], secs: 1.7 },
      { input: ["-loop", "1", "-framerate", "30", "-t", "1.9", "-i", join(work, "hook2.png")], secs: 1.9 },
      { input: ["-loop", "1", "-framerate", "30", "-t", "2.3", "-i", join(work, "title.png")], secs: 2.3 },
      { input: ["-i", capture], secs: captureSecs },
      { input: ["-loop", "1", "-framerate", "30", "-t", "3.0", "-i", join(work, "end.png")], secs: 3.0 },
    ];
    const X = 0.3; // crossfade
    const filters = parts.map(
      (_, i) => `[${i}:v]fps=30,scale=1920:1080:flags=lanczos,format=yuv420p,setsar=1,settb=AVTB[v${i}]`,
    );
    let prev = "v0";
    let offset = 0;
    for (let i = 1; i < parts.length; i++) {
      offset += parts[i - 1]!.secs - X;
      const out = i === parts.length - 1 ? "joined" : `x${i}`;
      filters.push(`[${prev}][v${i}]xfade=transition=fade:duration=${X}:offset=${offset.toFixed(3)}[${out}]`);
      prev = out;
    }
    const total = offset + parts.at(-1)!.secs;
    filters.push(`[joined]fade=t=in:st=0:d=0.25,fade=t=out:st=${(total - 0.45).toFixed(3)}:d=0.45[out]`);

    // --- sound -----------------------------------------------------------------------------------
    const starts = parts.map((_, i) => parts.slice(0, i).reduce((sum, p) => sum + p.secs - X, 0));
    const [, hook2At, titleAt, captureAt, endAt] = starts as [number, number, number, number, number];
    const soundtrack = join(work, "soundtrack.wav");
    writeFileSync(
      soundtrack,
      soundtrackWav({
        secs: total,
        dropAt: titleAt,
        musicEnd: captureAt + captureTime(lostAt),
        events: [
          { t: hook2At + 0.2, sfx: "jump" },
          { t: titleAt, sfx: "chime" },
          ...sounds.map((s) => ({ t: captureAt + captureTime(s.t), sfx: s.sfx })),
          { t: endAt + 0.15, sfx: "jingle" },
        ],
      }),
    );
    const video = join(outDir, "commit-four-demo-1080p.mp4");
    ff([
      ...parts.flatMap((p) => p.input),
      ...["-i", soundtrack],
      ...["-filter_complex", filters.join(";"), "-map", "[out]", "-map", `${parts.length}:a`],
      ...["-c:a", "aac", "-b:a", "192k"],
      ...[
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "slow",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
      ],
      video,
    ]);
    ff([
      "-i",
      join(work, "title.png"),
      "-vf",
      "scale=1280:720:flags=lanczos",
      join(outDir, "commit-four-demo-thumbnail.png"),
    ]);
    console.log(
      `demo: ${video} (${total.toFixed(1)}s, ${plan.moves.length} plies: ${plan.moves.map((c) => c + 1).join("")})`,
    );
  }, 300_000);
});
