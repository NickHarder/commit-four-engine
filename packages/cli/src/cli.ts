/**
 * commit-four — play Connect 4 against an AI on your GitHub contribution graph.
 *
 *   commit-four init <owner>/<repo>   set up (or create) a board repo and clone it locally
 *   commit-four serve                 run the local helper the browser extension talks to
 *   commit-four play                  play in the terminal instead
 *   commit-four status | doctor | pair
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  boardFiles,
  currentGame,
  DEFAULT_SEASON,
  DIFFICULTIES,
  type Difficulty,
  GameEngine,
  playerToMove,
  randomBoardId,
  seasonProfileUrl,
  UNCLAIMED_OWNER,
} from "@commit-four/core";
import { PERFECT_BOOK } from "@commit-four/core/defaultBook";
import { describeStatus, renderBoard } from "./board";
import {
  type BoardConfig,
  type Config,
  currentBoard,
  homeDir,
  loadConfig,
  newToken,
  saveConfig,
} from "./config";
import { type Check, printChecks, runDoctor } from "./doctor";
import { GitWriter, git } from "./git";
import { resolveIdentity } from "./identity";
import { FORK_HELP, originRepo, repoInfo } from "./repo";
import { createHelperServer, type WriteStatus } from "./server";

const VERSION = "0.1.0";

interface Args {
  command: string;
  positional: string[];
  flags: Map<string, string | true>;
}

export function parseArgs(argv: string[]): Args {
  const [command = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      if (v !== undefined) flags.set(k, v);
      else if (rest[i + 1] !== undefined && !rest[i + 1]!.startsWith("--")) flags.set(k, rest[++i]!);
      else flags.set(k, true);
    } else positional.push(a);
  }
  return { command, positional, flags };
}

function flag(args: Args, name: string): string | undefined {
  const v = args.flags.get(name);
  return typeof v === "string" ? v : undefined;
}

function engineFor(
  board: BoardConfig,
  writer: GitWriter,
  onEvent?: ConstructorParameters<typeof GameEngine>[0]["onEvent"],
) {
  return new GameEngine({
    writer,
    owner: board.owner,
    pieceAuthor: board.author,
    book: PERFECT_BOOK,
    ...(onEvent ? { onEvent } : {}),
  });
}

async function init(args: Args): Promise<void> {
  const spec = args.positional[0];
  const m = spec ? /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(spec) : null;
  if (!m) throw new Error("usage: commit-four init <owner>/<repo> [--create] [--email you@example.com]");
  const [, owner, repo] = m as unknown as [string, string, string];
  await initBoard(owner, repo, args);
}

/** `commit-four setup`: make the repo you're standing in (a "Use this template" copy) your board. */
async function setup(args: Args): Promise<void> {
  const board = flag(args, "board");
  if (board) {
    await init({ ...args, positional: [board] });
    return;
  }
  const ref = await originRepo();
  if (!ref) {
    throw new Error(
      "couldn't find a GitHub `origin` remote here. Run this inside a clone of your copy of Commit Four, or pass --board <you>/<repo>.",
    );
  }
  console.log(`setting up github.com/${ref.owner}/${ref.repo} as your Commit Four board ...`);
  await initBoard(ref.owner, ref.repo, args);
}

async function initBoard(owner: string, repo: string, args: Args): Promise<void> {
  const branch = flag(args, "branch") ?? "main";
  const author = await resolveIdentity(owner, { email: flag(args, "email"), name: flag(args, "name") });
  if (args.flags.has("create")) {
    console.log(`creating github.com/${owner}/${repo} with gh ...`);
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve, reject) =>
      execFile(
        "gh",
        [
          "repo",
          "create",
          `${owner}/${repo}`,
          args.flags.has("private") ? "--private" : "--public",
          "--description",
          "My Commit Four board (Connect 4 on my contribution graph)",
        ],
        (err, _out, stderr) =>
          err ? reject(new Error(`gh repo create failed: ${stderr || err.message}`)) : resolve(),
      ),
    );
  }
  const info = await repoInfo({ owner, repo });
  if (info?.fork)
    throw new Error(`${owner}/${repo} is a fork${info.parent ? ` of ${info.parent}` : ""}.\n${FORK_HELP}`);
  const dir = join(homeDir(), "repos", owner, `${repo}.git`);
  if (!existsSync(dir)) {
    await mkdir(dirname(dir), { recursive: true });
    console.log(`cloning ${owner}/${repo} ...`);
    await git(dirname(dir), ["clone", "--quiet", "--bare", `https://github.com/${owner}/${repo}.git`, dir]);
  }
  const writer = new GitWriter({ dir, branch });
  const board: BoardConfig = { owner, repo, branch, dir, author };
  if (!(await writer.remoteHasBranch())) {
    console.log("empty repo: writing the board files ...");
    await writer.bootstrap(boardFiles(owner, randomBoardId()), `c4: set up Commit Four board for ${owner}`);
  } else {
    const remote = await writer.readState({ refresh: true });
    if (!remote.sentinel) {
      throw new Error(
        `${owner}/${repo} isn't a Commit Four board (no .commit-four-board file). Use an empty repo or a "Use this template" copy of Commit Four; it never writes to other repos.`,
      );
    }
    if (remote.sentinel.owner === UNCLAIMED_OWNER) {
      console.log("claiming the board for you ...");
      await engineFor(board, writer).claim(`${owner}/${repo}`);
    } else if (remote.sentinel.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error(`this board belongs to ${remote.sentinel.owner}`);
    }
  }
  const config = await loadConfig();
  config.boards[`${owner}/${repo}`] = board;
  config.current = `${owner}/${repo}`;
  await saveConfig(config);
  console.log(`
Board ready: github.com/${owner}/${repo}
Piece commits will be authored as ${author.email}.
${info?.private ? "\nThis repo is private: turn on Settings > Public profile > 'Include private contributions' or the board won't show.\n" : ""}
Next:
  1. Load the extension: chrome://extensions > Developer mode > Load unpacked > packages/extension/build
  2. Start the helper and paste its pairing token into the extension:  npm run serve
  3. Open ${seasonProfileUrl(owner, DEFAULT_SEASON)} and click "New game"
     (or play in the terminal:  npm run play)
Check visibility settings any time with:  npm run doctor`);
}

async function serve(args: Args): Promise<void> {
  const config = await loadConfig();
  const board = currentBoard(config, flag(args, "board"));
  const port = Number(flag(args, "port") ?? config.helper.port);
  const status: WriteStatus = { pending: 0 };
  const writer = new GitWriter({ dir: board.dir, branch: board.branch });
  const engine = engineFor(board, writer);
  await engine.load(true);
  const server = createHelperServer({
    engine,
    token: config.helper.token,
    port,
    status,
    meta: { owner: board.owner, repo: board.repo, version: VERSION },
    ...(config.helper.extensionOrigin ? { extensionOrigin: config.helper.extensionOrigin } : {}),
    onPair: async (origin) => {
      const fresh = await loadConfig();
      fresh.helper.extensionOrigin = origin;
      await saveConfig(fresh);
    },
    log: (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`),
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const game = currentGame(engine.current());
  const season = game?.placement.season;
  console.log(`Commit Four helper for ${board.owner}/${board.repo} on http://127.0.0.1:${port}
Pairing token (paste into the extension once): ${config.helper.token}
${config.helper.extensionOrigin ? `Paired with ${config.helper.extensionOrigin}\n` : ""}
Open your profile${season ? `: ${seasonProfileUrl(board.owner, season)}` : " and start a game from the Commit Four panel"}
Ctrl+C to stop (queued writes finish first).`);
  const stop = async () => {
    server.close();
    await engine.flush();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

async function play(args: Args): Promise<void> {
  const config = await loadConfig();
  const board = currentBoard(config, flag(args, "board"));
  const writer = new GitWriter({ dir: board.dir, branch: board.branch });
  const engine = engineFor(board, writer, (e) => {
    if (e.type === "write-done" && e.commits > 0)
      console.log(`  ↳ pushed ${e.commits} commits in ${(e.ms / 1000).toFixed(1)}s`);
    if (e.type === "write-failed") console.log(`  ↳ write failed: ${e.error}`);
  });
  await engine.load(true);
  const rl = createInterface({ input: process.stdin, terminal: process.stdin.isTTY });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt: string): Promise<string | null> => {
    process.stdout.write(prompt);
    const next = await lines.next();
    if (next.done) {
      process.stdout.write("\n");
      return null;
    }
    return next.value;
  };
  try {
    let game = currentGame(engine.current());
    if (!game) {
      const difficulty = (flag(args, "difficulty") ?? "hard") as Difficulty;
      if (!DIFFICULTIES.includes(difficulty))
        throw new Error(`--difficulty must be one of ${DIFFICULTIES.join(", ")}`);
      const humanFirst = !args.flags.has("ai-first");
      if (difficulty === "perfect" && !humanFirst)
        console.log("Heads up: Perfect moving first can't be beaten (Connect 4 is solved).");
      const t = await engine.newGame({ difficulty, humanFirst });
      if (t.aiCol !== null) console.log(`AI opens in column ${t.aiCol + 1}`);
      game = currentGame(t.state)!;
    }
    console.log(`Game ${game.id} · ${game.difficulty} · season ${game.placement.season ?? "rolling"}`);
    if (game.placement.season)
      console.log(`Watch it on: ${seasonProfileUrl(board.owner, game.placement.season)}`);
    while (game && game.status === "in_progress") {
      console.log(`\n${renderBoard(game)}\n`);
      if (playerToMove(game) !== "human") throw new Error("unexpected: AI to move");
      const answer = (await ask("Your move (1-7, r = resign, q = quit): "))?.trim().toLowerCase() ?? "q";
      if (answer === "q") break;
      if (answer === "r") {
        game = (await engine.resign(game.id)).state.games.at(-1)!;
        break;
      }
      const col = Number(answer) - 1;
      if (!Number.isInteger(col) || col < 0 || col > 6) {
        console.log("Pick a column from 1 to 7.");
        continue;
      }
      try {
        const t = await engine.move(game.id, game.moves.length, col);
        if (t.aiCol !== null) console.log(`AI plays column ${t.aiCol + 1}`);
        game = t.state.games.at(-1)!;
      } catch (e) {
        console.log(e instanceof Error ? e.message : String(e));
      }
    }
    if (game && game.status !== "in_progress")
      console.log(`\n${renderBoard(game)}\n\n${describeStatus(game)}`);
    console.log("Finishing writes ...");
    await engine.flush();
  } finally {
    rl.close();
  }
}

async function status(args: Args): Promise<void> {
  const config = await loadConfig();
  const board = currentBoard(config, flag(args, "board"));
  const engine = engineFor(board, new GitWriter({ dir: board.dir, branch: board.branch }));
  const state = await engine.load(true);
  const game = state.games.at(-1);
  console.log(`${board.owner}/${board.repo}: ${state.games.length} game(s)`);
  if (game) {
    console.log(
      `\nGame ${game.id} (${game.difficulty}, ${game.status.replace("_", " ")})\n${renderBoard(game)}`,
    );
    if (game.placement.season) console.log(`\n${seasonProfileUrl(board.owner, game.placement.season)}`);
  }
}

async function doctor(args: Args): Promise<void> {
  const config = await loadConfig();
  const board = currentBoard(config, flag(args, "board"));
  const problems: Check[] = [];
  let state = null;
  try {
    state = await engineFor(board, new GitWriter({ dir: board.dir, branch: board.branch })).load(true);
    problems.push({
      ok: true,
      label: `board repo ${board.owner}/${board.repo} reachable, sentinel and state valid`,
    });
  } catch (e) {
    problems.push({
      ok: false,
      label: "board repo check failed",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
  const ok = printChecks(await runDoctor(board, state, problems));
  process.exitCode = ok ? 0 : 1;
}

async function pair(args: Args): Promise<void> {
  const config: Config = await loadConfig();
  if (args.flags.has("reset")) {
    config.helper.token = newToken();
    delete config.helper.extensionOrigin;
    await saveConfig(config);
    console.log("Pairing reset. Restart `commit-four serve` and paste the new token into the extension.");
  }
  console.log(`Pairing token: ${config.helper.token}`);
}

const HELP = `commit-four ${VERSION} — Connect 4 on your GitHub contribution graph

  setup [--board <owner>/<repo>]                           make this repo (your "Use this template" copy) your board
  init <owner>/<repo> [--create] [--private] [--email e]   set up a separate, empty board repo
  serve [--port ${47474}]                                   local helper for the browser extension
  play [--difficulty casual|hard|perfect] [--ai-first]      play in the terminal
  status                                                    show the current game
  doctor                                                    check visibility and settings
  pair [--reset]                                            show (or rotate) the extension pairing token
`;

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const commands: Record<string, (a: Args) => Promise<void>> = {
    setup,
    init,
    serve,
    play,
    status,
    doctor,
    pair,
  };
  const run = commands[args.command];
  if (!run) {
    console.log(HELP);
    return;
  }
  await run(args);
}

const isEntry = process.argv[1] && /(cli\.(js|ts)|commit-four)$/.test(process.argv[1]);
if (isEntry) {
  main().catch((e: unknown) => {
    console.error(`commit-four: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
