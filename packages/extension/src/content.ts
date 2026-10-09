/**
 * Content script: turns the contribution graph on your own profile into the four-in-a-row board.
 * Clicks paint pieces immediately ("pending"), the service worker makes the move, and the real
 * graph is polled until GitHub catches up, at which point the pending outline disappears.
 */

import {
  applyMove,
  type BoardState,
  boardCells,
  boardSeasons,
  contributionsFragmentPath,
  currentGame,
  findEmptySeason,
  type GameRecord,
  gamePieces,
  initialState,
  isEmptyCalendar,
  needsNewSeason,
  parseContributionCalendar,
  parseMoves,
  playerToMove,
  replay,
  seasonProfileUrl,
  targetCounts,
} from "@commit-four/core";
import { type CalendarRef, dayCells, findCalendar, onPageChange, pageCounts, viewerLogin } from "./dom";
import { Hud, type HudAction, type HudView } from "./hud";
import type { Request, Response, WriteInfo, WriteUpdate } from "./messages";

interface View {
  cal: CalendarRef;
  cells: Map<string, HTMLTableCellElement>;
  /** Contribution counts GitHub reports for each displayed day. */
  real: Map<string, number>;
  /** The level GitHub shades each displayed day with (before any optimistic painting). */
  levels: Map<string, number>;
  state: BoardState | null;
  meta: Extract<Response, { ok: true }> | null;
  writes: WriteInfo | null;
  touched: Set<string>;
  busy: boolean;
  error: string | null;
  lastMoveAt: number | null;
  syncNote: string | null;
  pollTimer: ReturnType<typeof setTimeout> | null;
  /** Where the last action's time went (ms since the click). */
  timing: { start: number; ai?: number; saved?: number; graph?: number } | null;
  hud: Hud;
}

let view: View | null = null;

function send(req: Request): Promise<Response> {
  return chrome.runtime.sendMessage(req) as Promise<Response>;
}

function attach(): void {
  const cal = findCalendar();
  if (!cal) {
    if (view && !view.cal.container.isConnected) detach();
    return;
  }
  if (view && view.cal.container === cal.container) return;
  if (view) detach();
  const viewer = viewerLogin();
  if (!viewer || viewer.toLowerCase() !== cal.login.toLowerCase()) return; // only on your own profile
  const hud = new Hud(onHudAction);
  cal.container.after(hud.host);
  const cells = dayCells(cal.container);
  view = {
    cal,
    cells,
    real: pageCounts(cal.container),
    levels: new Map([...cells].map(([date, td]) => [date, Number(td.dataset.level ?? 0)])),
    state: null,
    meta: null,
    writes: null,
    touched: new Set(),
    busy: false,
    error: null,
    lastMoveAt: null,
    syncNote: null,
    pollTimer: null,
    timing: null,
    hud,
  };
  cal.container.addEventListener("click", onClick, true);
  cal.container.addEventListener("keydown", onKeydown, true);
  cal.container.addEventListener("mouseover", onHover);
  cal.container.addEventListener("mouseleave", clearGhost);
  void refresh();
}

function detach(): void {
  if (!view) return;
  if (view.pollTimer) clearTimeout(view.pollTimer);
  view.hud.host.remove();
  view = null;
}

async function refresh(): Promise<void> {
  if (!view) return;
  try {
    const r = await send({ type: "c4:getState" });
    if (!view) return;
    if (!r.ok) {
      view.error = r.error;
    } else {
      view.meta = r;
      view.state = r.state;
      view.writes = r.writes ?? null;
      view.error = null;
    }
  } catch (e) {
    view.error = `Commit Four couldn't reach its background worker (${String(e)})`;
  }
  render();
  if (pendingDates().length > 0) startPolling();
}

// --- painting -----------------------------------------------------------------------------------

/** Game shown on this calendar: the current game, or the latest game whose board is in range. */
function shownGame(v: View): GameRecord | null {
  const games = v.state?.games ?? [];
  for (let i = games.length - 1; i >= 0; i--) {
    if (inRange(v, games[i]!)) return games[i]!;
  }
  return null;
}

function inRange(v: View, g: GameRecord): boolean {
  return boardCells(g.placement.anchorSunday).every((c) => v.cells.has(c.date));
}

function pendingDates(): string[] {
  if (!view?.state) return [];
  const out: string[] = [];
  for (const [date, target] of targetCounts(view.state)) {
    if (view.cells.has(date) && (view.real.get(date) ?? 0) < target) out.push(date);
  }
  return out;
}

function restore(v: View): void {
  for (const date of v.touched) {
    const td = v.cells.get(date);
    if (!td) continue;
    if (td.dataset.c4Orig !== undefined) td.dataset.level = td.dataset.c4Orig;
    delete td.dataset.c4Orig;
    delete td.dataset.c4Col;
    td.classList.remove("c4-cell", "c4-pending", "c4-win", "c4-ghost");
  }
  v.touched.clear();
}

function render(): void {
  const v = view;
  if (!v) return;
  restore(v);
  const state = v.state;
  if (state) {
    // optimistic squares: anything the state wants that GitHub doesn't show yet
    const levelOf = new Map<string, number>();
    for (const a of state.anchors) levelOf.set(a.date, 4);
    for (const g of state.games)
      for (const p of gamePieces(g)) levelOf.set(p.date, p.player === "ai" ? 2 : 4);
    for (const [date, target] of targetCounts(state)) {
      const td = v.cells.get(date);
      if (!td || (v.real.get(date) ?? 0) >= target) continue;
      td.dataset.c4Orig = td.dataset.level ?? "0";
      td.dataset.level = String(levelOf.get(date) ?? 4);
      td.classList.add("c4-pending");
      v.touched.add(date);
    }
    const game = shownGame(v);
    if (game) {
      for (const c of boardCells(game.placement.anchorSunday)) {
        const td = v.cells.get(c.date)!;
        td.classList.add("c4-cell");
        td.dataset.c4Col = String(c.col);
        v.touched.add(c.date);
      }
      for (const w of replay(parseMoves(game.moves)).winLine) {
        const td = v.cells.get(
          boardCells(game.placement.anchorSunday).find((c) => c.col === w.col && c.row === w.row)!.date,
        );
        td?.classList.add("c4-win");
      }
    }
  }
  v.hud.render(hudView(v));
}

function hudView(v: View): HudView {
  const base = { title: "Commit Four", canNewGame: false, canResign: false } satisfies Partial<HudView>;
  if (v.error && !v.meta) return { ...base, status: "Something went wrong.", error: v.error };
  if (!v.meta) return { ...base, status: "Loading…" };
  if (!v.meta.configured) {
    return {
      ...base,
      status: "Play four in a row on this graph. Open Settings to connect your board repo.",
      ...(v.error ? { error: v.error } : {}),
    };
  }
  if (v.meta.owner && v.meta.owner.toLowerCase() !== v.cal.login.toLowerCase()) {
    return { ...base, status: `Commit Four is set up for ${v.meta.owner}, not this profile.` };
  }
  const title = `Commit Four · ${v.meta.repo} (${v.meta.mode === "companion" ? "local helper" : "browser only"})`;
  const sync = syncText(v);
  const error = v.error ?? undefined;
  const warning = shadingWarning(v);
  const extras = {
    ...(sync ? { sync } : {}),
    ...(error ? { error } : {}),
    ...(warning ? { warning } : {}),
  };
  const current = v.state ? currentGame(v.state) : null;
  const shown = shownGame(v);
  if (current && !inRange(v, current)) {
    const season = current.placement.season;
    return {
      title,
      status: `Game ${current.id} is drawn in ${season ?? "the last 12 months"}.`,
      link: {
        href: season ? seasonProfileUrl(v.cal.login, season) : `/${v.cal.login}`,
        label: `Open the ${season ?? "current"} graph`,
      },
      canNewGame: false,
      canResign: true,
      ...extras,
    };
  }
  if (current) {
    const yourTurn = playerToMove(current) === "human";
    const status = v.busy
      ? "AI is thinking…"
      : yourTurn
        ? `Your move — click a column on the board (${current.difficulty}).`
        : "Waiting for the AI…";
    return {
      title,
      status,
      canNewGame: false,
      canResign: !v.busy,
      canChangeDifficulty: !v.busy,
      difficulty: current.difficulty,
      ...extras,
    };
  }
  const last = shown ?? v.state?.games.at(-1) ?? null;
  const verdicts = {
    human_won: "You won game",
    ai_won: "The AI won game",
    draw: "Draw in game",
    resigned: "You resigned game",
    in_progress: "Game",
  } as const;
  const result = last ? `${verdicts[last.status]} ${last.id}.` : "No games yet.";
  return {
    title,
    status: `${result} Start a new one?`,
    canNewGame: !v.busy,
    canResign: false,
    ...extras,
  };
}

/**
 * GitHub's real shading vs what Commit Four aims for (yours level 4, the AI's level 2). Only
 * checked on a full calendar-year view of a board year, once GitHub shows every square, and once
 * the year has a square of yours (until then the AI's opening square is the top of the scale).
 */
function shadingWarning(v: View): string | null {
  const year = v.cal.from.slice(0, 4);
  if (!v.state || v.cal.from !== `${year}-01-01` || v.cal.to !== `${year}-12-31`) return null;
  if (pendingDates().length > 0) return null;
  const pieces = v.state.games.filter((g) => g.placement.season === Number(year)).flatMap(gamePieces);
  if (!pieces.some((p) => p.player === "human")) return null;
  const off = pieces.filter((p) => v.levels.get(p.date) !== (p.player === "human" ? 4 : 2)).length;
  if (off === 0) return null;
  return `GitHub is shading ${off} of this year's board squares differently than expected, so your pieces and the AI's may look alike. Other activity in ${year}, or a change in how GitHub picks shades, can cause this.`;
}

function syncText(v: View): string | undefined {
  if (v.syncNote) return v.syncNote;
  const pending = pendingDates().length;
  if (pending > 0)
    return `${pending} square${pending === 1 ? "" : "s"} waiting for GitHub to update the graph…`;
  if (v.writes?.lastError) return `Last write failed: ${v.writes.lastError.message}`;
  return undefined;
}

// --- interaction ----------------------------------------------------------------------------------

function boardColumnOf(target: EventTarget | null): number | null {
  const td = (target as Element | null)?.closest?.("td.c4-cell") as HTMLTableCellElement | null;
  if (!td?.dataset.c4Col) return null;
  return Number(td.dataset.c4Col);
}

function onClick(ev: MouseEvent): void {
  const col = boardColumnOf(ev.target);
  if (col === null) return;
  // don't let GitHub treat the click as "filter activity to this day"
  ev.preventDefault();
  ev.stopPropagation();
  void play(col);
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== "Enter" && ev.key !== " ") return;
  const col = boardColumnOf(ev.target);
  if (col === null) return;
  ev.preventDefault();
  ev.stopPropagation();
  void play(col);
}

function onHover(ev: MouseEvent): void {
  clearGhost();
  const v = view;
  const col = boardColumnOf(ev.target);
  const game = v?.state ? currentGame(v.state) : null;
  if (!v || col === null || !game || playerToMove(game) !== "human" || v.busy) return;
  const row = replay(parseMoves(game.moves)).grid[col]!.indexOf(0);
  if (row < 0) return;
  const cell = boardCells(game.placement.anchorSunday).find((c) => c.col === col && c.row === row)!;
  v.cells.get(cell.date)?.classList.add("c4-ghost");
}

function clearGhost(): void {
  for (const td of view?.cal.container.querySelectorAll(".c4-ghost") ?? []) td.classList.remove("c4-ghost");
}

async function play(col: number): Promise<void> {
  const v = view;
  if (!v?.state || v.busy) return;
  const game = currentGame(v.state);
  if (!game || playerToMove(game) !== "human" || !inRange(v, game)) return;
  if (replay(parseMoves(game.moves)).grid[col]!.indexOf(0) < 0) {
    v.error = `Column ${col + 1} is full.`;
    render();
    return;
  }
  const before = v.state;
  v.state = applyMove(before, "human", col); // optimistic paint
  v.busy = true;
  v.error = null;
  v.syncNote = null;
  v.timing = { start: Date.now() };
  clearGhost();
  render();
  const r = await send({ type: "c4:move", gameId: game.id, ply: game.moves.length, col }).catch(
    (e: unknown): Response => ({ ok: false, error: String(e) }),
  );
  if (view !== v) return;
  v.busy = false;
  if (!r.ok) {
    v.state = r.state ?? before;
    v.error = r.stale ? "The board changed elsewhere; showing the latest state." : r.error;
  } else {
    v.state = r.state;
    v.lastMoveAt = Date.now();
    if (v.timing) v.timing.ai = Date.now() - v.timing.start;
    if (r.writes) v.writes = r.writes;
  }
  render();
  startPolling();
}

async function onHudAction(a: HudAction): Promise<void> {
  const v = view;
  if (!v) return;
  if (a.type === "settings") {
    const r = await send({ type: "c4:openOptions" }).catch(
      (e: unknown): Response => ({ ok: false, error: String(e) }),
    );
    if (!r.ok) {
      v.error = `Couldn't open settings: ${r.error}. Click the Commit Four icon in the toolbar instead.`;
      render();
    }
    return;
  }
  const gameId = v.state ? (currentGame(v.state)?.id ?? 0) : 0;
  v.busy = true;
  v.error = null;
  v.timing = { start: Date.now() };
  render();
  let season: number | undefined;
  if (a.type === "newGame") {
    const picked = await pickSeason(v);
    if (view !== v) return;
    if (typeof picked === "string") {
      v.busy = false;
      v.error = picked;
      v.syncNote = null;
      render();
      return;
    }
    season = picked ?? undefined;
  }
  const req: Request =
    a.type === "newGame"
      ? {
          type: "c4:newGame",
          difficulty: a.difficulty,
          humanFirst: a.humanFirst,
          ...(season !== undefined ? { season } : {}),
        }
      : a.type === "difficulty"
        ? { type: "c4:setDifficulty", gameId, difficulty: a.difficulty }
        : { type: "c4:resign", gameId };
  const r = await send(req).catch((e: unknown): Response => ({ ok: false, error: String(e) }));
  if (view !== v) return;
  v.busy = false;
  if (!r.ok) v.error = r.error;
  else {
    v.state = r.state;
    v.lastMoveAt = Date.now();
    const g = r.state ? currentGame(r.state) : null;
    if (a.type === "newGame" && g && !inRange(v, g) && g.placement.season) {
      location.assign(seasonProfileUrl(v.cal.login, g.placement.season));
      return;
    }
  }
  render();
  startPolling();
}

/**
 * The year for the next game when the board's years are full: the newest past year whose graph
 * (as you see it) is empty. Null when an existing year has room; a string is an error to show.
 */
async function pickSeason(v: View): Promise<number | null | string> {
  const state = v.state ?? initialState(v.cal.login);
  if (!needsNewSeason(state)) return null;
  v.syncNote = "Looking for an empty year on your graph for the board…";
  render();
  try {
    const year = await findEmptySeason({
      exclude: boardSeasons(state),
      isEmpty: async (y) => {
        const res = await fetch(contributionsFragmentPath(v.cal.login, `${y}-01-01`, `${y}-12-31`), {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "text/html" },
        });
        if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${y}`);
        return isEmptyCalendar(await res.text());
      },
    });
    v.syncNote = null;
    return (
      year ?? "Every past year on your graph has contributions, so there's no empty year to put a board in."
    );
  } catch (e) {
    return `Couldn't read your graph to pick a year for the board (${e instanceof Error ? e.message : String(e)}). Try again in a moment.`;
  }
}

// --- confirmation polling -----------------------------------------------------------------------

function startPolling(opts: { now?: boolean } = {}): void {
  const v = view;
  if (!v) return;
  if (v.pollTimer) clearTimeout(v.pollTimer);
  const started = v.lastMoveAt ?? Date.now();
  // every 1.5 s for the first 30 s (GitHub usually updates within seconds), then back off
  const nextDelay = (elapsed: number, prev: number) =>
    elapsed < 30_000 ? 1500 : Math.min(prev * 1.5, elapsed > 900_000 ? 60_000 : 15_000);
  let delay = 1500;
  const tick = async () => {
    if (view !== v) return;
    try {
      const res = await fetch(contributionsFragmentPath(v.cal.login, v.cal.from, v.cal.to), {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "text/html" },
      });
      const cal = parseContributionCalendar(await res.text());
      for (const d of cal.days) {
        if (d.count < 0) continue;
        v.real.set(d.date, d.count);
        v.levels.set(d.date, d.level);
        const td = v.cells.get(d.date);
        if (!td) continue;
        // keep GitHub's own squares fresh too
        if (td.dataset.c4Orig !== undefined) td.dataset.c4Orig = String(d.level);
        else td.dataset.level = String(d.level);
      }
    } catch {
      // offline or rate limited: try again later
    }
    if (view !== v) return;
    const pending = pendingDates().length;
    const elapsed = Date.now() - started;
    if (pending === 0 && v.timing && v.timing.graph === undefined)
      v.timing.graph = Date.now() - v.timing.start;
    v.syncNote =
      pending === 0
        ? timingNote(v)
        : elapsed > 120_000
          ? `GitHub's graph is lagging (${Math.round(elapsed / 60_000)} min so far) — keep playing, it will catch up.`
          : null;
    render();
    if (pending === 0) return;
    delay = nextDelay(elapsed, delay);
    v.pollTimer = setTimeout(tick, delay);
  };
  v.pollTimer = setTimeout(tick, opts.now ? 0 : delay);
}

function timingNote(v: View): string {
  const t = v.timing;
  // "in 0.0s" reads like a bug: anything under 0.1 s is "instantly"
  const took = (what: string, ms: number) =>
    ms < 100 ? `${what} instantly` : `${what} in ${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  if (!t || t.graph === undefined) return "Your graph is up to date.";
  const parts = [
    ...(t.ai !== undefined ? [took("AI answered", t.ai)] : []),
    ...(t.saved !== undefined ? [took("saved", t.saved)] : []),
    took("GitHub caught up", t.graph),
  ];
  return `${parts.join(" · ")}.`;
}

chrome.runtime.onMessage.addListener((msg: WriteUpdate, sender) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== "c4:writeUpdate" || !view) return;
  view.writes = msg.writes;
  if (msg.state) view.state = msg.state;
  const t = view.timing;
  const savedAt = msg.writes.lastOk ? Date.parse(msg.writes.lastOk.at) : Number.NaN;
  if (t && t.saved === undefined && savedAt >= t.start) t.saved = savedAt - t.start;
  render();
  // the write just landed: look at the graph right away
  startPolling({ now: true });
});

onPageChange(attach);
attach();
