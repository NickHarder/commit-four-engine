/**
 * Board-repo state (`state/game.json`): the single source of truth for every game drawn on the
 * graph. Moves are stored as a 1-based column string and validated by replay.
 */

import { formatMoves, parseMoves } from "./board";
import {
  type IsoDate,
  parseIsoDate,
  SLOTS_PER_SEASON,
  seasonAnchorDate,
  slotAnchorSunday,
  weekday,
} from "./calendar";
import { DIFFICULTIES, type Difficulty } from "./difficulty";
import { replay } from "./rules";

export const STATE_VERSION = 1;
export const SENTINEL_FILE = ".commit-four-board";
export const STATE_PATH = "state/game.json";
export const SVG_PATH = "state/board.svg";
/** Author of state commits. `.invalid` is a reserved TLD, so these never count as anyone's contribution. */
export const ENGINE_AUTHOR = { name: "Commit Four", email: "engine@commit-four.invalid" } as const;
/** Commits per square in season mode: AI = level 2, human = level 4 (see levels.ts). */
export const SEASON_COUNTS = { human: 4, ai: 2, anchor: 4 } as const;
/** Account created 2017-07-08, so 2016 and earlier are guaranteed-empty canvases for the default owner. */
export const DEFAULT_SEASON = 2016;

export type Player = "human" | "ai";
export type GameStatus = "in_progress" | "human_won" | "ai_won" | "draw" | "resigned";

export interface Placement {
  mode: "season" | "rolling";
  season?: number;
  slot?: number;
  anchorSunday: IsoDate;
}

export interface GameRecord {
  id: number;
  placement: Placement;
  counts: { human: number; ai: number };
  humanFirst: boolean;
  difficulty: Difficulty;
  /** Columns played, 1-based, starting with whoever moved first. */
  moves: string;
  status: GameStatus;
  startedAt: string;
  endedAt?: string;
}

export interface BoardState {
  version: 1;
  owner: string;
  games: GameRecord[];
  /** Scale-anchor squares written so far (one per season). */
  anchors: { date: IsoDate; count: number }[];
  updatedAt: string;
}

export interface NewGameOptions {
  difficulty: Difficulty;
  humanFirst: boolean;
  now?: Date;
  /** Season mode: the newest season to use (default 2016). Seasons fill backwards when full. */
  startSeason?: number;
  /** Rolling (last-12-months) mode: an explicit placement + counts from calibrate.ts. */
  rolling?: { anchorSunday: IsoDate; counts: { human: number; ai: number } };
}

export function initialState(owner: string, now = new Date()): BoardState {
  assertLogin(owner);
  return { version: STATE_VERSION, owner, games: [], anchors: [], updatedAt: now.toISOString() };
}

export function currentGame(state: BoardState): GameRecord | null {
  const last = state.games.at(-1);
  return last && last.status === "in_progress" ? last : null;
}

export function playerToMove(game: GameRecord): Player {
  const evenPly = game.moves.length % 2 === 0;
  return evenPly === game.humanFirst ? "human" : "ai";
}

export function playerOfPly(game: GameRecord, ply: number): Player {
  return (ply % 2 === 0) === game.humanFirst ? "human" : "ai";
}

export function nextPlacement(state: BoardState, startSeason = DEFAULT_SEASON): Placement {
  const used = new Set(
    state.games
      .filter((g) => g.placement.mode === "season")
      .map((g) => `${g.placement.season}:${g.placement.slot}`),
  );
  for (let season = startSeason; season >= 1980; season--) {
    for (let slot = 0; slot < SLOTS_PER_SEASON; slot++) {
      if (!used.has(`${season}:${slot}`))
        return { mode: "season", season, slot, anchorSunday: slotAnchorSunday(season, slot) };
    }
  }
  throw new Error("no free board slots left");
}

export function startGame(state: BoardState, opts: NewGameOptions): BoardState {
  if (currentGame(state)) throw new Error("a game is already in progress; finish or resign it first");
  if (!DIFFICULTIES.includes(opts.difficulty))
    throw new Error(`unknown difficulty ${String(opts.difficulty)}`);
  const now = (opts.now ?? new Date()).toISOString();
  let placement: Placement;
  let counts: { human: number; ai: number };
  const anchors = [...state.anchors];
  if (opts.rolling) {
    if (weekday(opts.rolling.anchorSunday) !== 0) throw new Error("rolling anchor must be a Sunday");
    placement = { mode: "rolling", anchorSunday: opts.rolling.anchorSunday };
    counts = { ...opts.rolling.counts };
  } else {
    placement = nextPlacement(state, opts.startSeason);
    counts = { human: SEASON_COUNTS.human, ai: SEASON_COUNTS.ai };
    const anchorDate = seasonAnchorDate(placement.season!);
    if (!anchors.some((a) => a.date === anchorDate))
      anchors.push({ date: anchorDate, count: SEASON_COUNTS.anchor });
  }
  const game: GameRecord = {
    id: (state.games.at(-1)?.id ?? 0) + 1,
    placement,
    counts,
    humanFirst: opts.humanFirst,
    difficulty: opts.difficulty,
    moves: "",
    status: "in_progress",
    startedAt: now,
  };
  return { ...state, games: [...state.games, game], anchors, updatedAt: now };
}

/** Plays `col` (0-based) for `player` in the current game. Returns the new state. */
export function applyMove(state: BoardState, player: Player, col: number, now = new Date()): BoardState {
  const game = currentGame(state);
  if (!game) throw new Error("no game in progress");
  if (playerToMove(game) !== player) throw new Error(`it is not the ${player}'s turn`);
  const cols = [...parseMoves(game.moves), col];
  const outcome = replay(cols); // throws on illegal moves
  let status: GameStatus = "in_progress";
  if (outcome.winner !== null) status = player === "human" ? "human_won" : "ai_won";
  else if (outcome.draw) status = "draw";
  const updated: GameRecord = {
    ...game,
    moves: formatMoves(cols),
    status,
    ...(status !== "in_progress" ? { endedAt: now.toISOString() } : {}),
  };
  return { ...state, games: [...state.games.slice(0, -1), updated], updatedAt: now.toISOString() };
}

/** Changes the current game's difficulty; the AI uses it from its next move. */
export function setDifficulty(state: BoardState, difficulty: Difficulty, now = new Date()): BoardState {
  const game = currentGame(state);
  if (!game) throw new Error("no game in progress");
  if (!DIFFICULTIES.includes(difficulty)) throw new Error(`unknown difficulty ${String(difficulty)}`);
  if (game.difficulty === difficulty) return state;
  const updated: GameRecord = { ...game, difficulty };
  return { ...state, games: [...state.games.slice(0, -1), updated], updatedAt: now.toISOString() };
}

export function resign(state: BoardState, now = new Date()): BoardState {
  const game = currentGame(state);
  if (!game) throw new Error("no game in progress");
  const updated: GameRecord = { ...game, status: "resigned", endedAt: now.toISOString() };
  return { ...state, games: [...state.games.slice(0, -1), updated], updatedAt: now.toISOString() };
}

/** Runtime validation for state read from the repo or received over a message channel. */
export function parseState(json: unknown): BoardState {
  const fail = (msg: string): never => {
    throw new Error(`invalid board state: ${msg}`);
  };
  if (!isObject(json)) return fail("not an object");
  if (json.version !== STATE_VERSION) fail(`unsupported version ${String(json.version)}`);
  if (typeof json.owner !== "string") fail("owner");
  assertLogin(json.owner as string);
  if (typeof json.updatedAt !== "string") fail("updatedAt");
  if (!Array.isArray(json.anchors)) fail("anchors");
  for (const a of json.anchors as unknown[]) {
    if (!isObject(a) || typeof a.date !== "string" || !isCount(a.count)) fail("anchor entry");
    parseIsoDate((a as { date: string }).date);
  }
  if (!Array.isArray(json.games)) fail("games");
  const games = json.games as unknown[];
  games.forEach((g, i) => {
    if (!isObject(g)) {
      fail(`game ${i}`);
      return;
    }
    if (!Number.isInteger(g.id)) fail(`game ${i} id`);
    if (typeof g.moves !== "string") fail(`game ${i} moves`);
    if (typeof g.humanFirst !== "boolean") fail(`game ${i} humanFirst`);
    if (!DIFFICULTIES.includes(g.difficulty as Difficulty)) fail(`game ${i} difficulty`);
    if (!["in_progress", "human_won", "ai_won", "draw", "resigned"].includes(g.status as string))
      fail(`game ${i} status`);
    if (g.status === "in_progress" && i !== games.length - 1) fail(`game ${i} in progress but not last`);
    if (!isObject(g.counts) || !isCount(g.counts.human) || !isCount(g.counts.ai)) fail(`game ${i} counts`);
    const p = g.placement;
    if (!isObject(p) || (p.mode !== "season" && p.mode !== "rolling") || typeof p.anchorSunday !== "string") {
      fail(`game ${i} placement`);
    }
    if (weekday((p as { anchorSunday: string }).anchorSunday) !== 0) fail(`game ${i} anchor not a Sunday`);
    const outcome = replay(parseMoves(g.moves as string));
    if (g.status === "in_progress" && outcome.over) fail(`game ${i} is over but marked in progress`);
  });
  return json as unknown as BoardState;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function isCount(x: unknown): boolean {
  return Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 1000;
}
export function assertLogin(login: string): void {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(login))
    throw new Error(`invalid GitHub login: ${login}`);
}
