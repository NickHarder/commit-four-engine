/**
 * Content script: turns the contribution graph on your own profile into the Connect 4 board.
 * Clicks paint pieces immediately ("pending"), the service worker makes the move, and the real
 * graph is polled until GitHub catches up, at which point the pending outline disappears.
 */

import {
  applyMove,
  type BoardState,
  boardCells,
  contributionsFragmentPath,
  currentGame,
  type GameRecord,
  gamePieces,
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
  state: BoardState | null;
  meta: Extract<Response, { ok: true }> | null;
  writes: WriteInfo | null;
  touched: Set<string>;
  busy: boolean;
  error: string | null;
  lastMoveAt: number | null;
  syncNote: string | null;
  pollTimer: ReturnType<typeof setTimeout> | null;
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
  view = {
    cal,
    cells: dayCells(cal.container),
    real: pageCounts(cal.container),
    state: null,
    meta: null,
    writes: null,
    touched: new Set(),
    busy: false,
    error: null,
    lastMoveAt: null,
    syncNote: null,
    pollTimer: null,
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
      status: "Play Connect 4 on this graph. Open Settings to connect your board repo.",
      ...(v.error ? { error: v.error } : {}),
    };
  }
  if (v.meta.owner && v.meta.owner.toLowerCase() !== v.cal.login.toLowerCase()) {
    return { ...base, status: `Commit Four is set up for ${v.meta.owner}, not this profile.` };
  }
  const title = `Commit Four · ${v.meta.repo} (${v.meta.mode === "companion" ? "local helper" : "browser only"})`;
  const sync = syncText(v);
  const error = v.error ?? undefined;
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
      ...(sync ? { sync } : {}),
      ...(error ? { error } : {}),
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
      ...(sync ? { sync } : {}),
      ...(error ? { error } : {}),
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
    ...(sync ? { sync } : {}),
    ...(error ? { error } : {}),
  };
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
    if (r.writes) v.writes = r.writes;
  }
  render();
  startPolling();
}

async function onHudAction(a: HudAction): Promise<void> {
  const v = view;
  if (!v) return;
  if (a.type === "settings") {
    await send({ type: "c4:openOptions" });
    return;
  }
  v.busy = true;
  v.error = null;
  render();
  const req: Request =
    a.type === "newGame"
      ? { type: "c4:newGame", difficulty: a.difficulty, humanFirst: a.humanFirst }
      : { type: "c4:resign", gameId: currentGame(v.state!)?.id ?? 0 };
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

// --- confirmation polling -----------------------------------------------------------------------

function startPolling(): void {
  const v = view;
  if (!v) return;
  if (v.pollTimer) clearTimeout(v.pollTimer);
  const started = v.lastMoveAt ?? Date.now();
  let delay = 3000;
  const tick = async () => {
    if (view !== v) return;
    try {
      const res = await fetch(contributionsFragmentPath(v.cal.login, v.cal.from, v.cal.to), {
        credentials: "same-origin",
        headers: { Accept: "text/html" },
      });
      const cal = parseContributionCalendar(await res.text());
      for (const d of cal.days) {
        if (d.count < 0) continue;
        v.real.set(d.date, d.count);
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
    v.syncNote =
      pending === 0
        ? `GitHub caught up in ${Math.max(1, Math.round(elapsed / 1000))}s.`
        : elapsed > 120_000
          ? `GitHub's graph is lagging (${Math.round(elapsed / 60_000)} min so far) — keep playing, it will catch up.`
          : null;
    render();
    if (pending === 0) return;
    delay = Math.min(delay * 1.5, elapsed > 900_000 ? 60_000 : 15_000);
    v.pollTimer = setTimeout(tick, delay);
  };
  v.pollTimer = setTimeout(tick, delay);
}

chrome.runtime.onMessage.addListener((msg: WriteUpdate, sender) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== "c4:writeUpdate" || !view) return;
  view.writes = msg.writes;
  if (msg.state) view.state = msg.state;
  render();
  startPolling();
});

onPageChange(attach);
attach();
