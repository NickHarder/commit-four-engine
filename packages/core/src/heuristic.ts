/**
 * Depth-limited alpha-beta search with a static evaluation, for the "Hard" level and as the
 * fallback when an exact solve doesn't fit the time budget.
 */

import { CELLS, COLUMN_ORDER, type Position, WIDTH } from "./board";
import { SearchAborted } from "./solver";

export const WIN_SCORE = 100_000;

export interface HeuristicResult {
  col: number;
  score: number;
  /** Deepest fully completed iteration. */
  depth: number;
  /** Root score per column (null = not playable / not searched). */
  scores: (number | null)[];
}

export class HeuristicSearch {
  nodes = 0;
  private deadline = Number.POSITIVE_INFINITY;

  /** Iterative deepening up to maxDepth, stopping at the deadline (keeps the last full iteration). */
  search(pos: Position, maxDepth: number, deadline = Number.POSITIVE_INFINITY): HeuristicResult {
    this.deadline = deadline;
    const legal = COLUMN_ORDER.filter((c) => pos.canPlay(c));
    if (legal.length === 0) throw new Error("no legal moves");
    for (const c of legal) {
      if (pos.isWinningMove(c)) {
        const scores = Array<number | null>(WIDTH).fill(null);
        scores[c] = WIN_SCORE - pos.moves;
        return { col: c, score: WIN_SCORE - pos.moves, depth: 1, scores };
      }
    }
    let best: HeuristicResult = {
      col: legal[0]!,
      score: -WIN_SCORE,
      depth: 0,
      scores: Array(WIDTH).fill(null),
    };
    for (let depth = 1; depth <= Math.max(1, maxDepth); depth++) {
      try {
        best = this.root(pos, depth);
      } catch (e) {
        if (e instanceof SearchAborted && best.depth > 0) break;
        if (e instanceof SearchAborted) {
          // not even depth 1 finished: fall back to a center-first legal move
          return best;
        }
        throw e;
      }
      if (Math.abs(best.score) >= WIN_SCORE - CELLS) break; // forced result found
      if (pos.moves + depth >= CELLS) break;
    }
    return best;
  }

  private root(pos: Position, depth: number): HeuristicResult {
    const scores: (number | null)[] = Array(WIDTH).fill(null);
    const nonLosing = pos.nonLosingColumns();
    const candidates = COLUMN_ORDER.filter(
      (c) => pos.canPlay(c) && (nonLosing === 0 || nonLosing & (1 << c)),
    );
    let bestCol = candidates[0]!;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const c of candidates) {
      const child = pos.clone();
      child.play(c);
      // full window per root move so ties are scored exactly
      const s = child.isFull() ? 0 : -this.negamax(child, depth - 1, -WIN_SCORE * 2, WIN_SCORE * 2);
      scores[c] = s;
      if (s > bestScore) {
        bestScore = s;
        bestCol = c;
      }
    }
    return { col: bestCol, score: bestScore, depth, scores };
  }

  private negamax(p: Position, depth: number, alpha: number, beta: number): number {
    if ((++this.nodes & 0x3ff) === 0 && performance.now() > this.deadline) throw new SearchAborted();
    if (p.canWinNext()) return WIN_SCORE - (p.moves + 1);
    const next = p.nonLosingColumns();
    if (next === 0) return -(WIN_SCORE - (p.moves + 2));
    if (p.moves >= CELLS - 1) return 0;
    if (depth <= 0) return p.evaluate();

    const order: number[] = [];
    const orderScore: number[] = [];
    for (const c of COLUMN_ORDER) {
      if (!(next & (1 << c))) continue;
      const s = p.moveScore(c);
      let j = order.length;
      order.push(c);
      orderScore.push(s);
      while (j > 0 && orderScore[j - 1]! < s) {
        order[j] = order[j - 1]!;
        orderScore[j] = orderScore[j - 1]!;
        j--;
      }
      order[j] = c;
      orderScore[j] = s;
    }
    let best = Number.NEGATIVE_INFINITY;
    for (const c of order) {
      const child = p.clone();
      child.play(c);
      const s = -this.negamax(child, depth - 1, -beta, -alpha);
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    return best;
  }
}
