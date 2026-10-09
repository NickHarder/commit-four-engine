/** Builds contribution-calendar HTML shaped like GitHub's 2026 markup (synthetic data). */
import { addDays, daysBetween, weekday } from "../src/calendar";
import { computeLevels } from "../src/levels";

export function calendarHtml(login: string, from: string, to: string, counts: Map<string, number>): string {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push({ date: d, count: counts.get(d) ?? 0 });
  const levels = computeLevels(days);
  const firstSunday = addDays(from, -weekday(from));
  const rows: string[] = [];
  const tips: string[] = [];
  for (let wd = 0; wd < 7; wd++) {
    const cells: string[] = [`<td class="ContributionCalendar-label"><span class="sr-only">Day</span></td>`];
    for (let d = addDays(firstSunday, wd); d <= to; d = addDays(d, 7)) {
      if (d < from) {
        cells.push(`<td></td>`);
        continue;
      }
      const week = Math.floor(daysBetween(firstSunday, d) / 7);
      const id = `contribution-day-component-${wd}-${week}`;
      const n = counts.get(d) ?? 0;
      const level = levels.get(d) ?? 0;
      cells.push(
        `<td tabindex="0" data-ix="${week}" aria-selected="false" aria-describedby="contribution-graph-legend-level-${level}" style="width: 11px" data-date="${d}" id="${id}" data-level="${level}" role="gridcell" data-view-component="true" class="ContributionCalendar-day"></td>`,
      );
      const text = n === 0 ? `No contributions on ${d}.` : `${n} contribution${n === 1 ? "" : "s"} on ${d}.`;
      tips.push(
        `<tool-tip id="tooltip-${id}" for="${id}" popover="manual" data-direction="n" data-type="label" data-view-component="true" class="sr-only position-absolute">${text}</tool-tip>`,
      );
    }
    rows.push(`<tr style="height: 10px">${cells.join("")}</tr>`);
  }
  // like GitHub's heading: contributions in the displayed range only
  const total = days.reduce((sum, d) => sum + d.count, 0);
  return `<div class="js-calendar-graph ContributionCalendar" data-graph-url="/users/${login}/contributions" data-url="/${login}" data-from="${from} 00:00:00 UTC" data-to="${to} 23:59:59 UTC">
<h2 id="js-contribution-activity-description" class="f4 text-normal mb-2">${total} contributions in ${from.slice(0, 4)}</h2>
<table role="grid" class="ContributionCalendar-grid js-calendar-graph-table"><tbody>${rows.join("\n")}</tbody></table>
${tips.join("\n")}
</div>`;
}
