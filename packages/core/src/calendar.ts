/**
 * Calendar math for drawing a 7x6 Connect 4 board onto GitHub's contribution graph.
 *
 * The graph is a grid of weeks (columns, Sunday-first) by weekdays (rows, Sunday on top).
 * Board column c is one week; board row r (0 = bottom) is a weekday. We use Monday..Saturday,
 * so Saturday (the graph's bottom row) is the board's floor and pieces visibly "fall" down.
 * All dates are UTC calendar dates written as "YYYY-MM-DD".
 */

export type IsoDate = string;

export const BOARD_COLS = 7;
export const BOARD_ROWS = 6;
/** Boards per season year: 6 boards x (7 weeks + 1 gap week) = 48 weeks. */
export const SLOTS_PER_SEASON = 6;
const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(date: IsoDate): number {
  const m = ISO_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (formatIsoDate(ms) !== date) throw new Error(`Invalid date: ${date}`);
  return ms;
}

export function formatIsoDate(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return formatIsoDate(parseIsoDate(date) + days * DAY_MS);
}

/** Days from a to b (b - a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((parseIsoDate(b) - parseIsoDate(a)) / DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday, matching the graph's row order. */
export function weekday(date: IsoDate): number {
  return new Date(parseIsoDate(date)).getUTCDay();
}

export function todayUtc(now: Date = new Date()): IsoDate {
  return formatIsoDate(now.getTime());
}

/** The Sunday on or before `date` (the first day of that graph column). */
export function weekStart(date: IsoDate): IsoDate {
  return addDays(date, -weekday(date));
}

/** Date of board cell (col, row) where row 0 is the bottom (Saturday) and row 5 the top (Monday). */
export function cellDate(anchorSunday: IsoDate, col: number, row: number): IsoDate {
  assertCell(col, row);
  if (weekday(anchorSunday) !== 0) throw new Error(`Board anchor must be a Sunday: ${anchorSunday}`);
  return addDays(anchorSunday, 7 * col + (BOARD_ROWS - row));
}

/** Inverse of cellDate. Returns null for dates outside the board (including its blank Sunday row). */
export function dateToCell(anchorSunday: IsoDate, date: IsoDate): { col: number; row: number } | null {
  const offset = daysBetween(anchorSunday, date);
  if (offset < 0 || offset >= 7 * BOARD_COLS) return null;
  const col = Math.floor(offset / 7);
  const dow = offset % 7;
  if (dow === 0) return null;
  return { col, row: BOARD_ROWS - dow };
}

/** All 42 board cells with their dates, bottom row first. */
export function boardCells(anchorSunday: IsoDate): { col: number; row: number; date: IsoDate }[] {
  const cells: { col: number; row: number; date: IsoDate }[] = [];
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++)
      cells.push({ col, row, date: cellDate(anchorSunday, col, row) });
  }
  return cells;
}

/** The season's scale anchor: Jan 1 gets one dark square so the scale is fixed from the first write. */
export function seasonAnchorDate(season: number): IsoDate {
  return `${pad4(season)}-01-01`;
}

/** First Sunday strictly after Jan 7, so the anchor's week column stays separate from the boards. */
export function seasonFirstSunday(season: number): IsoDate {
  let d = `${pad4(season)}-01-08`;
  while (weekday(d) !== 0) d = addDays(d, 1);
  return d;
}

export function slotAnchorSunday(season: number, slot: number): IsoDate {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS_PER_SEASON)
    throw new Error(`Invalid slot: ${slot}`);
  return addDays(seasonFirstSunday(season), 56 * slot);
}

export function seasonRange(season: number): { from: IsoDate; to: IsoDate } {
  return { from: `${pad4(season)}-01-01`, to: `${pad4(season)}-12-31` };
}

/** The profile URL GitHub's own year links use for a calendar year. */
export function seasonProfileUrl(login: string, season: number): string {
  return `https://github.com/${encodeURIComponent(login)}?tab=overview&from=${pad4(season)}-12-01&to=${pad4(season)}-12-31`;
}

export function contributionsFragmentPath(login: string, from: IsoDate, to: IsoDate): string {
  return `/users/${encodeURIComponent(login)}/contributions?from=${from}&to=${to}`;
}

/**
 * Commit timestamp for a board day. Noon with an explicit +00:00 offset lands on the same calendar
 * day whether GitHub buckets by UTC or by the commit's own offset (its docs say both).
 */
export function commitTimestamp(date: IsoDate): string {
  parseIsoDate(date);
  return `${date}T12:00:00+00:00`;
}

function assertCell(col: number, row: number): void {
  if (!Number.isInteger(col) || col < 0 || col >= BOARD_COLS) throw new Error(`Invalid column: ${col}`);
  if (!Number.isInteger(row) || row < 0 || row >= BOARD_ROWS) throw new Error(`Invalid row: ${row}`);
}

function pad4(n: number): string {
  if (!Number.isInteger(n) || n < 1970 || n > 9999) throw new Error(`Invalid year: ${n}`);
  return String(n).padStart(4, "0");
}
