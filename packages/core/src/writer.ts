/**
 * Writers turn a render plan into commits in the board repo. Every write is one atomic ref
 * update, never a force push. Piece commits are empty commits authored by the owner on the
 * board day (noon UTC); the final commit updates state/game.json + state/board.svg and is authored by
 * ENGINE_AUTHOR, whose reserved `.invalid` email never counts as a contribution.
 */

import { commitTimestamp } from "./calendar";
import type { CommitBatch } from "./renderPlan";
import { type BoardState, ENGINE_AUTHOR, parseState, SENTINEL_FILE, STATE_PATH } from "./state";

export interface Identity {
  name: string;
  email: string;
}

export interface WriteRequest {
  batches: CommitBatch[];
  pieceAuthor: Identity;
  files: { path: string; content: string }[];
  message: string;
  /** Head the plan was computed against; the write fails with ConflictError if the branch moved. */
  expectedHead: string;
}

export interface WriteResult {
  head: string;
  commits: number;
}

export interface RemoteState {
  state: BoardState | null;
  head: string;
  sentinel: Sentinel | null;
}

export interface Sentinel {
  commitFour: 1;
  owner: string;
  boardId: string;
  /** Set only in the source template repo: "owner/name" of the repo that must never be claimed. */
  upstream?: string;
}

export interface BoardWriter {
  readonly kind: "git" | "api";
  readState(opts?: { refresh?: boolean }): Promise<RemoteState>;
  write(req: WriteRequest): Promise<WriteResult>;
}

export class ConflictError extends Error {
  constructor(message = "the board repo changed underneath this write") {
    super(message);
  }
}

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const REPO_SLUG = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

export function parseSentinel(text: string): Sentinel {
  const json = JSON.parse(text) as Partial<Sentinel>;
  if (
    json.commitFour !== 1 ||
    typeof json.owner !== "string" ||
    typeof json.boardId !== "string" ||
    !/^[A-Za-z0-9-]{0,39}$/.test(json.owner) ||
    (json.upstream !== undefined && (typeof json.upstream !== "string" || !REPO_SLUG.test(json.upstream)))
  ) {
    throw new Error(`${SENTINEL_FILE} is not a Commit Four sentinel`);
  }
  return json as Sentinel;
}

export function pieceCommitCount(batches: readonly CommitBatch[]): number {
  return batches.reduce((n, b) => n + b.count, 0);
}

/** Commit messages for one batch, e.g. "c4: game 1 ply 3 human column 4 (2/4)". */
export function batchMessages(batch: CommitBatch): string[] {
  return Array.from({ length: batch.count }, (_, i) => `${batch.message} (${i + 1}/${batch.count})`);
}

// ---------------------------------------------------------------------------------------------

export interface ApiWriterOptions {
  owner: string;
  repo: string;
  token: string;
  branch?: string;
  apiBase?: string;
  fetch?: typeof fetch;
  /** Minimum gap between mutating requests (GitHub asks for serial, spaced writes). */
  minIntervalMs?: number;
  /** Cap on content-creating requests per rolling hour (GitHub's secondary limit is 500). */
  hourlyLimit?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Git Data API writer (browser-only mode): 1 request per commit + 1 tree + 1 ref update. */
export class ApiWriter implements BoardWriter {
  readonly kind = "api" as const;
  private readonly opts: Required<Omit<ApiWriterOptions, "fetch">> & { fetch: typeof fetch };
  private lastMutation = 0;
  private readonly mutations: number[] = [];

  constructor(opts: ApiWriterOptions) {
    this.opts = {
      branch: "main",
      apiBase: "https://api.github.com",
      minIntervalMs: 250,
      hourlyLimit: 450,
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...opts,
      fetch: opts.fetch ?? globalThis.fetch.bind(globalThis),
    };
  }

  async readState(): Promise<RemoteState> {
    const head = await this.headSha();
    const [stateText, sentinelText] = await Promise.all([
      this.readFile(STATE_PATH, head),
      this.readFile(SENTINEL_FILE, head),
    ]);
    return {
      head,
      state: stateText === null ? null : parseState(JSON.parse(stateText)),
      sentinel: sentinelText === null ? null : parseSentinel(sentinelText),
    };
  }

  /**
   * First commit of an empty repo. The Git Data API can't write to an empty repo, so the first
   * file goes through the Contents API (which creates the branch), then the rest in one commit.
   * Everything is authored by ENGINE_AUTHOR, so setup never counts as a contribution.
   */
  async bootstrap(files: { path: string; content: string }[], message: string): Promise<string> {
    const { owner, repo, branch } = this.opts;
    const [first, ...rest] = files;
    if (!first) throw new Error("nothing to bootstrap");
    await this.mutate("PUT", `/repos/${owner}/${repo}/contents/${first.path}`, {
      message,
      content: encodeBase64Utf8(first.content),
      branch,
      author: ENGINE_AUTHOR,
      committer: ENGINE_AUTHOR,
    });
    const head = await this.headSha();
    if (rest.length === 0) return head;
    const r = await this.write({
      batches: [],
      pieceAuthor: ENGINE_AUTHOR,
      files: rest,
      message,
      expectedHead: head,
    });
    return r.head;
  }

  /** True when the repo has no commits yet (GitHub answers 409 "Git Repository is empty"). */
  async isEmpty(): Promise<boolean> {
    try {
      await this.headSha();
      return false;
    } catch (e) {
      if (e instanceof GitHubApiError && (e.status === 409 || e.status === 404)) return true;
      throw e;
    }
  }

  /** Requests a write will cost, for the hourly budget. */
  static requestCost(req: Pick<WriteRequest, "batches">): number {
    return pieceCommitCount(req.batches) + 3; // + tree, state commit, ref update
  }

  async write(req: WriteRequest): Promise<WriteResult> {
    const { owner, repo, branch } = this.opts;
    const cost = ApiWriter.requestCost(req);
    this.reserve(cost);
    const head = await this.headSha();
    if (head !== req.expectedHead) throw new ConflictError();
    const base = await this.json<{ tree: { sha: string } }>(
      "GET",
      `/repos/${owner}/${repo}/git/commits/${head}`,
    );
    let parent = head;
    const nowIso = new Date(this.opts.now()).toISOString();
    for (const batch of req.batches) {
      for (const message of batchMessages(batch)) {
        const c = await this.mutate<{ sha: string }>("POST", `/repos/${owner}/${repo}/git/commits`, {
          message,
          tree: base.tree.sha, // same tree as the parent: an empty commit
          parents: [parent],
          author: { ...req.pieceAuthor, date: commitTimestamp(batch.date) },
          committer: { ...req.pieceAuthor, date: nowIso },
        });
        parent = c.sha;
      }
    }
    const tree = await this.mutate<{ sha: string }>("POST", `/repos/${owner}/${repo}/git/trees`, {
      base_tree: base.tree.sha,
      tree: req.files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
    });
    const stateCommit = await this.mutate<{ sha: string }>("POST", `/repos/${owner}/${repo}/git/commits`, {
      message: req.message,
      tree: tree.sha,
      parents: [parent],
      author: { ...ENGINE_AUTHOR, date: nowIso },
      committer: { ...ENGINE_AUTHOR, date: nowIso },
    });
    try {
      await this.mutate("PATCH", `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
        sha: stateCommit.sha,
        force: false,
      });
    } catch (e) {
      if (e instanceof GitHubApiError && e.status === 422) throw new ConflictError();
      throw e;
    }
    return { head: stateCommit.sha, commits: pieceCommitCount(req.batches) + 1 };
  }

  private reserve(cost: number): void {
    const now = this.opts.now();
    while (this.mutations.length > 0 && this.mutations[0]! < now - 3_600_000) this.mutations.shift();
    if (this.mutations.length + cost > this.opts.hourlyLimit) {
      throw new Error(
        `hourly write budget reached (${this.mutations.length}/${this.opts.hourlyLimit} requests); try again in a few minutes`,
      );
    }
  }

  private async headSha(): Promise<string> {
    const { owner, repo, branch } = this.opts;
    const ref = await this.json<{ object: { sha: string } }>(
      "GET",
      `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    );
    return ref.object.sha;
  }

  private async readFile(path: string, ref: string): Promise<string | null> {
    const { owner, repo } = this.opts;
    try {
      const file = await this.json<{ content: string; encoding: string }>(
        "GET",
        `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      );
      if (file.encoding !== "base64") throw new Error(`unexpected encoding ${file.encoding}`);
      return decodeBase64Utf8(file.content);
    } catch (e) {
      if (e instanceof GitHubApiError && e.status === 404) return null;
      throw e;
    }
  }

  private async mutate<T>(method: string, path: string, body: unknown): Promise<T> {
    const wait = this.lastMutation + this.opts.minIntervalMs - this.opts.now();
    if (wait > 0) await this.opts.sleep(wait);
    this.lastMutation = this.opts.now();
    this.mutations.push(this.lastMutation);
    return this.json<T>(method, path, body);
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.opts.fetch(`${this.opts.apiBase}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.opts.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      let message = `${method} ${path} failed with ${res.status}`;
      try {
        const err = (await res.json()) as { message?: string };
        if (err.message) message += `: ${err.message}`;
      } catch {
        // non-JSON error body
      }
      throw new GitHubApiError(res.status, message);
    }
    return (await res.json()) as T;
  }
}

export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
