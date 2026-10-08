# Research notes: how the contribution graph really works

Collected 2026-10-07 while designing Commit Four. These findings replaced several assumptions in
the original blueprint.

## Shading levels

GitHub computes levels over **only the days currently displayed** (the rolling year, or a
calendar year), using quartiles after dropping outliers (GitHub community #23261). The
reverse-engineered model in [akerl/githubstats](https://github.com/akerl/githubstats/blob/main/lib/githubstats/data.rb)
(MIT) is ported in `packages/core/src/levels.ts`:

- mean and sample standard deviation over every displayed day, zeros included
- with ≥ 5 distinct counts, values with |z| > 3.77972616981 are outliers; GitHub ignores the first 1
  (if max − mean < 6 or max < 15) or first 3 of them, in chronological order, when picking `top`
- boundaries are the quartile midpoints of 1..top plus the true max; a day's level is the number
  of boundaries its count exceeds

The model reproduced 103 real calendars (~37.7k days) with zero mismatches, and our port matches a
live 2026 calendar exactly (368 days, 50 distinct counts).

Consequences:

- In a year with no other activity, **2 commits → level 2 and 4 commits → level 4**. {0, 2, 4} is
  the only three-shade set without a near-identical pair across GitHub's nine palettes (per the
  mossaic palette study). A full game costs ≤ ~130 commits.
- The blueprint's 600/450/150 "anchor" scheme gives levels 4/3/1, not 4/4/2; with real activity
  the 600 day is ignored as an outlier, so it anchors nothing.
- A lone 2-commit square would render at level 4 (it would be the max), so each season gets one
  4-commit "scale anchor" on Jan 1.
- Avoid a busiest day of ≤ 3: with top = 2, counts 1 and 2 render as levels 3 and 4.

## What counts, and when

- Placement uses the **author date** (GitHub docs, profile contributions reference). The docs
  disagree on UTC vs the commit's own offset, so every piece is authored at `12:00:00+00:00`.
- Empty commits count (gitfiti and others rely on it). Commits must be on the default branch of a
  non-fork repo, authored with an email linked to the account (the noreply address works).
- No documented cap on commits per push.
- Latency is usually near-instant, but late September 2026 saw multi-hour delays (community
  #209107, #209140, #209186); the docs say "up to 24 hours". No credible source supports the
  "empty trigger commit" trick. → The game never waits on the graph.
- Removal after deleting a repo or force-pushing is slow and year tabs can persist indefinitely
  (#72614, #190268). → Append-only seasons instead of resets.
- Years before an account existed are displayed, and the year list runs continuously from the
  earliest contribution year. Year links use `/<user>?tab=overview&from=YYYY-12-01&to=YYYY-12-31`.
- A private profile ("activity is private") hides the graph from everyone but its owner.

## Platform choice

GitLab records one contribution event per push (dated at push time), so it cannot show per-day
intensity from backdated commits. GitHub only.

## Policy

- GitHub's Acceptable Use Policies (§4) prohibit "automated excessive bulk activity". Graph art has
  existed since 2012 without known enforcement, but an account was auto-suspended in Jan 2026 after
  ~20–25 commits in ~3 minutes (community #183919, restored after 3 days).
- GitHub recommends ≤ 6 pushes per minute per repo; REST content creation is capped at 80/min and
  500/h.
- The Actions terms exclude activity "unrelated to the production, testing, deployment, or
  publication of the software project", which is one reason gameplay doesn't use Actions.
→ One write per turn, ≤ 6 writes/min, ≤ 450 API writes/h, tiny commit counts, clear warnings.

## Engine

Connect 4 was solved in 1988 (Allen; Allis): the first player wins by opening in the center.
Pascal Pons' solver articles describe the bitboard (7 bits per column), negamax with alpha-beta,
transposition table and null-window search used here; his code and opening book are AGPL-3.0, so
Commit Four's engine is an independent implementation of the published ideas, with its own book.

Measured on this implementation (Node 22): ~2.2 M nodes/s; exact solves ≈ 0.05 s at 16 stones,
≈ 2 s at 10 stones; weak (win/draw/loss) solves ≈ 0.35 s at 10 stones and ≈ 0.9 s at 8 stones.

## Live test (2026-10-08, `NickHarder/commit-four-board`)

Board created with `commit-four init`; game 1 started at Hard difficulty; human played column 4 and the AI
answered column 4.

- **Git path (local helper):** setup push at 01:15:12 UTC, then two pushes (game start, then the move) of
  ~1.6 s each, finishing at 01:15:21 UTC.
- **Commits on GitHub:** the 10 piece commits are attributed to the `NickHarder` account (REST
  `author.login`), with author dates `2016-01-01/02-05/02-06T12:00:00Z`, and each has its parent's
  tree (empty). The 3 engine commits (`engine@commit-four.invalid`) are attributed to no account.
- **API path (browser-only writer):** not testable from a Claude Code cloud session: its egress proxy
  refuses Git Data API writes ("Write access to this GitHub API path is not permitted through this
  proxy"). This is a sandbox restriction, not GitHub's; it still needs a check from a normal browser.
- **Graph:** pending the owner's check of the 2016 view (the profile is private, so it can't be read
  from outside).
