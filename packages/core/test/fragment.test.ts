import { describe, expect, it } from "vitest";
import { parseContributionCalendar, parseTooltipCount } from "../src/fragment";
import { calendarHtml } from "./fixtures";

describe("contribution calendar parser", () => {
  it("reads dates, levels and counts", () => {
    const html = calendarHtml(
      "NickHarder",
      "2016-01-01",
      "2016-12-31",
      new Map([
        ["2016-01-01", 4],
        ["2016-01-16", 4],
        ["2016-01-15", 2],
      ]),
    );
    const cal = parseContributionCalendar(html);
    expect(cal.from).toBe("2016-01-01");
    expect(cal.to).toBe("2016-12-31");
    expect(cal.days).toHaveLength(366);
    const byDate = new Map(cal.days.map((d) => [d.date, d]));
    expect(byDate.get("2016-01-01")).toMatchObject({ count: 4, level: 4 });
    expect(byDate.get("2016-01-15")).toMatchObject({ count: 2, level: 2 });
    expect(byDate.get("2016-01-02")).toMatchObject({ count: 0, level: 0 });
    expect(cal.privateProfile).toBe(false);
  });

  it("parses tooltip variants", () => {
    expect(parseTooltipCount("No contributions on September 7th.")).toBe(0);
    expect(parseTooltipCount("1 contribution on September 6th.")).toBe(1);
    expect(parseTooltipCount("1,204 contributions on May 10th.")).toBe(1204);
    expect(parseTooltipCount("something else")).toBeNull();
  });
});
