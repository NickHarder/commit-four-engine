/**
 * Parser for GitHub's contribution calendar HTML (the profile page or the
 * `/users/<login>/contributions?from=&to=` fragment). Regex-based so it runs in Node and in
 * extension contexts alike. Markup as of 2026:
 *   <td data-date="2025-09-07" id="contribution-day-component-0-0" data-level="0" class="ContributionCalendar-day">
 *   <tool-tip for="contribution-day-component-0-0">No contributions on September 7th.</tool-tip>
 */

import type { IsoDate } from "./calendar";
import type { DayCount, Level } from "./levels";

export interface CalendarDay extends DayCount {
  level: Level;
  /** DOM id of the cell, used to match tooltips. */
  id: string;
}

export interface ParsedCalendar {
  from: IsoDate | null;
  to: IsoDate | null;
  days: CalendarDay[];
  /** "activity is private" banner seen (anonymous view of a private profile). */
  privateProfile: boolean;
}

const TD_RE = /<td\b[^>]*\bContributionCalendar-day\b[^>]*>/g;
const TIP_RE = /<tool-tip\b([^>]*)>([^<]*)<\/tool-tip>/g;

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1]! : null;
}

export function parseTooltipCount(text: string): number | null {
  const t = text.trim();
  if (/^No contributions\b/i.test(t)) return 0;
  const m = /^([\d,]+)\s+contributions?\b/i.exec(t);
  return m ? Number(m[1]!.replace(/,/g, "")) : null;
}

export function parseContributionCalendar(html: string): ParsedCalendar {
  const tips = new Map<string, number>();
  for (const m of html.matchAll(TIP_RE)) {
    const forId = attr(m[1]!, "for");
    const count = parseTooltipCount(m[2]!);
    if (forId && count !== null) tips.set(forId, count);
  }
  const days: CalendarDay[] = [];
  for (const m of html.matchAll(TD_RE)) {
    const tag = m[0];
    const date = attr(tag, "data-date");
    const id = attr(tag, "id") ?? "";
    const level = Number(attr(tag, "data-level") ?? "0");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    days.push({
      date,
      id,
      level: (level >= 0 && level <= 4 ? level : 0) as Level,
      count: tips.get(id) ?? -1,
    });
  }
  const container = /<div\b[^>]*\bjs-calendar-graph\b[^>]*>/.exec(html)?.[0] ?? "";
  const from = attr(container, "data-from")?.slice(0, 10) ?? null;
  const to = attr(container, "data-to")?.slice(0, 10) ?? null;
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { from, to, days, privateProfile: /activity is private/i.test(html) };
}

/** True when a calendar view shows days and every one of them has zero contributions. */
export function isEmptyCalendar(html: string): boolean {
  const cal = parseContributionCalendar(html);
  return !cal.privateProfile && cal.days.length > 0 && cal.days.every((d) => d.count === 0);
}
