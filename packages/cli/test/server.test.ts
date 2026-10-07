import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { ApiWriter, GameEngine, initialState, SENTINEL_FILE, STATE_PATH } from "@commit-four/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeGitHub } from "../../core/test/fakeGitHub";
import { createHelperServer, type WriteStatus } from "../src/server";

const TOKEN = "test-token-0123456789abcdef";
const EXT = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
let server: ReturnType<typeof createHelperServer>;
let port: number;
let paired: string[];
let status: WriteStatus;

beforeEach(async () => {
  const gh = new FakeGitHub("NickHarder", "board", {
    [SENTINEL_FILE]: JSON.stringify({ commitFour: 1, owner: "NickHarder", boardId: "b" }),
    [STATE_PATH]: JSON.stringify(initialState("NickHarder")),
  });
  const engine = new GameEngine({
    writer: new ApiWriter({
      owner: "NickHarder",
      repo: "board",
      token: "t",
      fetch: gh.fetch,
      minIntervalMs: 0,
    }),
    owner: "NickHarder",
    pieceAuthor: { name: "N", email: "1+NickHarder@users.noreply.github.com" },
    chooser: () => 3,
  });
  await engine.load();
  paired = [];
  status = { pending: 0 };
  server = createHelperServer({
    engine,
    token: TOKEN,
    port: 0,
    status,
    meta: { owner: "NickHarder", repo: "board", version: "test" },
    onPair: (o) => {
      paired.push(o);
    },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

function call(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; json: Record<string, unknown>; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method, path, headers: { Host: `127.0.0.1:${port}`, ...opts.headers } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ status: res.statusCode!, json: data ? JSON.parse(data) : {}, headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const auth = { Authorization: `Bearer ${TOKEN}`, Origin: EXT };
const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  call("POST", path, {
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("local helper security", () => {
  it("rejects requests addressed to another host (DNS rebinding)", async () => {
    const r = await call("GET", "/v1/status", { headers: { ...auth, Host: `evil.example:${port}` } });
    expect(r.status).toBe(421);
  });

  it("rejects web-page origins even with a valid token", async () => {
    const r = await call("GET", "/v1/status", { headers: { ...auth, Origin: "https://evil.example" } });
    expect(r.status).toBe(403);
    const pre = await call("OPTIONS", "/v1/move", { headers: { Origin: "https://github.com" } });
    expect(pre.status).toBe(403);
  });

  it("requires the pairing token and binds the first extension origin", async () => {
    expect((await call("GET", "/v1/status", { headers: { Origin: EXT } })).status).toBe(401);
    expect(
      (await call("GET", "/v1/status", { headers: { Origin: EXT, Authorization: "Bearer nope" } })).status,
    ).toBe(401);
    const ok = await call("GET", "/v1/status", { headers: auth });
    expect(ok.status).toBe(200);
    expect(ok.headers["access-control-allow-origin"]).toBe(EXT);
    expect(paired).toEqual([EXT]);
    const otherExt = await call("GET", "/v1/status", {
      headers: { ...auth, Origin: "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" },
    });
    expect(otherExt.status).toBe(403);
  });

  it("validates bodies strictly", async () => {
    expect(
      (await call("POST", "/v1/move", { headers: { ...auth, "Content-Type": "text/plain" }, body: "{}" }))
        .status,
    ).toBe(415);
    expect((await post("/v1/move", { gameId: 1, ply: 0, col: 9 })).status).toBe(400);
    expect((await post("/v1/new-game", { difficulty: "godlike", humanFirst: true })).status).toBe(400);
    const big = await call("POST", "/v1/move", {
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ pad: "x".repeat(20_000) }),
    }).catch(() => ({ status: 413 }));
    expect(big.status).toBe(413);
  });
});

describe("local helper gameplay", () => {
  it("starts a game, plays a move, answers with the AI move and reports stale clicks", async () => {
    const g = await post("/v1/new-game", { difficulty: "hard", humanFirst: true });
    expect(g.status).toBe(200);
    const m = await post("/v1/move", { gameId: 1, ply: 0, col: 2 });
    expect(m.status).toBe(200);
    expect(m.json.aiCol).toBe(3);
    const stale = await post("/v1/move", { gameId: 1, ply: 0, col: 2 });
    expect(stale.status).toBe(409);
    expect((stale.json.state as { games: { moves: string }[] }).games[0]!.moves).toBe("34");
    const s = await call("GET", "/v1/status", { headers: auth });
    expect((s.json.state as { games: unknown[] }).games).toHaveLength(1);
  });
});
