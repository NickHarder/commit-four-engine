/**
 * GitWriter: writes turns from a local bare clone with plumbing commands (no working tree), then
 * one non-force `git push` (Start over is the one forced push, guarded by --force-with-lease).
 * Uses the user's existing git credentials; no GitHub token needed.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BoardWriter,
  batchMessages,
  ConflictError,
  commitTimestamp,
  ENGINE_AUTHOR,
  parseSentinel,
  parseState,
  type RemoteState,
  type ResetRequest,
  SENTINEL_FILE,
  STATE_PATH,
  type WriteRequest,
  type WriteResult,
} from "@commit-four/core";

export interface GitOptions {
  env?: NodeJS.ProcessEnv;
  input?: string;
}

export function git(dir: string, args: string[], opts: GitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      {
        cwd: dir,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...opts.env },
        maxBuffer: 16 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) reject(new GitError(args, String(stderr || err.message).trim()));
        else resolve(String(stdout).trim());
      },
    );
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    }
  });
}

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly stderr: string,
  ) {
    super(`git ${args[0]} failed: ${stderr}`);
  }
}

function engineEnv(): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: ENGINE_AUTHOR.name,
    GIT_AUTHOR_EMAIL: ENGINE_AUTHOR.email,
    GIT_COMMITTER_NAME: ENGINE_AUTHOR.name,
    GIT_COMMITTER_EMAIL: ENGINE_AUTHOR.email,
  };
}

export interface GitWriterOptions {
  /** Bare clone of the board repo. */
  dir: string;
  branch?: string;
  remote?: string;
}

export class GitWriter implements BoardWriter {
  readonly kind = "git" as const;
  private readonly branch: string;
  private readonly remote: string;
  private fetched = false;

  constructor(private readonly opts: GitWriterOptions) {
    this.branch = opts.branch ?? "main";
    this.remote = opts.remote ?? "origin";
  }

  private get trackingRef(): string {
    return `refs/remotes/${this.remote}/${this.branch}`;
  }

  async fetch(): Promise<void> {
    await git(this.opts.dir, [
      "fetch",
      "--quiet",
      this.remote,
      `+refs/heads/${this.branch}:${this.trackingRef}`,
    ]);
    this.fetched = true;
  }

  async readState(opts: { refresh?: boolean } = {}): Promise<RemoteState> {
    if (opts.refresh || !this.fetched) await this.fetch();
    const head = await git(this.opts.dir, ["rev-parse", this.trackingRef]);
    const read = async (path: string) => {
      try {
        return await git(this.opts.dir, ["show", `${head}:${path}`]);
      } catch {
        return null;
      }
    };
    const [stateText, sentinelText] = await Promise.all([read(STATE_PATH), read(SENTINEL_FILE)]);
    return {
      head,
      state: stateText === null ? null : parseState(JSON.parse(stateText)),
      sentinel: sentinelText === null ? null : parseSentinel(sentinelText),
    };
  }

  /** True when the remote branch exists (an empty repo has none). */
  async remoteHasBranch(): Promise<boolean> {
    const out = await git(this.opts.dir, ["ls-remote", "--heads", this.remote, this.branch]);
    return out.length > 0;
  }

  /** Writes the first commit of an empty repo (authored by the engine, so it doesn't count). */
  async bootstrap(files: { path: string; content: string }[], message: string): Promise<string> {
    const dir = this.opts.dir;
    const tmp = await mkdtemp(join(tmpdir(), "commit-four-"));
    try {
      const env = { GIT_INDEX_FILE: join(tmp, "index") };
      for (const f of files) {
        const blob = await git(dir, ["hash-object", "-w", "--stdin"], { input: f.content });
        await git(dir, ["update-index", "--add", "--cacheinfo", `100644,${blob},${f.path}`], { env });
      }
      const tree = await git(dir, ["write-tree"], { env });
      const commit = await git(dir, ["commit-tree", "--no-gpg-sign", tree, "-m", message], {
        env: engineEnv(),
      });
      await git(dir, ["push", "--quiet", this.remote, `${commit}:refs/heads/${this.branch}`]);
      await git(dir, ["update-ref", this.trackingRef, commit]);
      this.fetched = true;
      return commit;
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  async write(req: WriteRequest): Promise<WriteResult> {
    const dir = this.opts.dir;
    const head = await git(dir, ["rev-parse", this.trackingRef]);
    if (head !== req.expectedHead) throw new ConflictError();
    const tree = await git(dir, ["rev-parse", `${head}^{tree}`]);
    const committerDate = new Date().toISOString();
    let parent = head;
    let commits = 0;
    for (const batch of req.batches) {
      for (const message of batchMessages(batch)) {
        parent = await git(dir, ["commit-tree", "--no-gpg-sign", tree, "-p", parent, "-m", message], {
          env: {
            GIT_AUTHOR_NAME: req.pieceAuthor.name,
            GIT_AUTHOR_EMAIL: req.pieceAuthor.email,
            GIT_AUTHOR_DATE: commitTimestamp(batch.date),
            GIT_COMMITTER_NAME: req.pieceAuthor.name,
            GIT_COMMITTER_EMAIL: req.pieceAuthor.email,
            GIT_COMMITTER_DATE: committerDate,
          },
        });
        commits++;
      }
    }
    // state commit: build the new tree in a throwaway index
    const tmp = await mkdtemp(join(tmpdir(), "commit-four-"));
    try {
      const env = { GIT_INDEX_FILE: join(tmp, "index") };
      await git(dir, ["read-tree", tree], { env });
      for (const f of req.files) {
        const blob = await git(dir, ["hash-object", "-w", "--stdin"], { input: f.content });
        await git(dir, ["update-index", "--add", "--cacheinfo", `100644,${blob},${f.path}`], { env });
      }
      const newTree = await git(dir, ["write-tree"], { env });
      parent = await git(dir, ["commit-tree", "--no-gpg-sign", newTree, "-p", parent, "-m", req.message], {
        env: engineEnv(),
      });
      commits++;
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
    try {
      await git(dir, ["push", "--quiet", this.remote, `${parent}:refs/heads/${this.branch}`]);
    } catch (e) {
      if (e instanceof GitError && /rejected|non-fast-forward|fetch first/i.test(e.stderr))
        throw new ConflictError();
      throw e;
    }
    await git(dir, ["update-ref", this.trackingRef, parent, head]);
    return { head: parent, commits };
  }

  /** Start over: one new root commit with the head's files plus `req.files`, force-pushed. */
  async reset(req: ResetRequest): Promise<WriteResult> {
    const dir = this.opts.dir;
    const head = await git(dir, ["rev-parse", this.trackingRef]);
    if (head !== req.expectedHead) throw new ConflictError();
    const tmp = await mkdtemp(join(tmpdir(), "commit-four-"));
    let root: string;
    try {
      const env = { GIT_INDEX_FILE: join(tmp, "index") };
      await git(dir, ["read-tree", `${head}^{tree}`], { env });
      for (const f of req.files) {
        const blob = await git(dir, ["hash-object", "-w", "--stdin"], { input: f.content });
        await git(dir, ["update-index", "--add", "--cacheinfo", `100644,${blob},${f.path}`], { env });
      }
      const tree = await git(dir, ["write-tree"], { env });
      root = await git(dir, ["commit-tree", "--no-gpg-sign", tree, "-m", req.message], { env: engineEnv() });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
    const ref = `refs/heads/${this.branch}`;
    try {
      await git(dir, ["push", "--quiet", `--force-with-lease=${ref}:${head}`, this.remote, `${root}:${ref}`]);
    } catch (e) {
      if (e instanceof GitError && /stale info|rejected/i.test(e.stderr)) throw new ConflictError();
      throw e;
    }
    await git(dir, ["update-ref", this.trackingRef, root]);
    return { head: root, commits: 1 };
  }
}
