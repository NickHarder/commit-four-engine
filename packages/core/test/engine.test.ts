import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { planWrite } from "../src/renderPlan";
import { applyMove, initialState, SENTINEL_FILE, STATE_PATH, startGame } from "../src/state";
import { ApiWriter, ConflictError } from "../src/writer";
import { FakeGitHub } from "./fakeGitHub";

const OWNER = "NickHarder";
const author = { name: "Nick Harder", email: "29993711+NickHarder@users.noreply.github.com" };
const now = () => new Date("2026-10-07T12:00:00Z");
const sentinel = JSON.stringify({ commitFour: 1, owner: OWNER, boardId: "test" });

function setup(files: Record<string, string> = {}) {
  const gh = new FakeGitHub(OWNER, "my-board", {
    [SENTINEL_FILE]: sentinel,
    [STATE_PATH]: JSON.stringify(initialState(OWNER, now())),
    ...files,
  });
  const writer = new ApiWriter({
    owner: OWNER,
    repo: "my-board",
    token: "t",
    fetch: gh.fetch,
    minIntervalMs: 0,
  });
  const events: string[] = [];
  const engine = new GameEngine({
    writer,
    owner: OWNER,
    pieceAuthor: author,
    now,
    chooser: (moves) => [3, 2, 4, 1, 5, 0, 6].find((c) => moves.filter((m) => m === c).length < 6)!,
    onEvent: (e) => events.push(e.type),
  });
  return { gh, writer, engine, events };
}

function countsByDate(gh: FakeGitHub, email: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of gh.history()) {
    if (c.author.email !== email) continue;
    const day = c.author.date.slice(0, 10);
    out[day] = (out[day] ?? 0) + 1;
  }
  return out;
}

describe("GameEngine + ApiWriter", () => {
  it("writes one atomic turn: anchor, 4 human + 2 AI empty commits, then a state commit", async () => {
    const { gh, engine } = setup();
    await engine.load();
    const start = await engine.newGame({ difficulty: "casual", humanFirst: true });
    await start.written;
    const turn = await engine.move(1, 0, 3);
    expect(turn.aiCol).toBe(3);
    await turn.written;

    expect(countsByDate(gh, author.email)).toEqual({ "2016-01-01": 14, "2016-02-06": 4, "2016-02-05": 2 });
    const history = gh.history();
    const pieces = history.filter((c) => c.author.email === author.email);
    expect(pieces.every((c) => c.author.date.endsWith("T12:00:00+00:00"))).toBe(true);
    // piece commits are empty: same tree as their parent
    for (const c of pieces) expect(gh.commits.get(c.parents[0]!)!.tree).toBe(c.tree);
    expect(history.at(-1)!.author.email).toBe("engine@commit-four.invalid");
    const state = JSON.parse(gh.file(STATE_PATH)!);
    expect(state.games[0].moves).toBe("44");
    expect(gh.file("state/board.svg")).toContain("<svg");
  });

  it("tops up a board written with the old 4-commit anchor without a conflict", async () => {
    const { gh, writer, engine } = setup();
    // a board as version 0.1 left it: anchor 4, one human + one AI square
    const t = now();
    const old = applyMove(
      applyMove(
        startGame(initialState(OWNER, t), { difficulty: "casual", humanFirst: true, now: t }),
        "human",
        3,
        t,
      ),
      "ai",
      3,
      t,
    );
    old.anchors[0]!.count = 4;
    const remote = await writer.readState();
    await writer.write({
      batches: planWrite(null, old),
      pieceAuthor: author,
      files: [{ path: STATE_PATH, content: JSON.stringify(old) }],
      message: "c4: old board",
      expectedHead: remote.head,
    });
    expect(countsByDate(gh, author.email)["2016-01-01"]).toBe(4);

    await engine.load();
    await (await engine.move(1, 2, 2)).written;
    expect(countsByDate(gh, author.email)["2016-01-01"]).toBe(14);
    expect(JSON.parse(gh.file(STATE_PATH)!).anchors).toEqual([{ date: "2016-01-01", count: 14 }]);
  });

  it("coalesces moves made while a write is in flight and stays idempotent on reload", async () => {
    const { gh, engine } = setup();
    await engine.load();
    await (await engine.newGame({ difficulty: "casual", humanFirst: true })).written;
    const t1 = await engine.move(1, 0, 0);
    const t2 = await engine.move(1, 2, 6);
    await Promise.all([t1.written, t2.written]);
    const before = gh.history().length;
    // a fresh engine sees the same state and has nothing to write
    const { engine: again } = {
      engine: new GameEngine({
        writer: new ApiWriter({
          owner: OWNER,
          repo: "my-board",
          token: "t",
          fetch: gh.fetch,
          minIntervalMs: 0,
        }),
        owner: OWNER,
        pieceAuthor: author,
        now,
      }),
    };
    await again.load();
    expect(again.current().games[0]!.moves).toBe(engine.current().games[0]!.moves);
    expect(gh.history().length).toBe(before);
  });

  it("retries after an unrelated push, and resyncs when the remote game diverged", async () => {
    const { gh, engine, events } = setup();
    await engine.load();
    await (await engine.newGame({ difficulty: "casual", humanFirst: true })).written;
    gh.externalPush({ "README.md": "edited elsewhere" });
    await (await engine.move(1, 0, 3)).written; // conflict on head, retried against the new head
    expect(JSON.parse(gh.file(STATE_PATH)!).games[0].moves).toBe("44");

    // another client plays a different move in the same game
    const other = JSON.parse(gh.file(STATE_PATH)!);
    other.games[0].moves = "4411";
    gh.externalPush({ [STATE_PATH]: JSON.stringify(other) });
    const t = await engine.move(1, 2, 6);
    await expect(t.written).rejects.toBeInstanceOf(ConflictError);
    expect(events).toContain("resynced");
    expect(engine.current().games[0]!.moves).toBe("4411");
  });

  it("refuses repos without a matching sentinel", async () => {
    const gh = new FakeGitHub(OWNER, "real-project", { "README.md": "my real code" });
    const engine = new GameEngine({
      writer: new ApiWriter({ owner: OWNER, repo: "real-project", token: "t", fetch: gh.fetch }),
      owner: OWNER,
      pieceAuthor: author,
    });
    await expect(engine.load()).rejects.toThrow(/sentinel/);
    const stranger = setup({
      [SENTINEL_FILE]: JSON.stringify({ commitFour: 1, owner: "someone-else", boardId: "x" }),
    });
    await expect(stranger.engine.load()).rejects.toThrow(/belongs to someone-else/);
  });

  it("enforces the hourly request budget", async () => {
    const gh = new FakeGitHub(OWNER, "my-board", { [SENTINEL_FILE]: sentinel });
    const writer = new ApiWriter({
      owner: OWNER,
      repo: "my-board",
      token: "t",
      fetch: gh.fetch,
      minIntervalMs: 0,
      hourlyLimit: 5,
    });
    const remote = await writer.readState();
    await expect(
      writer.write({
        batches: [{ date: "2016-01-01", count: 4, kind: "anchor", message: "a" }],
        pieceAuthor: author,
        files: [],
        message: "s",
        expectedHead: remote.head,
      }),
    ).rejects.toThrow(/hourly write budget/);
  });
});

describe("claiming a template board", () => {
  it("stamps the owner once and then plays normally", async () => {
    const gh = new FakeGitHub(OWNER, "my-board", {
      [SENTINEL_FILE]: JSON.stringify({ commitFour: 1, owner: "", boardId: "template" }),
      [STATE_PATH]: JSON.stringify(initialState("unclaimed-board", now())),
    });
    const engine = new GameEngine({
      writer: new ApiWriter({
        owner: OWNER,
        repo: "my-board",
        token: "t",
        fetch: gh.fetch,
        minIntervalMs: 0,
      }),
      owner: OWNER,
      pieceAuthor: author,
      now,
    });
    await expect(engine.load()).rejects.toThrow(/claimed/);
    await engine.claim(`${OWNER}/my-board`);
    const sentinelAfter = JSON.parse(gh.file(SENTINEL_FILE)!);
    expect(sentinelAfter.owner).toBe(OWNER);
    expect(sentinelAfter.boardId).not.toBe("template");
    expect(JSON.parse(gh.file(STATE_PATH)!).owner).toBe(OWNER);
    // the claim commit doesn't count as a contribution
    expect(gh.history().at(-1)!.author.email).toBe("engine@commit-four.invalid");
    await expect(engine.load()).resolves.toMatchObject({ owner: OWNER });
  });
});

describe("template copies of the engine repo", () => {
  const upstreamSentinel = JSON.stringify({
    commitFour: 1,
    owner: "",
    boardId: "template",
    upstream: "NickHarder/commit-four-engine",
  });

  it("claims a 'Use this template' copy without touching its code or README", async () => {
    const gh = new FakeGitHub("alice", "my-c4", {
      [SENTINEL_FILE]: upstreamSentinel,
      [STATE_PATH]: JSON.stringify(initialState("unclaimed-board", now())),
      "README.md": "# Commit Four (engine README)",
      "packages/core/src/index.ts": "export {};",
    });
    const engine = new GameEngine({
      writer: new ApiWriter({ owner: "alice", repo: "my-c4", token: "t", fetch: gh.fetch, minIntervalMs: 0 }),
      owner: "alice",
      pieceAuthor: { name: "Alice", email: "1+alice@users.noreply.github.com" },
      now,
    });
    await engine.claim("alice/my-c4");
    expect(gh.file("README.md")).toBe("# Commit Four (engine README)");
    expect(gh.file("packages/core/src/index.ts")).toBe("export {};");
    const sentinel = JSON.parse(gh.file(SENTINEL_FILE)!);
    expect(sentinel.owner).toBe("alice");
    expect(sentinel.upstream).toBeUndefined();
    await (await engine.newGame({ difficulty: "casual", humanFirst: true })).written;
    expect(JSON.parse(gh.file(STATE_PATH)!).games).toHaveLength(1);
  });

  it("refuses to claim the original template repo", async () => {
    const gh = new FakeGitHub("NickHarder", "commit-four-engine", {
      [SENTINEL_FILE]: upstreamSentinel,
      [STATE_PATH]: JSON.stringify(initialState("unclaimed-board", now())),
    });
    const engine = new GameEngine({
      writer: new ApiWriter({
        owner: "NickHarder",
        repo: "commit-four-engine",
        token: "t",
        fetch: gh.fetch,
        minIntervalMs: 0,
      }),
      owner: "NickHarder",
      pieceAuthor: author,
      now,
    });
    await expect(engine.claim("nickharder/Commit-Four-Engine")).rejects.toThrow(/template itself/);
    expect(JSON.parse(gh.file(SENTINEL_FILE)!).owner).toBe("");
  });
});

describe("changing difficulty mid-game", () => {
  it("applies to the AI's next move and is saved with the game", async () => {
    const { gh, engine } = setup();
    await engine.load();
    await (await engine.newGame({ difficulty: "casual", humanFirst: true })).written;
    await (await engine.move(1, 0, 3)).written;
    await (await engine.setDifficulty(1, "perfect")).written;
    expect(JSON.parse(gh.file(STATE_PATH)!).games[0].difficulty).toBe("perfect");
    await (await engine.move(1, 2, 2)).written;
    const saved = JSON.parse(gh.file(STATE_PATH)!).games[0];
    expect(saved.difficulty).toBe("perfect");
    expect(saved.moves).toHaveLength(4);
  });
});

describe("GitHub reads bypass the HTTP cache", () => {
  it("sees its own previous write immediately even when GitHub's responses are cacheable", async () => {
    const { gh, engine } = setup();
    gh.simulateHttpCache = true;
    await engine.load();
    await (await engine.newGame({ difficulty: "casual", humanFirst: true })).written;
    for (const [ply, col] of [
      [0, 0],
      [2, 6],
      [4, 0],
    ] as const) {
      await (await engine.move(1, ply, col)).written;
    }
    expect(JSON.parse(gh.file(STATE_PATH)!).games[0].moves).toHaveLength(6);
    // a fresh engine (like the extension after a page load) reads the latest state, not a cached one
    const fresh = new GameEngine({
      writer: new ApiWriter({
        owner: OWNER,
        repo: "my-board",
        token: "t",
        fetch: gh.fetch,
        minIntervalMs: 0,
      }),
      owner: OWNER,
      pieceAuthor: author,
    });
    expect((await fresh.load()).games[0]!.moves).toHaveLength(6);
  });
});
