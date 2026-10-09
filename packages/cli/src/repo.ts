/** Working out which GitHub repo we're in, and whether GitHub will count its commits. */

import { git } from "./git";

export interface RepoRef {
  owner: string;
  repo: string;
}

/** Parses https, ssh and scp-style GitHub remote URLs. */
export function parseGitHubRemote(url: string): RepoRef | null {
  const m =
    /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

export async function originRepo(dir = "."): Promise<RepoRef | null> {
  try {
    return parseGitHubRemote(await git(dir, ["remote", "get-url", "origin"]));
  } catch {
    return null;
  }
}

export interface RepoInfo {
  fork: boolean;
  parent?: string;
  private: boolean;
  isTemplate: boolean;
}

/**
 * Public repo metadata from the GitHub API (no token). Returns null when it can't tell (private
 * repo, offline, rate limited) — callers treat that as "unknown", not as an error.
 */
export async function repoInfo(ref: RepoRef, fetchImpl: typeof fetch = fetch): Promise<RepoInfo | null> {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const r = (await res.json()) as {
      fork: boolean;
      private: boolean;
      is_template?: boolean;
      parent?: { full_name: string };
    };
    return {
      fork: r.fork,
      private: r.private,
      isTemplate: r.is_template ?? false,
      ...(r.parent ? { parent: r.parent.full_name } : {}),
    };
  } catch {
    return null;
  }
}

export const FORK_HELP = `GitHub never counts commits in a fork toward your contribution graph, so a fork can't be a board.
Do one of these instead:
  • make a standalone copy: open the original repo on GitHub, click "Use this template", then run
    \`npm run setup\` in a clone of your copy, or
  • keep your fork for the code and give the game its own repo:
    \`commit-four init <you>/commit-four-board --create\` (needs the gh CLI), or create an empty repo
    on github.com and run \`commit-four init <you>/<that-repo>\`.`;
