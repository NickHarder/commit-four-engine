/**
 * Turn orchestration shared by the local helper (GitWriter) and browser-only mode (ApiWriter).
 *
 * The engine keeps the desired state in memory and answers moves immediately; writes run in a
 * serial queue that makes the board repo match the desired state. Each sync re-reads the remote
 * state and only adds what is missing, so retries never double-paint, and several moves made
 * during one write are coalesced into the next push.
 */

import { chooseMove } from "./ai";
import { parseMoves } from "./board";
import type { OpeningBook } from "./book";
import type { Difficulty } from "./difficulty";
import { planWrite } from "./renderPlan";
import { Solver } from "./solver";
import {
  applyMove,
  type BoardState,
  currentGame,
  type GameRecord,
  initialState,
  playerToMove,
  resign,
  STATE_PATH,
  SVG_PATH,
  setDifficulty,
  startGame,
} from "./state";
import { renderBoardSvg } from "./svg";
import { boardStateFiles, randomBoardId, UNCLAIMED_OWNER } from "./template";
import { type BoardWriter, ConflictError, type Identity, type RemoteState, type WriteResult } from "./writer";

export type Chooser = (moves: number[], difficulty: Difficulty) => Promise<number> | number;

export interface EngineOptions {
  writer: BoardWriter;
  owner: string;
  pieceAuthor: Identity;
  book?: OpeningBook | null;
  aiBudgetMs?: number;
  /** Max writes per rolling minute (GitHub recommends <= 6 pushes/min per repo). */
  maxWritesPerMinute?: number;
  chooser?: Chooser;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  onEvent?: (e: EngineEvent) => void;
}

export type EngineEvent =
  | { type: "write-started"; id: number; commits: number }
  | { type: "write-done"; id: number; head: string; commits: number; ms: number }
  | { type: "write-failed"; id: number; error: string }
  | { type: "resynced"; state: BoardState };

export interface TurnResult {
  state: BoardState;
  aiCol: number | null;
  /** Resolves when the board repo contains this turn. */
  written: Promise<WriteResult>;
}

export class UnclaimedBoardError extends Error {
  constructor() {
    super("this board was created from the template and hasn't been claimed yet");
  }
}

export class StaleMoveError extends Error {
  constructor(readonly state: BoardState) {
    super("the board changed since this view was drawn; re-sync and try again");
  }
}

export class GameEngine {
  private state: BoardState | null = null;
  private head = "";
  private queue: Promise<unknown> = Promise.resolve();
  private writeSeq = 0;
  private readonly writeTimes: number[] = [];
  private readonly chooser: Chooser;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: EngineOptions) {
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const solver = new Solver({ ttLog2Size: 22 });
    this.chooser =
      opts.chooser ??
      ((moves, difficulty) =>
        chooseMove(moves, {
          difficulty,
          solver,
          ...(opts.book ? { book: opts.book } : {}),
          ...(opts.aiBudgetMs ? { budgetMs: opts.aiBudgetMs } : {}),
        }).col);
  }

  /** Loads (or re-loads) the remote state. Refuses repos without a matching sentinel. */
  async load(refresh = false): Promise<BoardState> {
    const remote = await this.opts.writer.readState({ refresh });
    this.checkRemote(remote);
    this.state = remote.state ?? initialState(this.opts.owner, this.now());
    this.head = remote.head;
    return this.state;
  }

  /**
   * Claims a template-created board: stamps the owner into the sentinel and writes a fresh state.
   * Only works while the sentinel is unclaimed, so it can't take over someone else's board, and
   * never in the source template repo itself (so copies made from it stay claimable). Only the
   * sentinel, state and picture are written; the repo's other files (code, README) are untouched.
   */
  async claim(repoSlug: string): Promise<BoardState> {
    const remote = await this.opts.writer.readState({ refresh: true });
    if (!remote.sentinel)
      throw new Error("this repo has no .commit-four-board sentinel; refusing to write to it");
    if (remote.sentinel.upstream && remote.sentinel.upstream.toLowerCase() === repoSlug.toLowerCase()) {
      throw new Error(
        `${repoSlug} is the Commit Four template itself; make your own copy with "Use this template" (or use an empty repo) and set that up instead`,
      );
    }
    if (remote.sentinel.owner !== UNCLAIMED_OWNER) {
      this.checkRemote(remote);
      return this.load();
    }
    const state = initialState(this.opts.owner, this.now());
    const files = boardStateFiles(this.opts.owner, randomBoardId(), state);
    const result = await this.opts.writer.write({
      batches: [],
      pieceAuthor: this.opts.pieceAuthor,
      files,
      message: `c4: claim board for ${this.opts.owner}`,
      expectedHead: remote.head,
    });
    this.state = state;
    this.head = result.head;
    return state;
  }

  current(): BoardState {
    if (!this.state) throw new Error("engine not loaded");
    return this.state;
  }

  async newGame(opts: {
    difficulty: Difficulty;
    humanFirst: boolean;
    rolling?: NonNullable<Parameters<typeof startGame>[1]["rolling"]>;
  }): Promise<TurnResult> {
    let next = startGame(this.current(), { ...opts, now: this.now() });
    const { state, aiCol } = await this.aiReply(next);
    next = state;
    this.state = next;
    return { state: next, aiCol, written: this.enqueueSync() };
  }

  /** Human plays `col` (0-based). `ply` is the move count the view saw, to catch stale clicks. */
  async move(gameId: number, ply: number, col: number): Promise<TurnResult> {
    const state = this.current();
    const game = currentGame(state);
    if (!game || game.id !== gameId || game.moves.length !== ply) throw new StaleMoveError(state);
    const afterHuman = applyMove(state, "human", col, this.now());
    const { state: next, aiCol } = await this.aiReply(afterHuman);
    this.state = next;
    return { state: next, aiCol, written: this.enqueueSync() };
  }

  async setDifficulty(gameId: number, difficulty: Difficulty): Promise<TurnResult> {
    const game = currentGame(this.current());
    if (!game || game.id !== gameId) throw new StaleMoveError(this.current());
    this.state = setDifficulty(this.current(), difficulty, this.now());
    return { state: this.state, aiCol: null, written: this.enqueueSync() };
  }

  async resign(gameId: number): Promise<TurnResult> {
    const game = currentGame(this.current());
    if (!game || game.id !== gameId) throw new StaleMoveError(this.current());
    this.state = resign(this.current(), this.now());
    return { state: this.state, aiCol: null, written: this.enqueueSync() };
  }

  /** Waits for all queued writes. */
  async flush(): Promise<void> {
    await this.queue.catch(() => undefined);
  }

  private async aiReply(state: BoardState): Promise<{ state: BoardState; aiCol: number | null }> {
    const game = currentGame(state);
    if (!game || playerToMove(game) !== "ai") return { state, aiCol: null };
    const aiCol = await this.chooser(parseMoves(game.moves), game.difficulty);
    return { state: applyMove(state, "ai", aiCol, this.now()), aiCol };
  }

  private enqueueSync(): Promise<WriteResult> {
    const run = this.queue.then(() => this.syncWithRetry());
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async syncWithRetry(): Promise<WriteResult> {
    const id = ++this.writeSeq;
    try {
      try {
        return await this.syncOnce(id, false);
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        return await this.syncOnce(id, true);
      }
    } catch (e) {
      this.opts.onEvent?.({ type: "write-failed", id, error: e instanceof Error ? e.message : String(e) });
      if (e instanceof ConflictError) {
        // someone else wrote a different game: adopt the remote and tell the view
        await this.load(true);
        this.opts.onEvent?.({ type: "resynced", state: this.current() });
      }
      throw e;
    }
  }

  private async syncOnce(id: number, refresh: boolean): Promise<WriteResult> {
    await this.throttle();
    const desired = this.current();
    const remote = await this.opts.writer.readState({ refresh });
    this.checkRemote(remote);
    if (remote.state && !isPrefix(remote.state, desired))
      throw new ConflictError("the board repo has moves this view doesn't know about");
    const batches = planWrite(remote.state, desired);
    if (batches.length === 0 && remote.state && JSON.stringify(remote.state) === JSON.stringify(desired)) {
      return { head: remote.head, commits: 0 };
    }
    const commits = batches.reduce((n, b) => n + b.count, 0);
    this.opts.onEvent?.({ type: "write-started", id, commits });
    const t0 = Date.now();
    const lastGame = desired.games.at(-1) ?? null;
    const result = await this.opts.writer.write({
      batches,
      pieceAuthor: this.opts.pieceAuthor,
      files: [
        { path: STATE_PATH, content: `${JSON.stringify(desired, null, 2)}\n` },
        { path: SVG_PATH, content: renderBoardSvg(lastGame) },
      ],
      message: summarize(lastGame),
      expectedHead: remote.head,
    });
    this.writeTimes.push(Date.now());
    this.head = result.head;
    this.opts.onEvent?.({
      type: "write-done",
      id,
      head: result.head,
      commits: result.commits,
      ms: Date.now() - t0,
    });
    return result;
  }

  private async throttle(): Promise<void> {
    const limit = this.opts.maxWritesPerMinute ?? 6;
    for (;;) {
      const now = Date.now();
      while (this.writeTimes.length > 0 && this.writeTimes[0]! < now - 60_000) this.writeTimes.shift();
      if (this.writeTimes.length < limit) return;
      await this.sleep(this.writeTimes[0]! + 60_000 - now + 10);
    }
  }

  private checkRemote(remote: RemoteState): void {
    if (!remote.sentinel)
      throw new Error("this repo has no .commit-four-board sentinel; refusing to write to it");
    if (remote.sentinel.owner === UNCLAIMED_OWNER) throw new UnclaimedBoardError();
    if (remote.sentinel.owner.toLowerCase() !== this.opts.owner.toLowerCase()) {
      throw new Error(`board belongs to ${remote.sentinel.owner}, not ${this.opts.owner}; refusing to write`);
    }
    if (remote.state && remote.state.owner.toLowerCase() !== this.opts.owner.toLowerCase()) {
      throw new Error(`state belongs to ${remote.state.owner}, not ${this.opts.owner}`);
    }
  }
}

/** True when `remote` is an earlier snapshot of `desired` (same games, moves extended). */
export function isPrefix(remote: BoardState, desired: BoardState): boolean {
  if (remote.owner !== desired.owner || remote.games.length > desired.games.length) return false;
  for (const a of remote.anchors)
    if (!desired.anchors.some((b) => b.date === a.date && b.count === a.count)) return false;
  return remote.games.every((r, i) => {
    const d = desired.games[i]!;
    const same =
      r.id === d.id &&
      r.humanFirst === d.humanFirst &&
      // difficulty may change while a game is in progress
      (r.difficulty === d.difficulty || r.status === "in_progress") &&
      JSON.stringify(r.placement) === JSON.stringify(d.placement) &&
      JSON.stringify(r.counts) === JSON.stringify(d.counts) &&
      d.moves.startsWith(r.moves);
    if (!same) return false;
    return r.status === "in_progress" || (r.status === d.status && r.moves === d.moves);
  });
}

function summarize(game: GameRecord | null): string {
  if (!game) return "c4: update state";
  const outcome = game.status === "in_progress" ? `ply ${game.moves.length}` : game.status.replace("_", " ");
  return `c4: game ${game.id} ${outcome} [${game.moves || "start"}]`;
}
