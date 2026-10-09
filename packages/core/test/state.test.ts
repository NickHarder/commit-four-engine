import { describe, expect, it } from "vitest";
import { addDays, boardCells, slotAnchorSunday } from "../src/calendar";
import { chooseRollingCounts, findEmptyWindows } from "../src/calibrate";
import { computeLevels } from "../src/levels";
import { gamePieces, planWrite, targetCounts } from "../src/renderPlan";
import {
  applyMove,
  currentGame,
  initialState,
  parseState,
  playerToMove,
  resign,
  startGame,
} from "../src/state";
import { renderBoardSvg } from "../src/svg";

const now = new Date("2026-10-07T12:00:00Z");

describe("board state", () => {
  it("starts a season game with the anchor and alternates turns", () => {
    let s = startGame(initialState("NickHarder", now), { difficulty: "hard", humanFirst: true, now });
    const g = currentGame(s)!;
    expect(g.placement).toEqual({ mode: "season", season: 2016, slot: 0, anchorSunday: "2016-01-10" });
    expect(s.anchors).toEqual([{ date: "2016-01-01", count: 14 }]);
    expect(playerToMove(g)).toBe("human");
    expect(() => applyMove(s, "ai", 3, now)).toThrow(/not the ai/);
    s = applyMove(s, "human", 3, now);
    expect(playerToMove(currentGame(s)!)).toBe("ai");
    s = applyMove(s, "ai", 3, now);
    expect(currentGame(s)!.moves).toBe("44");
  });

  it("detects wins and moves to the next slot and season", () => {
    let s = initialState("NickHarder", now);
    for (let i = 0; i < 7; i++) {
      s = startGame(s, { difficulty: "casual", humanFirst: true, now });
      for (const col of [0, 1, 0, 1, 0, 1])
        s = applyMove(s, s.games.at(-1)!.moves.length % 2 ? "ai" : "human", col, now);
      s = applyMove(s, "human", 0, now);
      expect(s.games.at(-1)!.status).toBe("human_won");
    }
    expect(s.games.map((g) => `${g.placement.season}/${g.placement.slot}`)).toEqual([
      "2016/0",
      "2016/1",
      "2016/2",
      "2016/3",
      "2016/4",
      "2016/5",
      "2015/0",
    ]);
    expect(s.anchors.map((a) => a.date)).toEqual(["2016-01-01", "2015-01-01"]);
    expect(() => applyMove(s, "ai", 2, now)).toThrow(/no game/);
    expect(parseState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it("rejects malformed or inconsistent state", () => {
    const good = startGame(initialState("NickHarder", now), { difficulty: "hard", humanFirst: true, now });
    expect(() => parseState({ ...good, version: 2 })).toThrow(/version/);
    expect(() => parseState({ ...good, owner: "bad owner" })).toThrow(/login/);
    const bad = structuredClone(good);
    bad.games[0]!.moves = "1111111";
    expect(() => parseState(bad)).toThrow(/full/);
    const over = structuredClone(good);
    over.games[0]!.moves = "1212121";
    expect(() => parseState(over)).toThrow(/over but marked/);
  });

  it("plans append-only writes: 4 commits per human square, 2 per AI square, anchor once", () => {
    const s0 = initialState("NickHarder", now);
    const s1 = startGame(s0, { difficulty: "hard", humanFirst: true, now });
    const s2 = applyMove(applyMove(s1, "human", 3, now), "ai", 3, now);
    const plan = planWrite(s0, s2);
    expect(plan).toEqual([
      { date: "2016-01-01", count: 14, kind: "anchor", message: "c4: season 2016 scale anchor" },
      // same column, one row up = the Friday before
      { date: "2016-02-05", count: 2, kind: "ai", message: "c4: game 1 ply 2 ai column 4" },
      { date: "2016-02-06", count: 4, kind: "human", message: "c4: game 1 ply 1 human column 4" },
    ]);
    const s3 = applyMove(s2, "human", 2, now);
    expect(planWrite(s2, s3)).toEqual([
      { date: "2016-01-30", count: 4, kind: "human", message: "c4: game 1 ply 3 human column 3" },
    ]);
    expect(() => planWrite(s3, s2)).toThrow(/append-only/);
    // the targets render exactly as intended under GitHub's formula
    const targets = targetCounts(s3);
    const days = Array.from({ length: 366 }, (_, i) => {
      const date = addDays("2016-01-01", i);
      return { date, count: targets.get(date) ?? 0 };
    });
    const levels = computeLevels(days);
    expect(levels.get("2016-02-06")).toBe(4);
    expect(levels.get("2016-02-05")).toBe(2);
    expect(levels.get("2016-01-30")).toBe(4);
  });

  it("keeps human squares at level 4 and AI squares at level 2 through full seasons", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    let s = initialState("NickHarder", now);
    let checked = 0;
    for (let game = 0; game < 8; game++) {
      s = startGame(s, { difficulty: "casual", humanFirst: game % 2 === 0, now });
      while (currentGame(s)) {
        const g = currentGame(s)!;
        const open = [0, 1, 2, 3, 4, 5, 6].filter(
          (c) => [...g.moves].filter((m) => m === String(c + 1)).length < 6,
        );
        s = applyMove(s, playerToMove(g), open[Math.floor(rand() * open.length)]!, now);
        const season = g.placement.season!;
        const targets = targetCounts(s);
        const days = Array.from({ length: season % 4 === 0 ? 366 : 365 }, (_, i) => {
          const date = addDays(`${season}-01-01`, i);
          return { date, count: targets.get(date) ?? 0 };
        });
        const levels = computeLevels(days);
        const pieces = s.games.filter((x) => x.placement.season === season).flatMap(gamePieces);
        // the only exception: the AI's opening square, before any human square exists that year
        if (!pieces.some((p) => p.player === "human")) continue;
        for (const p of pieces) expect(levels.get(p.date)).toBe(p.player === "human" ? 4 : 2);
        expect(levels.get(`${season}-01-01`)).toBe(4);
        checked++;
      }
    }
    expect(s.games.at(-1)!.placement.season).toBe(2015);
    expect(checked).toBeGreaterThan(100);
  });

  it("tops up an old 4-commit anchor on the next move", () => {
    const old = startGame(initialState("NickHarder", now), { difficulty: "hard", humanFirst: true, now });
    old.anchors[0]!.count = 4; // as written by version 0.1
    const next = applyMove(old, "human", 3, now);
    expect(next.anchors).toEqual([{ date: "2016-01-01", count: 14 }]);
    expect(planWrite(old, next)).toEqual([
      { date: "2016-01-01", count: 10, kind: "anchor", message: "c4: season 2016 scale anchor" },
      { date: "2016-02-06", count: 4, kind: "human", message: "c4: game 1 ply 1 human column 4" },
    ]);
  });

  it("renders an SVG and supports resigning", () => {
    let s = startGame(initialState("NickHarder", now), { difficulty: "perfect", humanFirst: false, now });
    s = applyMove(s, "ai", 3, now);
    expect(renderBoardSvg(currentGame(s))).toContain("<svg");
    s = resign(s, now);
    expect(s.games[0]!.status).toBe("resigned");
    expect(renderBoardSvg(s.games[0]!)).toContain("resigned");
  });
});

describe("rolling (last 12 months) calibration", () => {
  const today = "2026-10-07";
  const days = Array.from({ length: 365 }, (_, i) => {
    const date = addDays("2025-10-08", i);
    // organic activity on weekdays until May, then a quiet summer
    const busy = date < "2026-05-01" && ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
    return { date, count: busy ? 1 + (i % 7) : 0 };
  });

  it("finds an empty 7-week window and counts that keep the two shades distinct", () => {
    const windows = findEmptyWindows(days, today);
    expect(windows.length).toBeGreaterThan(0);
    const anchor = windows[0]!;
    for (const c of boardCells(anchor)) expect(c.date < today).toBe(true);
    const counts = chooseRollingCounts(days, anchor);
    expect(counts).not.toBeNull();
    expect(counts!.human).toBeGreaterThanOrEqual(7);
    expect(counts!.ai).toBeLessThanOrEqual(counts!.human / 2);
  });

  it("season anchors are Sundays", () => {
    expect(new Date(`${slotAnchorSunday(2016, 3)}T00:00:00Z`).getUTCDay()).toBe(0);
  });
});
