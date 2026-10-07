/**
 * Render planning: which day squares need how many commits. Everything is append-only — a
 * write only ever adds commits — so a plan is the difference between two states' targets.
 */

import { parseMoves } from "./board";
import { cellDate, type IsoDate } from "./calendar";
import { columnHeight, emptyGrid } from "./rules";
import { type BoardState, type GameRecord, type Player, playerOfPly } from "./state";

export interface PieceCell {
  gameId: number;
  ply: number;
  player: Player;
  col: number;
  row: number;
  date: IsoDate;
  count: number;
}

export interface CommitBatch {
  date: IsoDate;
  /** Number of commits to add on this date. */
  count: number;
  kind: Player | "anchor";
  message: string;
}

export function gamePieces(game: GameRecord): PieceCell[] {
  const grid = emptyGrid();
  return parseMoves(game.moves).map((col, ply) => {
    const row = columnHeight(grid, col);
    grid[col]![row] = ply % 2 === 0 ? 1 : 2;
    const player = playerOfPly(game, ply);
    return {
      gameId: game.id,
      ply,
      player,
      col,
      row,
      date: cellDate(game.placement.anchorSunday, col, row),
      count: game.counts[player],
    };
  });
}

/** Total commits each date should carry for this state. */
export function targetCounts(state: BoardState): Map<IsoDate, number> {
  const out = new Map<IsoDate, number>();
  const add = (date: IsoDate, n: number) => out.set(date, (out.get(date) ?? 0) + n);
  for (const a of state.anchors) add(a.date, a.count);
  for (const g of state.games) for (const p of gamePieces(g)) add(p.date, p.count);
  return out;
}

/** Commits needed to go from `prev` to `next`, oldest-first. Throws if `next` would remove commits. */
export function planWrite(prev: BoardState | null, next: BoardState): CommitBatch[] {
  const before = prev ? targetCounts(prev) : new Map<IsoDate, number>();
  const after = targetCounts(next);
  const labels = new Map<IsoDate, { kind: CommitBatch["kind"]; message: string }>();
  for (const a of next.anchors)
    labels.set(a.date, { kind: "anchor", message: `c4: season ${a.date.slice(0, 4)} scale anchor` });
  for (const g of next.games) {
    for (const p of gamePieces(g)) {
      labels.set(p.date, {
        kind: p.player,
        message: `c4: game ${g.id} ply ${p.ply + 1} ${p.player} column ${p.col + 1}`,
      });
    }
  }
  for (const [date, n] of before) {
    if ((after.get(date) ?? 0) < n)
      throw new Error(`append-only violation: ${date} would drop from ${n} commits`);
  }
  const batches: CommitBatch[] = [];
  for (const [date, n] of after) {
    const diff = n - (before.get(date) ?? 0);
    if (diff <= 0) continue;
    const label = labels.get(date)!;
    batches.push({ date, count: diff, kind: label.kind, message: label.message });
  }
  return batches.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
