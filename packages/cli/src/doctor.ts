/** `commit-four doctor`: checks everything that can make a board silently not show up. */

import {
  type BoardState,
  nextPlacement,
  parseContributionCalendar,
  seasonRange,
  targetCounts,
} from "@commit-four/core";
import type { BoardConfig } from "./config";
import { git } from "./git";
import { FORK_HELP, repoInfo } from "./repo";

export interface Check {
  ok: boolean | "warn";
  label: string;
  detail?: string;
}

export async function runDoctor(
  board: BoardConfig,
  state: BoardState | null,
  problems: Check[],
): Promise<Check[]> {
  const checks: Check[] = [...problems];
  try {
    checks.push({ ok: true, label: `git ${(await git(".", ["--version"])).replace(/^git version /, "")}` });
  } catch {
    checks.push({ ok: false, label: "git is not installed" });
  }
  checks.push(
    /@users\.noreply\.github\.com$/.test(board.author.email)
      ? { ok: true, label: `piece commits authored as ${board.author.email}` }
      : {
          ok: "warn",
          label: `piece commits authored as ${board.author.email}`,
          detail: "make sure this email is verified on your GitHub account, or the squares won't count",
        },
  );

  const info = await repoInfo({ owner: board.owner, repo: board.repo });
  if (info?.fork)
    checks.push({ ok: false, label: `${board.owner}/${board.repo} is a fork`, detail: FORK_HELP });
  else if (info?.private) {
    checks.push({
      ok: "warn",
      label: "board repo is private",
      detail: "turn on Settings > Public profile > 'Include private contributions' or the board won't show",
    });
  } else if (info)
    checks.push({ ok: true, label: "board repo is a standalone public repo, so its commits count" });

  // Profile visibility (anonymous view)
  try {
    const res = await fetch(`https://github.com/${encodeURIComponent(board.owner)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const html = await res.text();
    checks.push(
      /activity is private/i.test(html)
        ? {
            ok: "warn",
            label: "your profile activity is private",
            detail:
              "only you can see the board. Untick 'Make profile private and hide activity' in Settings > Public profile to show it",
          }
        : { ok: true, label: "profile activity is public" },
    );
  } catch (e) {
    checks.push({
      ok: "warn",
      label: "couldn't reach github.com to check profile visibility",
      detail: String(e),
    });
  }

  // Season years must have no activity except ours
  const seasons = new Set<number>();
  for (const g of state?.games ?? []) if (g.placement.season) seasons.add(g.placement.season);
  if (state) seasons.add(nextPlacement(state).season!);
  const targets = state ? targetCounts(state) : new Map<string, number>();
  for (const season of seasons) {
    const { from, to } = seasonRange(season);
    try {
      const res = await fetch(
        `https://github.com/users/${encodeURIComponent(board.owner)}/contributions?from=${from}&to=${to}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      const cal = parseContributionCalendar(await res.text());
      const foreign = cal.days.filter((d) => d.count > (targets.get(d.date) ?? 0));
      const missing = cal.days.filter((d) => d.count >= 0 && d.count < (targets.get(d.date) ?? 0));
      if (foreign.length > 0) {
        checks.push({
          ok: false,
          label: `${season} has other activity on ${foreign.length} day(s) (e.g. ${foreign[0]!.date})`,
          detail: "that changes the shading scale; pick an empty season with --season",
        });
      } else if (missing.length > 0) {
        checks.push({
          ok: "warn",
          label: `${season}: ${missing.length} square(s) not showing yet`,
          detail:
            "GitHub can take a while to process pushes, or the profile/private-contributions settings hide them",
        });
      } else {
        checks.push({ ok: true, label: `${season} season looks right on your public graph` });
      }
    } catch (e) {
      checks.push({ ok: "warn", label: `couldn't read your ${season} graph`, detail: String(e) });
    }
  }
  return checks;
}

export function printChecks(checks: Check[]): boolean {
  let ok = true;
  for (const c of checks) {
    const mark = c.ok === true ? "✓" : c.ok === "warn" ? "!" : "✗";
    if (c.ok === false) ok = false;
    console.log(`${mark} ${c.label}${c.detail ? `\n    ${c.detail}` : ""}`);
  }
  return ok;
}
