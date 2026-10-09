/**
 * The few GitHub REST calls the browser flow needs beyond the writer: who am I, does a repo
 * exist, create one. Plus ensureBoard(), which turns "a signed-in user" into "a ready board".
 */

import { GameEngine } from "./engine";
import { DEFAULT_SEASON } from "./state";
import { boardFiles, randomBoardId, UNCLAIMED_OWNER } from "./template";
import { ApiWriter, GitHubApiError, type Identity, NO_STORE } from "./writer";

export const DEFAULT_BOARD_REPO = "commit-four-board";

export interface GitHubClientOptions {
  token: string;
  apiBase?: string;
  fetch?: typeof fetch;
}

export interface RepoMeta {
  owner: string;
  name: string;
  defaultBranch: string;
  fork: boolean;
  private: boolean;
  canPush: boolean;
}

export class GitHubClient {
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: GitHubClientOptions) {
    this.apiBase = opts.apiBase ?? "https://api.github.com";
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      ...NO_STORE,
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

  /** The signed-in user, with the noreply identity their piece commits will use. */
  async user(): Promise<{ login: string; id: number; identity: Identity }> {
    const u = await this.request<{ login: string; id: number; name: string | null }>("GET", "/user");
    return {
      login: u.login,
      id: u.id,
      identity: { name: u.name ?? u.login, email: `${u.id}+${u.login}@users.noreply.github.com` },
    };
  }

  async repo(owner: string, name: string): Promise<RepoMeta | null> {
    try {
      const r = await this.request<{
        owner: { login: string };
        name: string;
        default_branch: string;
        fork: boolean;
        private: boolean;
        permissions?: { push?: boolean };
      }>("GET", `/repos/${owner}/${name}`);
      return {
        owner: r.owner.login,
        name: r.name,
        defaultBranch: r.default_branch || "main",
        fork: r.fork,
        private: r.private,
        canPush: r.permissions?.push ?? true,
      };
    } catch (e) {
      if (e instanceof GitHubApiError && e.status === 404) return null;
      throw e;
    }
  }

  async createRepo(name: string): Promise<RepoMeta> {
    const r = await this.request<{
      owner: { login: string };
      name: string;
      default_branch: string;
      private: boolean;
    }>("POST", "/user/repos", {
      name,
      description: "My Commit Four board: Connect 4 played on my contribution graph",
      private: false,
      auto_init: false,
      has_issues: false,
      has_wiki: false,
      has_projects: false,
    });
    return {
      owner: r.owner.login,
      name: r.name,
      defaultBranch: r.default_branch || "main",
      fork: false,
      private: r.private,
      canPush: true,
    };
  }
}

export type BoardSetup =
  | {
      status: "created" | "claimed" | "existing";
      owner: string;
      repo: string;
      branch: string;
      season: number;
    }
  | {
      status: "not-a-board" | "fork" | "someone-else" | "no-access";
      owner: string;
      repo: string;
      message: string;
    };

/**
 * Makes sure `login/repo` is a board owned by `login`: creates and sets it up if it doesn't
 * exist, sets up an empty repo, claims a "Use this template" copy, or reports why it can't.
 * Never writes to a repo that isn't empty and has no Commit Four sentinel.
 */
export async function ensureBoard(opts: {
  token: string;
  login: string;
  author: Identity;
  repo?: string;
  apiBase?: string;
  fetch?: typeof fetch;
}): Promise<BoardSetup> {
  const repo = opts.repo ?? DEFAULT_BOARD_REPO;
  const owner = opts.login;
  const gh = new GitHubClient({
    token: opts.token,
    ...(opts.apiBase ? { apiBase: opts.apiBase } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  let meta = await gh.repo(owner, repo);
  let created = false;
  if (!meta) {
    meta = await gh.createRepo(repo);
    created = true;
  }
  if (meta.fork) {
    return {
      status: "fork",
      owner,
      repo,
      message: `${owner}/${repo} is a fork, and GitHub never counts commits in forks. Pick another name (a new repo will be created) or a "Use this template" copy.`,
    };
  }
  if (!meta.canPush)
    return { status: "no-access", owner, repo, message: `You can't push to ${owner}/${repo}.` };
  const writer = new ApiWriter({
    owner,
    repo,
    token: opts.token,
    branch: meta.defaultBranch,
    ...(opts.apiBase ? { apiBase: opts.apiBase } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const ok = (status: "created" | "claimed" | "existing"): BoardSetup => ({
    status,
    owner,
    repo,
    branch: meta.defaultBranch,
    season: DEFAULT_SEASON,
  });
  if (created || (await writer.isEmpty())) {
    await writer.bootstrap(boardFiles(owner, randomBoardId()), `c4: set up Commit Four board for ${owner}`);
    return ok("created");
  }
  const remote = await writer.readState();
  if (!remote.sentinel) {
    return {
      status: "not-a-board",
      owner,
      repo,
      message: `${owner}/${repo} already exists and isn't a Commit Four board. Pick another name; Commit Four never writes to other repos.`,
    };
  }
  if (remote.sentinel.owner === UNCLAIMED_OWNER) {
    await new GameEngine({ writer, owner, pieceAuthor: opts.author }).claim(`${owner}/${repo}`);
    return ok("claimed");
  }
  if (remote.sentinel.owner.toLowerCase() !== owner.toLowerCase()) {
    return {
      status: "someone-else",
      owner,
      repo,
      message: `${owner}/${repo} is ${remote.sentinel.owner}'s board.`,
    };
  }
  return ok("existing");
}
