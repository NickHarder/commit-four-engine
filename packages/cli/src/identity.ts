/** Commit identity for piece commits: the owner's GitHub noreply address always counts as theirs. */

import { assertLogin, type Identity } from "@commit-four/core";

export function noreplyEmail(id: number, login: string): string {
  return `${id}+${login}@users.noreply.github.com`;
}

export async function resolveIdentity(
  login: string,
  opts: { email?: string; name?: string } = {},
): Promise<Identity> {
  assertLogin(login);
  if (opts.email) return { name: opts.name ?? login, email: opts.email };
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`could not look up ${login} on GitHub (${res.status}); pass --email instead`);
  const user = (await res.json()) as { id: number; login: string; name: string | null };
  return { name: opts.name ?? user.name ?? user.login, email: noreplyEmail(user.id, user.login) };
}
