import { describe, expect, it } from "vitest";
import { ensureBoard, GitHubClient } from "../src/github";
import { initialState, SENTINEL_FILE, STATE_PATH } from "../src/state";
import { FakeAccount } from "./fakeAccount";

const author = { name: "Nick Harder", email: "29993711+NickHarder@users.noreply.github.com" };

function account() {
  const a = new FakeAccount("NickHarder", 29993711);
  return { a, opts: { token: a.token, login: "NickHarder", author, fetch: a.fetch } };
}

describe("ensureBoard", () => {
  it("creates commit-four-board when it doesn't exist, without counting the setup commits", async () => {
    const { a, opts } = account();
    const r = await ensureBoard(opts);
    expect(r).toMatchObject({
      status: "created",
      owner: "NickHarder",
      repo: "commit-four-board",
      branch: "main",
    });
    const repo = a.repo("commit-four-board")!;
    expect(JSON.parse(repo.file(SENTINEL_FILE)!).owner).toBe("NickHarder");
    expect(JSON.parse(repo.file(STATE_PATH)!).owner).toBe("NickHarder");
    expect(repo.file("README.md")).toContain("game board");
    expect(repo.history().every((c) => c.author.email === "engine@commit-four.invalid")).toBe(true);
  });

  it("is idempotent, sets up an existing empty repo, and claims template copies", async () => {
    const { a, opts } = account();
    await ensureBoard(opts);
    expect(await ensureBoard(opts)).toMatchObject({ status: "existing" });

    a.addRepo("empty-one", null);
    expect(await ensureBoard({ ...opts, repo: "empty-one" })).toMatchObject({ status: "created" });

    a.addRepo("my-copy", {
      [SENTINEL_FILE]: JSON.stringify({
        commitFour: 1,
        owner: "",
        boardId: "template",
        upstream: "NickHarder/commit-four-engine",
      }),
      [STATE_PATH]: JSON.stringify(initialState("unclaimed-board")),
      "README.md": "engine readme",
    });
    expect(await ensureBoard({ ...opts, repo: "my-copy" })).toMatchObject({ status: "claimed" });
    expect(a.repo("my-copy")!.file("README.md")).toBe("engine readme");
  });

  it("never touches real repos, forks or someone else's board", async () => {
    const { a, opts } = account();
    const real = a.addRepo("real-project", { "index.js": "console.log(1)" });
    expect(await ensureBoard({ ...opts, repo: "real-project" })).toMatchObject({ status: "not-a-board" });
    expect(real.history()).toHaveLength(1);
    a.addRepo("a-fork", { "x.txt": "x" }, { fork: true });
    expect(await ensureBoard({ ...opts, repo: "a-fork" })).toMatchObject({ status: "fork" });
    a.addRepo("theirs", {
      [SENTINEL_FILE]: JSON.stringify({ commitFour: 1, owner: "someone", boardId: "b" }),
    });
    expect(await ensureBoard({ ...opts, repo: "theirs" })).toMatchObject({ status: "someone-else" });
  });

  it("returns the signed-in user's noreply identity", async () => {
    const { a } = account();
    const me = await new GitHubClient({ token: a.token, fetch: a.fetch }).user();
    expect(me).toEqual({ login: "NickHarder", id: 29993711, identity: author });
  });
});
