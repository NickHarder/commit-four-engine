/** Message shapes between the content script, service worker, offscreen document and options page. */

import type { BoardState, Difficulty } from "@commit-four/core";

export type Mode = "companion" | "browser";

export interface WriteInfo {
  pending: number;
  lastOk?: { commits: number; ms: number; at: string };
  lastError?: { message: string; at: string };
}

export type Request =
  | { type: "c4:getState" }
  | { type: "c4:newGame"; difficulty: Difficulty; humanFirst: boolean }
  | { type: "c4:move"; gameId: number; ply: number; col: number }
  | { type: "c4:resign"; gameId: number }
  | { type: "c4:setDifficulty"; gameId: number; difficulty: Difficulty }
  | { type: "c4:openOptions" };

export type Response =
  | {
      ok: true;
      configured: boolean;
      owner?: string;
      repo?: string;
      mode?: Mode;
      state: BoardState | null;
      aiCol?: number | null;
      writes?: WriteInfo;
    }
  | { ok: false; error: string; state?: BoardState | null; stale?: boolean };

/** Service worker -> tab. */
export interface WriteUpdate {
  type: "c4:writeUpdate";
  writes: WriteInfo;
  state?: BoardState | null;
}

/** Service worker -> offscreen document. */
/** Service worker -> offscreen document: load the AI before the first move needs it. */
export interface AiWarmup {
  type: "c4:ai-warm";
  target: "offscreen";
}

export interface AiRequest {
  type: "c4:ai";
  target: "offscreen";
  moves: number[];
  difficulty: Difficulty;
}

export function isRequest(x: unknown): x is Request {
  if (typeof x !== "object" || x === null) return false;
  const t = (x as { type?: unknown }).type;
  return (
    t === "c4:getState" ||
    t === "c4:newGame" ||
    t === "c4:move" ||
    t === "c4:resign" ||
    t === "c4:setDifficulty" ||
    t === "c4:openOptions"
  );
}
