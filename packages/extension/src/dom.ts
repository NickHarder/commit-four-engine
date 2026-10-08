/**
 * Everything that depends on GitHub's profile markup lives here, so a markup change is a one-file
 * fix. Markup as of 2026: div.js-calendar-graph[data-graph-url][data-from][data-to] containing
 * td.ContributionCalendar-day[data-date][data-level] cells and <tool-tip for=...> labels.
 */

export const SELECTORS = {
  calendar: ".js-calendar-graph",
  day: "td.ContributionCalendar-day[data-date]",
  viewer: 'meta[name="user-login"]',
} as const;

export interface CalendarRef {
  container: HTMLElement;
  /** Profile owner the calendar belongs to. */
  login: string;
  from: string;
  to: string;
}

export function findCalendar(root: ParentNode = document): CalendarRef | null {
  const container = root.querySelector<HTMLElement>(SELECTORS.calendar);
  if (!container) return null;
  const graphUrl = container.dataset.graphUrl ?? "";
  const login =
    /^\/users\/([A-Za-z0-9-]+)\/contributions/.exec(graphUrl)?.[1] ??
    /^\/([A-Za-z0-9-]+)$/.exec(container.dataset.url ?? "")?.[1];
  const from = container.dataset.from?.slice(0, 10);
  const to = container.dataset.to?.slice(0, 10);
  if (!login || !from || !to || !container.querySelector(SELECTORS.day)) return null;
  return { container, login, from, to };
}

export function viewerLogin(doc: Document = document): string | null {
  return doc.querySelector<HTMLMetaElement>(SELECTORS.viewer)?.content || null;
}

export function dayCells(container: HTMLElement): Map<string, HTMLTableCellElement> {
  const out = new Map<string, HTMLTableCellElement>();
  for (const td of container.querySelectorAll<HTMLTableCellElement>(SELECTORS.day))
    out.set(td.dataset.date!, td);
  return out;
}

/** Counts from the tooltips already in the page (what GitHub rendered). */
export function pageCounts(container: HTMLElement): Map<string, number> {
  const byId = new Map<string, number>();
  for (const tip of container.querySelectorAll("tool-tip[for]")) {
    const text = tip.textContent?.trim() ?? "";
    const n = /^No contributions\b/i.test(text)
      ? 0
      : Number(/^([\d,]+)\s+contributions?/i.exec(text)?.[1]?.replace(/,/g, ""));
    if (Number.isFinite(n)) byId.set(tip.getAttribute("for")!, n);
  }
  const out = new Map<string, number>();
  for (const [date, td] of dayCells(container)) {
    const n = byId.get(td.id);
    if (n !== undefined) out.set(date, n);
  }
  return out;
}

/** Runs `cb` whenever GitHub (Turbo / soft navigation) may have swapped the profile content. */
export function onPageChange(cb: () => void): void {
  for (const ev of ["turbo:load", "turbo:render", "soft-nav:react-done", "pageshow"])
    document.addEventListener(ev, cb);
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      cb();
    });
  }).observe(document.body, { childList: true, subtree: true });
}
