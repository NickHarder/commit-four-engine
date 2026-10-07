/**
 * GitHub's contribution-graph shading, ported from the reverse-engineered model in
 * akerl/githubstats (MIT, lib/githubstats/data.rb). The model reproduced 103 real calendars
 * (~37.7k days) with zero mismatches in our research.
 *
 * The scale is computed over the days currently displayed (rolling year or one calendar year):
 * - mean and sample standard deviation over every displayed day, zeros included
 * - with >= 5 distinct counts, values whose |z| > GITHUB_MAGIC are outliers; GitHub ignores the
 *   first 1 (or 3) of them, in chronological order, when picking the top of the scale
 * - quartile boundaries are taken over 1..top, plus the true max
 */

import type { IsoDate } from "./calendar";

export const GITHUB_MAGIC = 3.77972616981;

export interface DayCount {
  date: IsoDate;
  count: number;
}

export type Level = 0 | 1 | 2 | 3 | 4;

/** Five ascending boundaries; a count's level is how many boundaries it strictly exceeds. */
export function quartileBoundaries(chronologicalCounts: readonly number[]): number[] {
  const scores = chronologicalCounts;
  if (scores.length === 0) return [0, 0, 0, 0, 0];
  let max = 0;
  let sum = 0;
  for (const s of scores) {
    if (s < 0 || !Number.isInteger(s)) throw new Error(`Invalid contribution count: ${s}`);
    if (s > max) max = s;
    sum += s;
  }
  const mean = sum / scores.length;

  const ignored = ghOutliers(scores, mean, max);
  let top = 0;
  for (const s of scores) if (!ignored.has(s) && s > top) top = s;

  // range = (1..top).to_a, or [0, 0, 0] when empty; Ruby negative indexes wrap from the end.
  const rangeSize = top >= 1 ? top : 3;
  const rangeAt = (i: number): number => {
    const idx = i < 0 ? rangeSize + i : i;
    return top >= 1 ? idx + 1 : 0;
  };
  const mids = [1, 2, 3].map((q) => rangeAt(Math.floor((q * rangeSize) / 4) - 1));
  const bounds = [...new Set([...mids, max])].sort((a, b) => a - b);
  while (bounds.length < 5) bounds.unshift(0);
  return bounds;
}

export function levelFor(count: number, bounds: readonly number[]): Level {
  let level = 0;
  for (const b of bounds) if (count > b) level++;
  return Math.min(level, 4) as Level;
}

/** Level for every displayed day. `days` must cover the full displayed range, zero days included. */
export function computeLevels(days: readonly DayCount[]): Map<IsoDate, Level> {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const bounds = quartileBoundaries(sorted.map((d) => d.count));
  return new Map(sorted.map((d) => [d.date, levelFor(d.count, bounds)]));
}

function ghOutliers(scores: readonly number[], mean: number, max: number): Set<number> {
  if (new Set(scores).size < 5) return new Set();
  let sq = 0;
  for (const s of scores) sq += (s - mean) ** 2;
  const sd = Math.sqrt(sq / (scores.length - 1));
  const outliers: number[] = [];
  for (const s of scores) {
    if (Math.abs((mean - s) / sd) > GITHUB_MAGIC && !outliers.includes(s)) outliers.push(s);
  }
  const take = max - mean < 6 || max < 15 ? 1 : 3;
  return new Set(outliers.slice(0, take));
}
