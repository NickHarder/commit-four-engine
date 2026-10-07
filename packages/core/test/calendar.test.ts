import { describe, expect, it } from "vitest";
import {
  addDays,
  boardCells,
  cellDate,
  commitTimestamp,
  dateToCell,
  seasonAnchorDate,
  seasonFirstSunday,
  seasonProfileUrl,
  slotAnchorSunday,
  weekday,
} from "../src/calendar";

describe("calendar", () => {
  it("places the 2016 boards on Sundays after the Jan 1 anchor week", () => {
    expect(seasonAnchorDate(2016)).toBe("2016-01-01");
    expect(seasonFirstSunday(2016)).toBe("2016-01-10");
    expect(slotAnchorSunday(2016, 0)).toBe("2016-01-10");
    expect(slotAnchorSunday(2016, 1)).toBe("2016-03-06");
    // the last slot's last day stays inside the year
    const last = cellDate(slotAnchorSunday(2016, 5), 6, 0);
    expect(last.startsWith("2016-")).toBe(true);
    for (let y = 1990; y <= 2030; y++) {
      expect(weekday(seasonFirstSunday(y))).toBe(0);
      expect(cellDate(slotAnchorSunday(y, 5), 6, 0).slice(0, 4)).toBe(String(y));
    }
  });

  it("maps rows to Mon (top) .. Sat (bottom) and columns to weeks", () => {
    const a = "2016-01-10";
    expect(cellDate(a, 0, 0)).toBe("2016-01-16"); // Saturday
    expect(weekday(cellDate(a, 0, 0))).toBe(6);
    expect(weekday(cellDate(a, 0, 5))).toBe(1); // Monday
    expect(cellDate(a, 1, 0)).toBe("2016-01-23");
    expect(() => cellDate("2016-01-11", 0, 0)).toThrow(/Sunday/);
  });

  it("dateToCell inverts cellDate and ignores the Sunday row", () => {
    const a = "2016-03-06";
    for (const c of boardCells(a)) expect(dateToCell(a, c.date)).toEqual({ col: c.col, row: c.row });
    expect(boardCells(a)).toHaveLength(42);
    expect(dateToCell(a, a)).toBeNull();
    expect(dateToCell(a, addDays(a, -1))).toBeNull();
    expect(dateToCell(a, addDays(a, 49))).toBeNull();
  });

  it("formats noon-UTC timestamps and profile URLs", () => {
    expect(commitTimestamp("2016-01-16")).toBe("2016-01-16T12:00:00+00:00");
    expect(() => commitTimestamp("2016-02-30")).toThrow();
    expect(seasonProfileUrl("NickHarder", 2016)).toBe(
      "https://github.com/NickHarder?tab=overview&from=2016-12-01&to=2016-12-31",
    );
  });
});
