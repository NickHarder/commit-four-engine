/**
 * Service worker: the only context that sees the pairing token / PAT. Content scripts ask it to
 * read the game and make moves; it forwards to the local helper (companion mode) or runs the
 * engine itself against the GitHub API (browser-only mode), with the AI in an offscreen worker.
 * No game state is kept only in memory: the board repo (or helper) is the source of truth.
 */

import {
  ApiWriter,
  type BoardState,
  GameEngine,
  StaleMoveError,
  UnclaimedBoardError,
} from "@commit-four/core";
import {
  type AiRequest,
  isRequest,
  type Request,
  type Response,
  type WriteInfo,
  type WriteUpdate,
} from "./messages";
import { isConfigured, loadSettings, type Settings } from "./settings";

// --- listeners (registered synchronously at top level) ----------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  void restrictStorage();
});
chrome.runtime.onStartup.addListener(() => {
  void restrictStorage();
});
chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRequest(message) || !trustedSender(sender)) return false;
  (async () => {
    try {
      sendResponse(await handle(message, sender.tab?.id));
    } catch (e) {
      sendResponse(errorResponse(e));
    }
  })();
  return true;
});

// --- request handling --------------------------------------------------------------------------

function trustedSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  const url = sender.url ?? "";
  return url.startsWith("https://github.com/") || url.startsWith(chrome.runtime.getURL(""));
}

async function restrictStorage(): Promise<void> {
  // keep the token out of content scripts' reach (defence in depth)
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch {
    // not supported for this storage area in this Chrome version
  }
}

async function handle(req: Request, tabId: number | undefined): Promise<Response> {
  if (req.type === "c4:openOptions") {
    await chrome.runtime.openOptionsPage();
    return { ok: true, configured: true, state: null };
  }
  const settings = await loadSettings();
  if (!isConfigured(settings)) return { ok: true, configured: false, state: null };
  const base: Base = {
    ok: true,
    configured: true,
    owner: settings.owner,
    repo: settings.repo,
    mode: settings.mode,
  };
  return settings.mode === "companion"
    ? companion(req, settings, base)
    : browserOnly(req, settings, base, tabId);
}

type Base = { ok: true; configured: true; owner: string; repo: string; mode: Settings["mode"] };

// --- companion mode: the local helper does the work --------------------------------------------

async function companion(req: Request, s: Settings, base: Base): Promise<Response> {
  const call = async (path: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${s.helperPort}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${s.helperToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }).catch(() => {
      throw new Error("can't reach the local helper — is `commit-four serve` running?");
    });
    const json = (await res.json()) as {
      state?: BoardState | null;
      aiCol?: number | null;
      error?: string;
      writes?: WriteInfo;
    };
    if (!res.ok) {
      const response: Response = {
        ok: false,
        error: json.error ?? `helper error ${res.status}`,
        stale: res.status === 409,
        state: json.state ?? null,
      };
      throw new HelperError(response);
    }
    return json;
  };
  switch (req.type) {
    case "c4:getState": {
      const r = await call("/v1/status");
      return { ...base, state: r.state ?? null, ...(r.writes ? { writes: r.writes } : {}) };
    }
    case "c4:newGame": {
      const r = await call("/v1/new-game", { difficulty: req.difficulty, humanFirst: req.humanFirst });
      return { ...base, state: r.state ?? null, aiCol: r.aiCol ?? null };
    }
    case "c4:move": {
      const r = await call("/v1/move", { gameId: req.gameId, ply: req.ply, col: req.col });
      return { ...base, state: r.state ?? null, aiCol: r.aiCol ?? null };
    }
    case "c4:resign": {
      const r = await call("/v1/resign", { gameId: req.gameId });
      return { ...base, state: r.state ?? null };
    }
    default:
      throw new Error("unsupported request");
  }
}

// --- browser-only mode: engine + GitHub API in the extension ----------------------------------

let engine: { key: string; engine: GameEngine; writes: WriteInfo } | null = null;

async function engineFor(
  s: Settings,
  tabId: number | undefined,
): Promise<{ engine: GameEngine; writes: WriteInfo }> {
  const key = `${s.owner}/${s.repo}@${s.branch}:${s.pat.slice(-6)}`;
  // Reuse the live engine while it has writes in flight (it is ahead of the remote); otherwise
  // start from the remote truth.
  if (engine && engine.key === key && engine.writes.pending > 0) return engine;
  const writes: WriteInfo = engine?.key === key ? engine.writes : { pending: 0 };
  const e = new GameEngine({
    writer: new ApiWriter({ owner: s.owner, repo: s.repo, token: s.pat, branch: s.branch }),
    owner: s.owner,
    pieceAuthor: s.author!,
    chooser: chooseInOffscreen,
    onEvent: (ev) => {
      if (ev.type === "write-started") writes.pending++;
      if (ev.type === "write-done") {
        writes.pending = Math.max(0, writes.pending - 1);
        writes.lastOk = { commits: ev.commits, ms: ev.ms, at: new Date().toISOString() };
      }
      if (ev.type === "write-failed") {
        writes.pending = Math.max(0, writes.pending - 1);
        writes.lastError = { message: ev.error, at: new Date().toISOString() };
      }
      if (
        tabId !== undefined &&
        (ev.type === "write-done" || ev.type === "write-failed" || ev.type === "resynced")
      ) {
        const update: WriteUpdate = {
          type: "c4:writeUpdate",
          writes,
          ...(ev.type === "resynced" ? { state: ev.state } : {}),
        };
        void chrome.tabs.sendMessage(tabId, update).catch(() => undefined);
      }
    },
  });
  await e.load();
  engine = { key, engine: e, writes };
  return engine;
}

async function browserOnly(
  req: Request,
  s: Settings,
  base: Base,
  tabId: number | undefined,
): Promise<Response> {
  const { engine: e, writes } = await engineFor(s, tabId);
  switch (req.type) {
    case "c4:getState":
      return { ...base, state: e.current(), writes };
    case "c4:newGame": {
      const t = await e.newGame({ difficulty: req.difficulty, humanFirst: req.humanFirst });
      t.written.catch(() => undefined);
      return { ...base, state: t.state, aiCol: t.aiCol, writes };
    }
    case "c4:move": {
      const t = await e.move(req.gameId, req.ply, req.col);
      t.written.catch(() => undefined);
      return { ...base, state: t.state, aiCol: t.aiCol, writes };
    }
    case "c4:resign": {
      const t = await e.resign(req.gameId);
      t.written.catch(() => undefined);
      return { ...base, state: t.state, writes };
    }
    default:
      throw new Error("unsupported request");
  }
}

// --- AI in an offscreen document (keeps the solver off every page thread) --------------------

let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL("offscreen.html");
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (existing.length > 0) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Run the Connect 4 AI in a worker",
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

async function chooseInOffscreen(moves: number[], difficulty: AiRequest["difficulty"]): Promise<number> {
  await ensureOffscreen();
  const msg: AiRequest = { type: "c4:ai", target: "offscreen", moves, difficulty };
  const r = (await chrome.runtime.sendMessage(msg)) as { col?: number; error?: string } | undefined;
  if (!r || typeof r.col !== "number") throw new Error(r?.error ?? "AI worker did not answer");
  return r.col;
}

class HelperError extends Error {
  constructor(readonly response: Response) {
    super(response.ok ? "helper error" : response.error);
  }
}

function errorResponse(e: unknown): Response {
  if (e instanceof HelperError) return e.response;
  if (e instanceof StaleMoveError) return { ok: false, error: e.message, stale: true, state: e.state };
  if (e instanceof UnclaimedBoardError)
    return { ok: false, error: `${e.message} — open the extension options to claim it` };
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}
