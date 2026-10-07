/**
 * Exact Connect 4 solver: negamax with alpha-beta pruning, a transposition table that stores
 * upper and lower bounds, center-first + threat-count move ordering, "non-losing move" pruning,
 * and a null-window binary search on the score. Implemented from the ideas described in
 * Pascal Pons' "Solving Connect 4" blog series (the code itself is original).
 *
 * Score convention (from the side to move): 0 = draw, positive = win, and the earlier the win
 * the larger the score: (CELLS + 1 - stonesAtWin) / 2. Range is MIN_SCORE..MAX_SCORE.
 */

import { CELLS, COLUMN_ORDER, type Position, WIDTH } from "./board";

export const MIN_SCORE = -(CELLS / 2) + 3; // -18
export const MAX_SCORE = Math.floor((CELLS + 1) / 2) - 3; // 18

export class SearchAborted extends Error {
  constructor() {
    super("search aborted (time budget exceeded)");
  }
}

export class TranspositionTable {
  readonly size: number;
  private readonly keys: Uint32Array;
  private readonly vals: Uint8Array;

  constructor(log2Size = 22) {
    this.size = nextPrime(2 ** log2Size);
    this.keys = new Uint32Array(this.size);
    this.vals = new Uint8Array(this.size);
  }

  private index(key: number): number {
    return key % this.size;
  }

  // key < 2^49 and size > 2^21, so (key mod size, key mod 2^32) identifies the key exactly.
  put(key: number, val: number): void {
    const i = this.index(key);
    this.keys[i] = key % 2 ** 32;
    this.vals[i] = val;
  }

  get(key: number): number {
    const i = this.index(key);
    return this.keys[i] === key % 2 ** 32 ? this.vals[i]! : 0;
  }

  clear(): void {
    this.keys.fill(0);
    this.vals.fill(0);
  }
}

export interface SolverOptions {
  /** log2 of the transposition-table size (memory ≈ 5 bytes x 2^n). Default 22 (~21 MB). */
  ttLog2Size?: number;
}

export class Solver {
  nodes = 0;
  private readonly tt: TranspositionTable;
  private deadline = Number.POSITIVE_INFINITY;
  // per-depth move buffers (no allocation in the search loop)
  private readonly moveBuf = new Int8Array(CELLS * WIDTH);
  private readonly scoreBuf = new Int16Array(CELLS * WIDTH);

  constructor(opts: SolverOptions = {}) {
    this.tt = new TranspositionTable(opts.ttLog2Size ?? 22);
  }

  reset(): void {
    this.nodes = 0;
    this.tt.clear();
  }

  /** Exact score of `pos` for the side to move. Throws SearchAborted after `deadline` (ms, performance.now()). */
  solve(pos: Position, opts: { weak?: boolean; deadline?: number } = {}): number {
    this.deadline = opts.deadline ?? Number.POSITIVE_INFINITY;
    const p = pos.clone();
    if (p.canWinNext()) return opts.weak ? 1 : Math.floor((CELLS + 1 - p.moves) / 2);
    let min = -Math.floor((CELLS - p.moves) / 2);
    let max = Math.floor((CELLS + 1 - p.moves) / 2);
    if (opts.weak) {
      min = -1;
      max = 1;
    }
    while (min < max) {
      let med = min + Math.floor((max - min) / 2);
      if (med <= 0 && Math.trunc(min / 2) < med) med = Math.trunc(min / 2);
      else if (med >= 0 && Math.trunc(max / 2) > med) med = Math.trunc(max / 2);
      const r = this.negamax(p, med, med + 1, 0);
      if (r <= med) max = r;
      else min = r;
    }
    return opts.weak ? Math.sign(min) + 0 : min + 0;
  }

  /** Exact score of each column (null if unplayable), from the side to move's point of view. */
  analyze(pos: Position, opts: { weak?: boolean; deadline?: number } = {}): (number | null)[] {
    const scores: (number | null)[] = [];
    for (let c = 0; c < WIDTH; c++) {
      if (!pos.canPlay(c)) scores.push(null);
      else if (pos.isWinningMove(c)) scores.push(opts.weak ? 1 : Math.floor((CELLS + 1 - pos.moves) / 2));
      else {
        const child = pos.clone();
        child.play(c);
        scores.push(child.isFull() ? 0 : 0 - this.solve(child, opts));
      }
    }
    return scores;
  }

  /**
   * An optimal move and the position's exact score. Costs one solve plus cheap null-window
   * checks of the children (the transposition table is warm by then).
   */
  bestMove(pos: Position, opts: { deadline?: number } = {}): { col: number; score: number } {
    for (const c of COLUMN_ORDER) {
      if (pos.canPlay(c) && pos.isWinningMove(c))
        return { col: c, score: Math.floor((CELLS + 1 - pos.moves) / 2) };
    }
    const score = this.solve(pos, opts);
    const nonLosing = pos.nonLosingColumns();
    if (nonLosing === 0) {
      // every move loses next turn; block one threat if possible, else play anything
      const col = COLUMN_ORDER.find((c) => pos.canPlay(c))!;
      return { col, score };
    }
    for (const c of COLUMN_ORDER) {
      if (!(nonLosing & (1 << c))) continue;
      const child = pos.clone();
      child.play(c);
      if (child.isFull()) return { col: c, score };
      this.deadline = opts.deadline ?? Number.POSITIVE_INFINITY;
      const r = this.negamax(child, -score, -score + 1, 0);
      if (r <= -score) return { col: c, score };
    }
    throw new Error("solver invariant violated: no move achieves the position's score");
  }

  /** Negamax on positions where the side to move cannot win immediately. */
  private negamax(p: Position, alpha: number, beta: number, depth: number): number {
    if ((++this.nodes & 0x3fff) === 0 && performance.now() > this.deadline) throw new SearchAborted();

    const next = p.nonLosingColumns();
    if (next === 0) return -Math.floor((CELLS - p.moves) / 2);
    if (p.moves >= CELLS - 2) return 0;

    let min = -Math.floor((CELLS - 2 - p.moves) / 2);
    if (alpha < min) {
      alpha = min;
      if (alpha >= beta) return alpha;
    }
    let max = Math.floor((CELLS - 1 - p.moves) / 2);
    const key = p.key();
    const val = this.tt.get(key);
    if (val !== 0) {
      if (val > MAX_SCORE - MIN_SCORE + 1) {
        min = val + 2 * MIN_SCORE - MAX_SCORE - 2;
        if (alpha < min) {
          alpha = min;
          if (alpha >= beta) return alpha;
        }
      } else {
        max = val + MIN_SCORE - 1;
      }
    }
    if (beta > max) {
      beta = max;
      if (alpha >= beta) return beta;
    }

    // order candidate moves: more threats created first, center-first on ties
    const base = depth * WIDTH;
    let n = 0;
    for (let i = WIDTH - 1; i >= 0; i--) {
      const c = COLUMN_ORDER[i]!;
      if (!(next & (1 << c))) continue;
      const s = p.moveScore(c);
      let j = n++;
      while (j > 0 && this.scoreBuf[base + j - 1]! > s) {
        this.moveBuf[base + j] = this.moveBuf[base + j - 1]!;
        this.scoreBuf[base + j] = this.scoreBuf[base + j - 1]!;
        j--;
      }
      this.moveBuf[base + j] = c;
      this.scoreBuf[base + j] = s;
    }

    const cl = p.cl;
    const ch = p.ch;
    const ml = p.ml;
    const mh = p.mh;
    // (on SearchAborted the position is left mid-search; callers always search a clone)
    for (let i = n - 1; i >= 0; i--) {
      p.play(this.moveBuf[base + i]!);
      const score = -this.negamax(p, -beta, -alpha, depth + 1);
      p.cl = cl;
      p.ch = ch;
      p.ml = ml;
      p.mh = mh;
      p.moves--;
      if (score >= beta) {
        this.store(key, score + MAX_SCORE - 2 * MIN_SCORE + 2);
        return score;
      }
      if (score > alpha) alpha = score;
    }
    this.store(key, alpha - MIN_SCORE + 1);
    return alpha;
  }

  private store(key: number, encoded: number): void {
    if (encoded >= 1 && encoded <= 255) this.tt.put(key, encoded);
  }
}

function nextPrime(n: number): number {
  const isPrime = (x: number): boolean => {
    if (x < 2) return false;
    for (let d = 2; d * d <= x; d++) if (x % d === 0) return false;
    return true;
  };
  let x = Math.floor(n);
  while (!isPrime(x)) x++;
  return x;
}
