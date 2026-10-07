import { describe, expect, it } from "vitest";
import { addDays } from "../src/calendar";
import { computeLevels, levelFor, quartileBoundaries } from "../src/levels";

function year(counts: Map<string, number>, start = "2016-01-01", days = 366) {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(start, i);
    return { date, count: counts.get(date) ?? 0 };
  });
}

describe("GitHub level formula", () => {
  it("renders 2 and 4 commits as levels 2 and 4 in an otherwise empty year", () => {
    const counts = new Map([
      ["2016-01-01", 4],
      ["2016-01-16", 4],
      ["2016-01-23", 2],
    ]);
    const levels = computeLevels(year(counts));
    expect(levels.get("2016-01-01")).toBe(4);
    expect(levels.get("2016-01-16")).toBe(4);
    expect(levels.get("2016-01-23")).toBe(2);
    expect(levels.get("2016-01-24")).toBe(0);
    expect(quartileBoundaries(year(counts).map((d) => d.count))).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps {0, 2, 4} stable as a full board fills up", () => {
    const counts = new Map<string, number>([["2016-01-01", 4]]);
    for (let i = 0; i < 42; i++) counts.set(addDays("2016-01-11", i * 1), i % 2 === 0 ? 4 : 2);
    const levels = computeLevels(year(counts));
    for (const [date, n] of counts) expect(levels.get(date)).toBe(n === 4 ? 4 : 2);
  });

  it("shows why a lone 2-commit square needs the season anchor", () => {
    // without a 4 anywhere, the max is 2 and a 2-commit square renders at level 4
    const levels = computeLevels(year(new Map([["2016-01-23", 2]])));
    expect(levels.get("2016-01-23")).toBe(4);
    // and the blueprint's 150/450/600 scheme does not give two clear shades
    const blueprint = computeLevels(
      year(
        new Map([
          ["2016-01-01", 600],
          ["2016-01-16", 450],
          ["2016-01-23", 150],
        ]),
      ),
    );
    expect(blueprint.get("2016-01-23")).toBe(1);
    expect(blueprint.get("2016-01-16")).toBe(3);
  });

  it("ignores the first outlier when picking the top of the scale", () => {
    // 5+ distinct values with one huge day: the huge day is an outlier and is ignored for `top`,
    // but still renders at level 4 because it exceeds every boundary
    const counts = new Map<string, number>();
    for (let i = 0; i < 60; i++) counts.set(addDays("2016-02-01", i), (i % 5) + 1);
    counts.set("2016-06-01", 500);
    const scores = year(counts).map((d) => d.count);
    const bounds = quartileBoundaries(scores);
    // top = 5 (500 ignored): mids over 1..5 are 1, 2, 3; the true max 500 is the last bound
    expect(bounds).toEqual([0, 1, 2, 3, 500]);
    expect(levelFor(500, bounds)).toBe(4);
    expect(levelFor(5, bounds)).toBe(4);
    expect(levelFor(1, bounds)).toBe(1);
  });

  it("handles an all-zero range", () => {
    expect(quartileBoundaries([0, 0, 0])).toEqual([0, 0, 0, 0, 0]);
    expect(levelFor(0, [0, 0, 0, 0, 0])).toBe(0);
  });
});
