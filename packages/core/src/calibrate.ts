/**
 * Fallback ("rolling", last-12-months) mode: the board shares the visible range with the owner's
 * real activity, so commit counts must be chosen against that activity using GitHub's formula.
 * Best effort — the scale drifts as the 12-month window moves.
 */

import { BOARD_COLS, BOARD_ROWS, boardCells, type IsoDate, weekday } from "./calendar";
import { computeLevels, type DayCount } from "./levels";

export interface RollingPlan {
  anchorSunday: IsoDate;
  counts: { human: number; ai: number };
}

/**
 * Anchor Sundays whose 42 board days (Mon-Sat of 7 consecutive weeks) all have zero activity and
 * lie strictly before `today`. Newest first, so the board stays visible as long as possible.
 */
export function findEmptyWindows(days: readonly DayCount[], today: IsoDate): IsoDate[] {
  const byDate = new Map(days.map((d) => [d.date, d.count]));
  const sundays = days.filter((d) => weekday(d.date) === 0).map((d) => d.date);
  const out: IsoDate[] = [];
  for (const sunday of sundays) {
    const cells = boardCells(sunday);
    if (cells.every((c) => c.date < today && byDate.get(c.date) === 0)) out.push(sunday);
  }
  return out.sort().reverse();
}

/**
 * Smallest (human, ai) commit counts such that, for every reachable piece count, human squares
 * render at level 4 and AI squares at level 2 on top of the existing activity.
 */
export function chooseRollingCounts(
  days: readonly DayCount[],
  anchorSunday: IsoDate,
  opts: { maxHuman?: number } = {},
): { human: number; ai: number } | null {
  const organicMax = days.reduce((m, d) => Math.max(m, d.count), 0);
  const maxHuman = opts.maxHuman ?? Math.max(60, organicMax * 3);
  const cells = boardCells(anchorSunday);
  const half = (BOARD_COLS * BOARD_ROWS) / 2;
  const states: [number, number][] = [];
  for (let h = 0; h <= half; h++) {
    for (const a of [h - 1, h, h + 1]) if (a >= 0 && a <= half && h + a > 0) states.push([h, a]);
  }
  for (let human = Math.max(4, organicMax); human <= maxHuman; human++) {
    for (let ai = Math.ceil(human / 4); ai <= Math.floor(human / 2); ai++) {
      if (states.every(([h, a]) => holds(days, cells, h, a, human, ai))) return { human, ai };
    }
  }
  return null;
}

function holds(
  days: readonly DayCount[],
  cells: { date: IsoDate }[],
  h: number,
  a: number,
  human: number,
  ai: number,
): boolean {
  const extra = new Map<IsoDate, number>();
  // deterministic fill: alternate human/AI squares from the bottom row up
  let hi = 0;
  let ai2 = 0;
  for (const cell of cells) {
    if (hi < h && (hi <= ai2 || ai2 >= a)) {
      extra.set(cell.date, human);
      hi++;
    } else if (ai2 < a) {
      extra.set(cell.date, ai);
      ai2++;
    }
    if (hi >= h && ai2 >= a) break;
  }
  const merged = days.map((d) => ({ date: d.date, count: d.count + (extra.get(d.date) ?? 0) }));
  const levels = computeLevels(merged);
  for (const [date, n] of extra) {
    const want = n === human ? 4 : 2;
    if (levels.get(date) !== want) return false;
  }
  return true;
}
