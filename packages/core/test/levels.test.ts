import { describe, expect, it } from "vitest";
import { addDays } from "../src/calendar";
import { computeLevels, levelFor, quartileBoundaries } from "../src/levels";
import real from "./github-levels.json";

function year(counts: Map<string, number>, start = "2016-01-01", days = 366) {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(start, i);
    return { date, count: counts.get(date) ?? 0 };
  });
}

type View = { days: number; h: Record<string, Record<string, number>>; order: number[] };

/** Rebuilds a chronological day list from a view: values first appear in `order`. */
function daysOf(view: View): number[] {
  const left = new Map(Object.entries(view.h).map(([n, ls]) => [Number(n), Object.values(ls)[0]!]));
  const out: number[] = [];
  for (const n of view.order) {
    out.push(n);
    left.set(n, left.get(n)! - 1);
  }
  for (const [n, k] of left) for (let i = 0; i < k; i++) out.push(n);
  return out;
}

describe("GitHub level formula", () => {
  it.each(Object.entries(real.views as Record<string, View>))(
    "matches GitHub on a real calendar (%s)",
    (_, view) => {
      const days = daysOf(view);
      expect(days).toHaveLength(view.days);
      const bounds = quartileBoundaries(days);
      for (const [n, levels] of Object.entries(view.h)) {
        const level = Object.keys(levels)[0];
        expect({ count: Number(n), level: `L${levelFor(Number(n), bounds)}` }).toEqual({
          count: Number(n),
          level,
        });
      }
    },
  );

  it("drops the first outlier, so a nearly empty year renders every active day dark", () => {
    // 2016 as written by version 0.1: anchor 4, then human 4s and AI 2s
    const counts = new Map([
      ["2016-01-01", 4],
      ["2016-01-16", 4],
      ["2016-01-23", 2],
    ]);
    const levels = computeLevels(year(counts));
    expect(levels.get("2016-01-23")).toBe(4);
    expect(levels.get("2016-01-24")).toBe(0);
  });

  it("separates 4 and 2 once the anchor is a value of its own", () => {
    const counts = new Map([
      ["2016-01-01", 14],
      ["2016-01-16", 4],
      ["2016-01-23", 2],
    ]);
    const levels = computeLevels(year(counts));
    expect([levels.get("2016-01-01"), levels.get("2016-01-16"), levels.get("2016-01-23")]).toEqual([4, 4, 2]);
  });

  it("keeps the pieces' shades through one big unrelated day, but not through steady activity", () => {
    const board = new Map([
      ["2016-01-01", 14],
      ["2016-01-16", 4],
      ["2016-01-23", 2],
    ]);
    const shades = (extra: [string, number][]) => {
      const levels = computeLevels(year(new Map([...board, ...extra])));
      return [levels.get("2016-01-16"), levels.get("2016-01-23")];
    };
    expect(shades([])).toEqual([4, 2]);
    // a single 40-commit day is an outlier: GitHub leaves it out of the scale
    expect(shades([["2016-06-15", 40]])).toEqual([4, 2]);
    // a month of 10-commit days is the new normal: the scale tops out at 10 and the pieces fade
    const month = Array.from({ length: 30 }, (_, i): [string, number] => [addDays("2016-06-01", i), 10]);
    expect(shades(month)).toEqual([2, 1]);
  });

  it("uses exact quarters of the top of the scale", () => {
    expect(quartileBoundaries([0, 1, 2, 0, 0])).toEqual([0, 0.5, 1, 1.5]);
    expect(levelFor(1, [0, 0.5, 1, 1.5])).toBe(2);
    expect(levelFor(2, [0, 0.5, 1, 1.5])).toBe(4);
  });

  it("handles an all-zero range", () => {
    expect(quartileBoundaries([0, 0, 0])).toEqual([0, 0, 0, 0]);
    expect(levelFor(0, [0, 0, 0, 0])).toBe(0);
  });
});
