/**
 * Move selection for the three difficulty levels:
 * - casual:  takes wins, blocks forced threats, otherwise a center-weighted random safe move
 * - hard:    depth-limited (8 ply) alpha-beta with a threat/zugzwang evaluation
 * - perfect: opening book, then an exact win/draw/loss solve; never throws away a won or drawn
 *            position, and in lost positions plays the heuristically strongest resistance
 */

import { COLUMN_ORDER, Position, WIDTH } from "./board";
import type { OpeningBook } from "./book";
import type { Difficulty } from "./difficulty";
import { HeuristicSearch } from "./heuristic";
import { SearchAborted, Solver } from "./solver";

export type { Difficulty } from "./difficulty";
export { DIFFICULTIES } from "./difficulty";

export interface ChooseOptions {
  difficulty: Difficulty;
  /** Thinking time budget in ms (default: 400 casual/hard, 3000 perfect). */
  budgetMs?: number;
  rng?: () => number;
  book?: OpeningBook | null;
  /** Reuse a solver across moves to keep its transposition table warm. */
  solver?: Solver;
}

export interface Choice {
  col: number;
  source: "win" | "forced" | "book" | "solver" | "heuristic" | "random";
  /** Theoretical outcome for the AI when known from an exact solve. */
  outcome?: "win" | "draw" | "loss";
  elapsedMs: number;
}

const CENTER_WEIGHTS = [1, 2, 3, 4, 3, 2, 1];
const HARD_DEPTH = 8;

export function chooseMove(moves: readonly number[] | Position, opts: ChooseOptions): Choice {
  const t0 = performance.now();
  const pos = moves instanceof Position ? moves.clone() : Position.fromMoves(moves);
  const legal = COLUMN_ORDER.filter((c) => pos.canPlay(c));
  if (legal.length === 0) throw new Error("no legal moves: the board is full");
  const done = (col: number, source: Choice["source"], outcome?: Choice["outcome"]): Choice => ({
    col,
    source,
    ...(outcome ? { outcome } : {}),
    elapsedMs: performance.now() - t0,
  });

  const win = legal.find((c) => pos.isWinningMove(c));
  if (win !== undefined) return done(win, "win", "win");
  const safe = pos.nonLosingColumns();
  const safeCols = legal.filter((c) => safe & (1 << c));
  if (safeCols.length === 1) return done(safeCols[0]!, "forced");
  const rng = opts.rng ?? Math.random;

  switch (opts.difficulty) {
    case "casual": {
      const pool = safeCols.length > 0 ? safeCols : legal;
      return done(weightedPick(pool, rng), "random");
    }
    case "hard": {
      const budget = opts.budgetMs ?? 400;
      const r = new HeuristicSearch().search(pos, HARD_DEPTH, t0 + budget);
      return done(tieBreak(r.scores, r.col, rng), "heuristic");
    }
    case "perfect": {
      const fromBook = opts.book?.lookup(pos);
      if (fromBook !== undefined && pos.canPlay(fromBook)) return done(fromBook, "book");
      const budget = opts.budgetMs ?? 3000;
      const solver = opts.solver ?? new Solver();
      try {
        const r = perfectMove(pos, solver, t0 + budget);
        return done(r.col, "solver", r.outcome);
      } catch (e) {
        if (!(e instanceof SearchAborted)) throw e;
        const h = new HeuristicSearch().search(pos, 12, performance.now() + Math.max(300, budget / 3));
        return done(h.col, "heuristic");
      }
    }
  }
}

/**
 * Exact win/draw/loss for the side to move, then the move to play. Deterministic, so the opening
 * book builder and live play agree. Throws SearchAborted past the deadline.
 */
export function perfectMove(
  pos: Position,
  solver: Solver,
  deadline = Number.POSITIVE_INFINITY,
): { col: number; outcome: "win" | "draw" | "loss" } {
  const legal = COLUMN_ORDER.filter((c) => pos.canPlay(c));
  const win = legal.find((c) => pos.isWinningMove(c));
  if (win !== undefined) return { col: win, outcome: "win" };
  const value = solver.solve(pos, { weak: true, deadline });
  const safe = pos.nonLosingColumns();
  const outcome = value > 0 ? "win" : value < 0 ? "loss" : "draw";
  if (value < 0 || safe === 0) {
    // lost against perfect play: resist as strongly as a fallible human allows
    const h = new HeuristicSearch().search(pos, 8, deadline);
    return { col: h.col, outcome: "loss" };
  }
  // keep the theoretical value: a child whose weak value is <= -value
  const achieving: number[] = [];
  for (const c of COLUMN_ORDER) {
    if (!(safe & (1 << c))) continue;
    const child = pos.clone();
    child.play(c);
    const childValue = child.isFull() ? 0 : solver.solve(child, { weak: true, deadline });
    if (childValue <= -value) {
      achieving.push(c);
      if (value > 0) break; // any winning move keeps the win
    }
  }
  if (achieving.length === 1 || value > 0) return { col: achieving[0]!, outcome };
  // several drawing moves: pick the one that sets the most problems
  const h = new HeuristicSearch().search(pos, 6, deadline);
  let best = achieving[0]!;
  for (const c of achieving) if ((h.scores[c] ?? -Infinity) > (h.scores[best] ?? -Infinity)) best = c;
  return { col: best, outcome };
}

function weightedPick(cols: readonly number[], rng: () => number): number {
  const total = cols.reduce((sum, c) => sum + CENTER_WEIGHTS[c]!, 0);
  let x = rng() * total;
  for (const c of cols) {
    x -= CENTER_WEIGHTS[c]!;
    if (x < 0) return c;
  }
  return cols[cols.length - 1]!;
}

function tieBreak(scores: readonly (number | null)[], fallback: number, rng: () => number): number {
  let best = Number.NEGATIVE_INFINITY;
  for (let c = 0; c < WIDTH; c++) if (scores[c] !== null && scores[c]! > best) best = scores[c]!;
  if (best === Number.NEGATIVE_INFINITY) return fallback;
  const tied = COLUMN_ORDER.filter((c) => scores[c] === best);
  return tied.length > 1 ? tied[Math.floor(rng() * tied.length)]! : (tied[0] ?? fallback);
}
