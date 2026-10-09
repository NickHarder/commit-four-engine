/**
 * Local helper HTTP API for the browser extension (companion mode).
 *
 * Bound to 127.0.0.1 only. Every request must carry the pairing token, must be addressed to
 * 127.0.0.1/localhost (DNS-rebinding defence) and may only come from a browser-extension origin
 * (or no origin, e.g. curl). Web pages can't drive it: their Origin is rejected and preflights
 * from them are refused.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  type BoardState,
  DIFFICULTIES,
  type Difficulty,
  type GameEngine,
  needsNewSeason,
  StaleMoveError,
  WIDTH,
} from "@commit-four/core";

export interface HelperMeta {
  owner: string;
  repo: string;
  version: string;
}

export interface HelperOptions {
  engine: GameEngine;
  token: string;
  port: number;
  meta: HelperMeta;
  /** Bound extension origin; when unset, the first valid authenticated extension origin is bound. */
  extensionOrigin?: string;
  onPair?: (origin: string) => void | Promise<void>;
  log?: (msg: string) => void;
}

export interface WriteStatus {
  pending: number;
  lastOk?: { head: string; commits: number; ms: number; at: string };
  lastError?: { message: string; at: string };
}

const MAX_BODY = 8 * 1024;
const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension):\/\/[a-z0-9-]{1,64}$/i;

export function createHelperServer(opts: HelperOptions & { status: WriteStatus }): Server {
  let boundOrigin = opts.extensionOrigin;
  const log = opts.log ?? (() => undefined);
  const tokenBuf = Buffer.from(opts.token);

  const send = (res: ServerResponse, status: number, body: unknown, origin?: string) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (origin) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers.Vary = "Origin";
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  };

  const hostOk = (req: IncomingMessage) => {
    const host = req.headers.host ?? "";
    const port = req.socket.localPort;
    return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  };

  const originOk = (origin: string | undefined): boolean => {
    if (origin === undefined) return true; // non-browser client
    if (!EXTENSION_ORIGIN.test(origin)) return false;
    return boundOrigin === undefined || boundOrigin === origin;
  };

  const authOk = (req: IncomingMessage) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    if (!m) return false;
    const given = Buffer.from(m[1]!);
    return given.length === tokenBuf.length && timingSafeEqual(given, tokenBuf);
  };

  const readJson = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
        reject(new HttpError(415, "expected application/json"));
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new HttpError(413, "request body too large"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
          resolve(v as Record<string, unknown>);
        } catch {
          reject(new HttpError(400, "invalid JSON"));
        }
      });
      req.on("error", reject);
    });

  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    try {
      if (!hostOk(req)) return send(res, 421, { error: "wrong host" });
      if (!originOk(origin)) return send(res, 403, { error: "origin not allowed" });
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "OPTIONS") {
        if (!origin) return send(res, 400, { error: "not a preflight" });
        res.writeHead(204, {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST",
          "Access-Control-Allow-Headers": "authorization, content-type",
          "Access-Control-Allow-Private-Network": "true",
          "Access-Control-Max-Age": "600",
          Vary: "Origin",
        });
        return res.end();
      }
      if (req.method === "GET" && url.pathname === "/v1/health") {
        return send(res, 200, { ok: true, app: "commit-four-helper" }, origin);
      }
      if (!authOk(req)) return send(res, 401, { error: "missing or invalid pairing token" }, origin);
      if (origin && boundOrigin === undefined) {
        boundOrigin = origin;
        await opts.onPair?.(origin);
        log(`paired with ${origin}`);
      }

      if (req.method === "GET" && url.pathname === "/v1/status") {
        return send(res, 200, statusBody(opts, safeState(opts.engine)), origin);
      }
      if (req.method !== "POST") return send(res, 404, { error: "not found" }, origin);
      const body = await readJson(req);

      if (url.pathname === "/v1/new-game") {
        const difficulty = body.difficulty;
        if (!DIFFICULTIES.includes(difficulty as Difficulty)) throw new HttpError(400, "difficulty");
        if (typeof body.humanFirst !== "boolean") throw new HttpError(400, "humanFirst");
        const season = body.season === undefined ? undefined : intField(body, "season", 1980, 9999);
        // a new year must come from a check of the owner's graph (the extension does it), never a guess
        if (season === undefined && needsNewSeason(opts.engine.current()))
          throw new HttpError(422, "a new board year is needed: reload the page to pick one");
        const turn = await opts.engine.newGame({
          difficulty: difficulty as Difficulty,
          humanFirst: body.humanFirst,
          ...(season !== undefined ? { season } : {}),
        });
        track(opts, turn.written, log);
        log(
          `new game (${difficulty}, ${body.humanFirst ? "you" : "AI"} first)${turn.aiCol !== null ? `; AI opened in column ${turn.aiCol + 1}` : ""}`,
        );
        return send(res, 200, { state: turn.state, aiCol: turn.aiCol }, origin);
      }
      if (url.pathname === "/v1/move") {
        const gameId = intField(body, "gameId", 1, 1_000_000);
        const ply = intField(body, "ply", 0, 41);
        const col = intField(body, "col", 0, WIDTH - 1);
        const turn = await opts.engine.move(gameId, ply, col);
        track(opts, turn.written, log);
        log(
          `you played column ${col + 1}${turn.aiCol !== null ? `, AI answered column ${turn.aiCol + 1}` : ""}`,
        );
        return send(res, 200, { state: turn.state, aiCol: turn.aiCol }, origin);
      }
      if (url.pathname === "/v1/difficulty") {
        const difficulty = body.difficulty;
        if (!DIFFICULTIES.includes(difficulty as Difficulty)) throw new HttpError(400, "difficulty");
        const turn = await opts.engine.setDifficulty(
          intField(body, "gameId", 1, 1_000_000),
          difficulty as Difficulty,
        );
        track(opts, turn.written, log);
        log(`difficulty set to ${difficulty}`);
        return send(res, 200, { state: turn.state, aiCol: null }, origin);
      }
      if (url.pathname === "/v1/start-over") {
        if (body.confirm !== true) throw new HttpError(400, "confirm");
        const state = await opts.engine.startOver();
        log("started over: all games erased");
        return send(res, 200, { state, aiCol: null }, origin);
      }
      if (url.pathname === "/v1/resign") {
        const turn = await opts.engine.resign(intField(body, "gameId", 1, 1_000_000));
        track(opts, turn.written, log);
        return send(res, 200, { state: turn.state, aiCol: null }, origin);
      }
      return send(res, 404, { error: "not found" }, origin);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message }, origin);
      if (e instanceof StaleMoveError) return send(res, 409, { error: e.message, state: e.state }, origin);
      const message = e instanceof Error ? e.message : String(e);
      // rule violations (illegal move, wrong turn) are client errors
      if (/illegal|full|not the|no game|already in progress|ended|season/i.test(message))
        return send(res, 422, { error: message }, origin);
      log(`error: ${message}`);
      return send(res, 500, { error: "internal error" }, origin);
    }
  });
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function intField(body: Record<string, unknown>, name: string, min: number, max: number): number {
  const v = body[name];
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max)
    throw new HttpError(400, `invalid ${name}`);
  return v as number;
}

function safeState(engine: GameEngine): BoardState | null {
  try {
    return engine.current();
  } catch {
    return null;
  }
}

function statusBody(opts: HelperOptions & { status: WriteStatus }, state: BoardState | null) {
  return { app: "commit-four-helper", ...opts.meta, state, writes: opts.status };
}

function track(
  opts: { status: WriteStatus },
  written: Promise<{ head: string; commits: number }>,
  log: (m: string) => void,
) {
  const t0 = Date.now();
  opts.status.pending++;
  written.then(
    (r) => {
      opts.status.pending--;
      opts.status.lastOk = {
        head: r.head,
        commits: r.commits,
        ms: Date.now() - t0,
        at: new Date().toISOString(),
      };
      log(
        r.commits
          ? `pushed ${r.commits} commits in ${((Date.now() - t0) / 1000).toFixed(1)}s`
          : "nothing to push",
      );
    },
    (e: unknown) => {
      opts.status.pending--;
      const message = e instanceof Error ? e.message : String(e);
      opts.status.lastError = { message, at: new Date().toISOString() };
      log(`write failed: ${message}`);
    },
  );
}
