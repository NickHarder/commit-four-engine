/** Shared fakes for the profile page and its contribution calendar, shaped like github.com's. */
import { addDays } from "../../core/src/calendar";
import { calendarHtml } from "../../core/test/fixtures";

/**
 * A believable owner: one contribution every year from 2017 on (like an account created in 2017),
 * so 2016 is the newest empty year and new boards go there.
 */
export function withBackground(board: Map<string, number>): Map<string, number> {
  const out = new Map(board);
  for (let y = 2017; y <= 2026; y++) out.set(`${y}-03-15`, (out.get(`${y}-03-15`) ?? 0) + 1);
  return out;
}

/**
 * The profile page, as on github.com: `?from=YYYY-12-01` shows that calendar year, no `from`
 * shows the last 12 months.
 */
export function profilePage(owner: string, url: URL, counts: Map<string, number>): string {
  const year = url.searchParams.get("from")?.slice(0, 4);
  const today = new Date().toISOString().slice(0, 10);
  const cal = year
    ? calendarHtml(owner, `${year}-01-01`, `${year}-12-31`, counts)
    : calendarHtml(owner, addDays(today, -364), today, counts);
  return `<!doctype html><html><head><meta name="user-login" content="${owner}"></head><body><main><h1>${owner}</h1>${cal}</main></body></html>`;
}
