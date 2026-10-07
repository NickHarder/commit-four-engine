import { describe, expect, it } from "vitest";
import { CELLS, HEIGHT, Position, WIDTH } from "../src/board";
import { columnHeight, replay } from "../src/rules";
import { SearchAborted, Solver } from "../src/solver";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 2 ** 32;
  };
}

/** Independent brute-force score (same convention as the solver), memoized. */
function bruteForce(moves: number[]): number {
  const o = replay(moves);
  const grid = o.grid.map((c) => [...c]);
  const memo = new Map<string, number>();
  const wins = (col: number, row: number, side: number): boolean => {
    const dirs = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ] as const;
    for (const [dc, dr] of dirs) {
      let n = 1;
      for (const s of [1, -1]) {
        let c = col + s * dc;
        let r = row + s * dr;
        while (c >= 0 && c < WIDTH && r >= 0 && r < HEIGHT && grid[c]![r] === side) {
          n++;
          c += s * dc;
          r += s * dr;
        }
      }
      if (n >= 4) return true;
    }
    return false;
  };
  const value = (side: 1 | 2, played: number): number => {
    const k = `${side}${grid.map((c) => c.join("")).join("|")}`;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    let best = Number.NEGATIVE_INFINITY;
    for (let c = 0; c < WIDTH; c++) {
      const r = columnHeight(grid, c);
      if (r >= HEIGHT) continue;
      grid[c]![r] = side;
      let v: number;
      if (wins(c, r, side)) v = Math.floor((CELLS + 1 - played) / 2);
      else if (played + 1 === CELLS) v = 0;
      else v = 0 - value(side === 1 ? 2 : 1, played + 1);
      grid[c]![r] = 0;
      if (v > best) best = v;
    }
    memo.set(k, best + 0);
    return best + 0;
  };
  return value(o.toMove, moves.length);
}

function randomPosition(r: () => number, stones: number): number[] | null {
  const moves: number[] = [];
  while (moves.length < stones) {
    const legal = [...Array(WIDTH).keys()].filter((c) => columnHeight(replay(moves).grid, c) < HEIGHT);
    if (legal.length === 0) return null;
    const col = legal[Math.floor(r() * legal.length)]!;
    if (replay([...moves, col]).over) return null;
    moves.push(col);
  }
  return moves;
}

describe("Solver", () => {
  const r = rng(7);
  const cases: number[][] = [];
  while (cases.length < 60) {
    const m = randomPosition(r, 30 + Math.floor(r() * 9));
    if (m) cases.push(m);
  }

  it("matches brute force on late-game positions (strong and weak)", () => {
    const solver = new Solver({ ttLog2Size: 18 });
    for (const moves of cases) {
      const expected = bruteForce(moves);
      const p = Position.fromMoves(moves);
      expect(solver.solve(p), `moves ${moves.join("")}`).toBe(expected);
      expect(solver.solve(p, { weak: true })).toBe(Math.sign(expected));
    }
  });

  it("bestMove returns a move that achieves the exact score", () => {
    const solver = new Solver({ ttLog2Size: 18 });
    for (const moves of cases.slice(0, 30)) {
      const p = Position.fromMoves(moves);
      const { col, score } = solver.bestMove(p);
      expect(score).toBe(bruteForce(moves));
      const after = [...moves, col];
      const o = replay(after);
      const achieved =
        o.winner !== null ? Math.floor((CELLS + 1 - moves.length) / 2) : o.draw ? 0 : 0 - bruteForce(after);
      expect(achieved).toBe(score);
    }
  });

  it("analyze scores every column", () => {
    const solver = new Solver({ ttLog2Size: 18 });
    for (const moves of cases.slice(0, 15)) {
      const p = Position.fromMoves(moves);
      const scores = solver.analyze(p);
      for (let c = 0; c < WIDTH; c++) {
        if (!p.canPlay(c)) {
          expect(scores[c]).toBeNull();
          continue;
        }
        const after = [...moves, c];
        const o = replay(after);
        const expected =
          o.winner !== null ? Math.floor((CELLS + 1 - moves.length) / 2) : o.draw ? 0 : 0 - bruteForce(after);
        expect(scores[c]).toBe(expected);
      }
    }
  });

  it("knows a mid-game position quickly and honours deadlines", () => {
    const solver = new Solver({ ttLog2Size: 20 });
    // 20-stone position solved exactly within the default budget
    let midMoves: number[] | null = null;
    const r2 = rng(99);
    while (!midMoves) midMoves = randomPosition(r2, 20);
    const t0 = performance.now();
    expect(Number.isInteger(solver.solve(Position.fromMoves(midMoves)))).toBe(true);
    expect(performance.now() - t0).toBeLessThan(10_000);
    // the empty board takes minutes, so a 50 ms deadline must abort
    expect(() => solver.solve(new Position(), { deadline: performance.now() + 50 })).toThrow(SearchAborted);
  });
});
