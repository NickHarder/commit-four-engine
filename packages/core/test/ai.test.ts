import { describe, expect, it } from "vitest";
import { chooseMove, DIFFICULTIES, type Difficulty } from "../src/ai";
import { HEIGHT, Position, WIDTH } from "../src/board";
import { canonicalEntry, OpeningBook } from "../src/book";
import { columnHeight, replay } from "../src/rules";
import { Solver } from "../src/solver";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 2 ** 32;
  };
}

function randomPosition(r: () => number, stones: number): number[] | null {
  const moves: number[] = [];
  while (moves.length < stones) {
    const legal = [...Array(WIDTH).keys()].filter((c) => columnHeight(replay(moves).grid, c) < HEIGHT);
    const col = legal[Math.floor(r() * legal.length)]!;
    if (replay([...moves, col]).over) return null;
    moves.push(col);
  }
  return moves;
}

function play(first: Difficulty, second: Difficulty, seed: number): 1 | 2 | 0 {
  const r = rng(seed);
  const moves: number[] = [];
  const solver = new Solver({ ttLog2Size: 20 });
  for (;;) {
    const o = replay(moves);
    if (o.over) return o.winner ?? 0;
    const difficulty = o.toMove === 1 ? first : second;
    moves.push(chooseMove(moves, { difficulty, rng: r, solver, budgetMs: 300 }).col);
  }
}

describe("chooseMove", () => {
  it("every level takes an immediate win and blocks a forced threat", () => {
    // first player (to move) has three in column 0: playing column 0 wins
    const winning = [0, 1, 0, 1, 0, 2];
    // second player to move must block column 0
    const blocking = [0, 1, 0, 1, 0];
    for (const difficulty of DIFFICULTIES) {
      expect(chooseMove(winning, { difficulty, rng: rng(1) }).col).toBe(0);
      expect(chooseMove(blocking, { difficulty, rng: rng(1) }).col).toBe(0);
    }
  });

  it("perfect never gives away a won or drawn late-game position", () => {
    const r = rng(3);
    const solver = new Solver({ ttLog2Size: 20 });
    let checked = 0;
    while (checked < 40) {
      const moves = randomPosition(r, 26 + Math.floor(r() * 10));
      if (!moves) continue;
      const pos = Position.fromMoves(moves);
      if (pos.canWinNext()) continue;
      const before = Math.sign(solver.solve(pos, { weak: true }));
      const { col } = chooseMove(moves, { difficulty: "perfect", solver, budgetMs: 10_000 });
      const after = [...moves, col];
      const o = replay(after);
      const achieved =
        o.winner !== null
          ? 1
          : o.draw
            ? 0
            : -Math.sign(solver.solve(Position.fromMoves(after), { weak: true }));
      expect(achieved, `moves ${moves.join("")}`).toBeGreaterThanOrEqual(before);
      checked++;
    }
  });

  it("hard beats casual", () => {
    let hardWins = 0;
    for (let g = 0; g < 6; g++) {
      const hardFirst = g % 2 === 0;
      const w = hardFirst ? play("hard", "casual", g) : play("casual", "hard", g);
      if ((hardFirst && w === 1) || (!hardFirst && w === 2)) hardWins++;
    }
    expect(hardWins).toBeGreaterThanOrEqual(5);
  });

  it("uses the opening book (mirror-aware) before searching", () => {
    const p = Position.fromMoves([0]); // human played column 1
    const book = new OpeningBook({ version: 1, policy: "test", entries: [canonicalEntry(p, 1)] });
    expect(chooseMove([0], { difficulty: "perfect", book })).toMatchObject({ col: 1, source: "book" });
    // mirrored position (column 7) maps to the mirrored answer
    expect(chooseMove([6], { difficulty: "perfect", book })).toMatchObject({ col: 5, source: "book" });
  });

  it("respects the time budget when the solve is too deep", () => {
    const t0 = performance.now();
    const c = chooseMove([3], { difficulty: "perfect", budgetMs: 200 });
    expect(c.source).toBe("heuristic");
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});
