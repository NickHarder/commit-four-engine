import { describe, expect, it } from "vitest";
import { formatMoves, HEIGHT, Position, parseMoves, WIDTH } from "../src/board";
import { columnHeight, replay } from "../src/rules";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 2 ** 32;
  };
}

/** Random legal game prefixes that never contain a win. */
function randomPrefixes(count: number, seed: number): number[][] {
  const r = rng(seed);
  const out: number[][] = [];
  while (out.length < count) {
    const moves: number[] = [];
    const target = Math.floor(r() * 40);
    while (moves.length < target) {
      const legal = [...Array(WIDTH).keys()].filter((c) => columnHeight(replay(moves).grid, c) < HEIGHT);
      const col = legal[Math.floor(r() * legal.length)]!;
      if (replay([...moves, col]).over) break;
      moves.push(col);
    }
    out.push(moves);
  }
  return out;
}

describe("Position (bitboard)", () => {
  const prefixes = randomPrefixes(600, 42);

  it("agrees with the grid rules on legality, winning moves and cell owners", () => {
    for (const moves of prefixes) {
      const p = Position.fromMoves(moves);
      const o = replay(moves);
      expect(p.moves).toBe(moves.length);
      for (let c = 0; c < WIDTH; c++) {
        expect(p.height(c)).toBe(columnHeight(o.grid, c));
        expect(p.canPlay(c)).toBe(columnHeight(o.grid, c) < HEIGHT);
        if (p.canPlay(c)) expect(p.isWinningMove(c)).toBe(replay([...moves, c]).winner !== null);
        for (let r = 0; r < HEIGHT; r++) {
          const side = o.grid[c]![r];
          const expected = side === 0 ? 0 : side === o.toMove ? 1 : 2;
          expect(p.cellOwner(c, r)).toBe(expected);
        }
      }
      const anyWin = [...Array(WIDTH).keys()].some((c) => p.canPlay(c) && p.isWinningMove(c));
      expect(p.canWinNext()).toBe(anyWin);
    }
  });

  it("nonLosingColumns never allows an immediate opponent win", () => {
    for (const moves of prefixes) {
      const p = Position.fromMoves(moves);
      if (p.canWinNext()) continue;
      const mask = p.nonLosingColumns();
      for (let c = 0; c < WIDTH; c++) {
        if (!p.canPlay(c)) {
          expect(mask & (1 << c)).toBe(0);
          continue;
        }
        const after = [...moves, c];
        const oppWins = [...Array(WIDTH).keys()].some(
          (d) => columnHeight(replay(after).grid, d) < HEIGHT && replay([...after, d]).winner !== null,
        );
        if (mask & (1 << c)) expect(oppWins).toBe(false);
        // A move omitted from the mask either loses at once or the side is already lost.
        if (!(mask & (1 << c)) && mask !== 0) expect(oppWins).toBe(true);
      }
    }
  });

  it("keys are unique per position and mirror keys match mirrored games", () => {
    const seen = new Map<number, string>();
    for (const moves of prefixes) {
      const p = Position.fromMoves(moves);
      const grid = JSON.stringify(replay(moves).grid);
      const prev = seen.get(p.key());
      if (prev !== undefined) expect(prev).toBe(grid);
      seen.set(p.key(), grid);
      expect(p.key()).toBeLessThan(2 ** 49);
      const mirrored = Position.fromMoves(moves.map((c) => WIDTH - 1 - c));
      expect(mirrored.key()).toBe(p.mirrorKey());
    }
  });

  it("parses and formats 1-based move strings", () => {
    expect(parseMoves("4453")).toEqual([3, 3, 4, 2]);
    expect(formatMoves([3, 3, 4, 2])).toBe("4453");
    expect(() => parseMoves("48")).toThrow();
  });

  it("rejects illegal sequences", () => {
    expect(() => Position.fromMoves([0, 0, 0, 0, 0, 0, 0])).toThrow(/Illegal/);
    // vertical win by first player, then another move
    expect(() => Position.fromMoves([0, 1, 0, 1, 0, 1, 0, 2])).toThrow(/after a win/);
    expect(() => Position.fromMoves([0, 1, 0, 1, 0, 1, 0])).not.toThrow();
  });
});
