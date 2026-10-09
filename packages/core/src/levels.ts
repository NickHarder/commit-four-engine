/**
 * GitHub's contribution-graph shading. Started from the reverse-engineered model in
 * akerl/githubstats (MIT, lib/githubstats/data.rb), then corrected against 10 real views
 * (one account, 2016-2026, sparse and busy years) that the original model got wrong in sparse years:
 * - there is no "at least 5 distinct counts" condition: outliers are removed even in nearly empty
 *   years, which is why a lone small count can render at the darkest level
 * - the boundaries are exact quarters of `top` (a level is ceil(4 * count / top), capped at 4),
 *   not the integer quartiles of 1..top
 *
 * The scale is computed over the days currently displayed (rolling year or one calendar year):
 * - mean and sample standard deviation over every displayed day, zeros included
 * - distinct values whose |z| > GITHUB_MAGIC are outliers, in order of first appearance
 * - the first 1 of them (3 when the max is >= 15 and at least 6 above the mean) is ignored when
 *   picking `top`, the largest remaining count; with nothing left, every active day is level 4
 */

import type { IsoDate } from "./calendar";

export const GITHUB_MAGIC = 3.77972616981;

export interface DayCount {
  date: IsoDate;
  count: number;
}

export type Level = 0 | 1 | 2 | 3 | 4;

/** Four ascending boundaries; a count's level is how many boundaries it strictly exceeds. */
export function quartileBoundaries(chronologicalCounts: readonly number[]): number[] {
  const scores = chronologicalCounts;
  if (scores.length === 0) return [0, 0, 0, 0];
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
  return [0, top / 4, top / 2, (3 * top) / 4];
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
  if (scores.length < 2) return new Set();
  let sq = 0;
  for (const s of scores) sq += (s - mean) ** 2;
  const sd = Math.sqrt(sq / (scores.length - 1));
  if (sd === 0) return new Set();
  const outliers: number[] = [];
  for (const s of scores) {
    if (Math.abs((mean - s) / sd) > GITHUB_MAGIC && !outliers.includes(s)) outliers.push(s);
  }
  const take = max - mean < 6 || max < 15 ? 1 : 3;
  return new Set(outliers.slice(0, take));
}
