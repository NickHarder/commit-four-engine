/**
 * Plain-grid game rules used by the game layer (validation, winner, winning line).
 * The AI uses the bitboard in board.ts; this module favours clarity over speed.
 */

import { HEIGHT, WIDTH } from "./board";

export type Side = 1 | 2; // 1 = first player, 2 = second player
export type Grid = (0 | Side)[][]; // grid[col][row], row 0 = bottom

export interface Outcome {
  grid: Grid;
  /** Side to move next (meaningless once the game is over). */
  toMove: Side;
  winner: Side | null;
  /** The four (or more) winning cells, if any. */
  winLine: { col: number; row: number }[];
  draw: boolean;
  over: boolean;
}

const DIRS: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

export function emptyGrid(): Grid {
  return Array.from({ length: WIDTH }, () => Array<0 | Side>(HEIGHT).fill(0));
}

export function columnHeight(grid: Grid, col: number): number {
  const c = grid[col]!;
  let h = 0;
  while (h < HEIGHT && c[h] !== 0) h++;
  return h;
}

/** Replays 0-based columns, throwing on illegal moves or moves after the game ended. */
export function replay(cols: readonly number[]): Outcome {
  const grid = emptyGrid();
  let toMove: Side = 1;
  let winner: Side | null = null;
  let winLine: { col: number; row: number }[] = [];
  cols.forEach((col, ply) => {
    if (winner !== null) throw new Error(`Move after the game ended at ply ${ply}`);
    if (!Number.isInteger(col) || col < 0 || col >= WIDTH)
      throw new Error(`Invalid column ${col} at ply ${ply}`);
    const row = columnHeight(grid, col);
    if (row >= HEIGHT) throw new Error(`Column ${col + 1} is full at ply ${ply}`);
    grid[col]![row] = toMove;
    const line = winningLineThrough(grid, col, row);
    if (line.length >= 4) {
      winner = toMove;
      winLine = line;
    }
    toMove = toMove === 1 ? 2 : 1;
  });
  const draw = winner === null && cols.length === WIDTH * HEIGHT;
  return { grid, toMove, winner, winLine, draw, over: winner !== null || draw };
}

export function legalColumns(grid: Grid): number[] {
  const out: number[] = [];
  for (let c = 0; c < WIDTH; c++) if (columnHeight(grid, c) < HEIGHT) out.push(c);
  return out;
}

function winningLineThrough(grid: Grid, col: number, row: number): { col: number; row: number }[] {
  const side = grid[col]![row];
  if (!side) return [];
  let best: { col: number; row: number }[] = [];
  for (const [dc, dr] of DIRS) {
    const line = [{ col, row }];
    for (const sign of [1, -1]) {
      let c = col + sign * dc;
      let r = row + sign * dr;
      while (c >= 0 && c < WIDTH && r >= 0 && r < HEIGHT && grid[c]![r] === side) {
        line.push({ col: c, row: r });
        c += sign * dc;
        r += sign * dr;
      }
    }
    if (line.length >= 4 && line.length > best.length) best = line;
  }
  return best;
}
