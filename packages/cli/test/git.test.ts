import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardFiles, GameEngine, STATE_PATH } from "@commit-four/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitWriter } from "../src/git";

const author = { name: "Nick Harder", email: "29993711+NickHarder@users.noreply.github.com" };
let root: string;
let remote: string;
let local: string;

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "c4-git-"));
  remote = join(root, "remote.git");
  local = join(root, "local.git");
  sh(root, "init", "--quiet", "--bare", "--initial-branch=main", remote);
  sh(root, "clone", "--quiet", "--bare", remote, local);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function remoteLog(): { email: string; date: string; message: string }[] {
  return sh(remote, "log", "--reverse", "--format=%ae|%aI|%s", "main")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [email, date, message] = l.split("|") as [string, string, string];
      return { email, date, message };
    });
}

describe("GitWriter", () => {
  it("bootstraps an empty repo and plays turns as empty backdated commits", async () => {
    const writer = new GitWriter({ dir: local });
    expect(await writer.remoteHasBranch()).toBe(false);
    await writer.bootstrap(boardFiles("NickHarder", "b1"), "c4: set up");
    expect(await writer.remoteHasBranch()).toBe(true);

    const engine = new GameEngine({
      writer,
      owner: "NickHarder",
      pieceAuthor: author,
      chooser: () => 3,
      now: () => new Date("2026-10-07T12:00:00Z"),
    });
    await engine.load();
    await (await engine.newGame({ difficulty: "casual", humanFirst: true })).written;
    await (await engine.move(1, 0, 3)).written;

    const log = remoteLog();
    expect(log[0]!.email).toBe("engine@commit-four.invalid"); // setup commit doesn't count
    const pieces = log.filter((c) => c.email === author.email);
    const byDay: Record<string, number> = {};
    for (const c of pieces) byDay[c.date.slice(0, 10)] = (byDay[c.date.slice(0, 10)] ?? 0) + 1;
    expect(byDay).toEqual({ "2016-01-01": 4, "2016-02-06": 4, "2016-02-05": 2 });
    expect(pieces.every((c) => c.date.endsWith("T12:00:00Z") || c.date.endsWith("T12:00:00+00:00"))).toBe(
      true,
    );
    // every piece commit is empty
    const emptyCheck = sh(remote, "log", "--format=%H %T %P", "main").split("\n");
    const treeOf = new Map(
      emptyCheck.map((l) => l.split(" ") as [string, string, string]).map(([h, t]) => [h, t]),
    );
    for (const l of emptyCheck) {
      const [h, t, p] = l.split(" ");
      const email = sh(remote, "log", "-1", "--format=%ae", h!);
      if (email === author.email) expect(treeOf.get(p!)).toBe(t);
    }
    expect(JSON.parse(sh(remote, "show", `main:${STATE_PATH}`)).games[0].moves).toBe("44");
    expect(log.at(-1)!.email).toBe("engine@commit-four.invalid");
  });

  it("turns a rejected push into a conflict and recovers on retry", async () => {
    const writer = new GitWriter({ dir: local });
    await writer.bootstrap(boardFiles("NickHarder", "b1"), "c4: set up");
    // someone else pushes an unrelated commit straight to the remote
    const other = join(root, "other");
    sh(root, "clone", "--quiet", remote, other);
    execFileSync(
      "git",
      [
        "-c",
        "user.name=x",
        "-c",
        "user.email=x@example.com",
        "commit",
        "--quiet",
        "--allow-empty",
        "-m",
        "external",
      ],
      { cwd: other },
    );
    sh(other, "push", "--quiet", "origin", "main");

    const engine = new GameEngine({ writer, owner: "NickHarder", pieceAuthor: author, chooser: () => 0 });
    await engine.load();
    await (await engine.newGame({ difficulty: "casual", humanFirst: true })).written;
    const log = remoteLog();
    expect(log.some((c) => c.message === "external")).toBe(true);
    expect(log.filter((c) => c.email === author.email)).toHaveLength(4); // the anchor
  });

  it("refuses repos without a sentinel", async () => {
    const other = join(root, "plain");
    sh(root, "clone", "--quiet", remote, other);
    execFileSync(
      "git",
      [
        "-c",
        "user.name=x",
        "-c",
        "user.email=x@example.com",
        "commit",
        "--quiet",
        "--allow-empty",
        "-m",
        "real work",
      ],
      { cwd: other },
    );
    sh(other, "push", "--quiet", "origin", "main");
    const engine = new GameEngine({
      writer: new GitWriter({ dir: local }),
      owner: "NickHarder",
      pieceAuthor: author,
    });
    await expect(engine.load()).rejects.toThrow(/sentinel/);
  });
});
