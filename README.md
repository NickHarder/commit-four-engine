# Commit Four

Play Connect 4 against an AI where **the board is your real GitHub contribution graph**.

Open your profile, click a column, and your piece drops onto the graph; the AI answers in a second
or two. Every piece is a handful of backdated, empty commits in a dedicated board repo you own:
**4 commits** for your pieces (darkest green) and **2** for the AI's (mid green). Contributions are
a vanity metric anyway; this makes the point with style.

```
 graph column = week, graph row = weekday (Mon top … Sat bottom)

 ·  ·  ·  ·  ·  ·  ·
 ·  ·  ·  ·  ·  ·  ·
 ·  ·  ·  ▒  ·  ·  ·      █ you (4 commits)
 ·  ·  █  █  ·  ·  ·      ▒ AI  (2 commits)
 ·  ▒  ▒  █  ▒  ·  ·
 ·  █  ▒  █  █  ·  ·
```

## How it works

- **Season years.** Boards are drawn in a past year that has no other activity (2016 by default,
  then 2015, …), six boards per year. Your real recent graph keeps its look, and the shading scale
  is fully predictable: GitHub scales each displayed range on its own, so 2 and 4 commits give two
  clearly different greens. (A last-12-months fallback is implemented in `core/calibrate.ts`.)
- **Near real time.** The extension paints moves instantly with a "pending" outline, writes them
  in the background, and polls your graph until GitHub shows them. If GitHub's graph is slow (it
  sometimes lags by hours), the game just keeps going.
- **Two ways to write moves** (pick in the extension settings):
  - **Local helper** (fastest, no token in the browser): `npx commit-four serve` pushes with your
    existing git login, about a second per move.
  - **Browser only**: the extension writes through the GitHub API with a fine-grained token
    limited to the board repo (Contents: read and write), a few seconds per move.
- **AI.** Casual, Hard (8-ply search) or Perfect (opening book plus an exact solver; it never gives
  away a won or drawn position). Connect 4 is solved: if Perfect moves first you can't win.

## Quick start

1. **Create your board repo**: use the board template (`templates/board/`, published as a template
   repo), or run `npx commit-four init <you>/<board-repo> --create` (needs the `gh` CLI).
2. **Install the extension**: `npm run build -w @commit-four/extension`, then load
   `packages/extension/build` unpacked at `chrome://extensions` (Web Store listing pending).
3. **Connect it**: in the extension settings choose *Local helper* (run `npx commit-four serve`,
   paste its pairing token) or *Browser only* (paste a fine-grained token). Template boards get
   claimed with one click.
4. **Play**: open `https://github.com/<you>?tab=overview&from=2016-12-01&to=2016-12-31` and click
   *New game*. No browser? `npx commit-four play` plays in the terminal.
5. `npx commit-four doctor` checks the things that can hide your board, such as a private profile.

## Safety

- Writes only to repos containing a `.commit-four-board` sentinel that names you; template boards
  are claimed once. Never force-pushes; every write is one atomic ref update.
- State commits are authored by `engine@commit-four.invalid` (a reserved TLD) so they never count
  as contributions; only piece commits do.
- Volumes stay tiny (≤ ~130 commits per game), with ≤ 6 writes per minute, because GitHub's abuse
  detection reacts to bursts. Unofficial project; use at your own risk.
- The local helper listens on 127.0.0.1 only, requires the pairing token, accepts only browser
  extension origins (web pages are rejected), and checks the Host header against DNS rebinding.

## Repository layout

| Path | What it is |
|---|---|
| `packages/core` | Rules, bitboard solver and AI, calendar mapping, GitHub's shading formula, render planning, engine, API writer |
| `packages/cli` | `commit-four` CLI: `init`, `serve` (local helper), `play`, `status`, `doctor`, `pair` |
| `packages/extension` | Chrome MV3 extension: board overlay, game panel, settings, offscreen AI worker |
| `templates/board` | Files of the public board template (regenerate with `npx tsx scripts/make-template.ts`) |
| `scripts` | `build-book.ts` (opening book), `bench.ts` (solver benchmark), `make-template.ts` |
| `docs` | `research.md` (how the graph works, with sources), `privacy-policy.md` |

## Development

```sh
npm install
npm run lint && npm run typecheck && npm test   # includes Chromium end-to-end tests when available
npm run build                                   # CLI bundle + extension build
npm run bench                                   # solver speed
npm run build:book                              # regenerate the Perfect opening book (CPU-hours)
```

MIT licensed. Unofficial; not affiliated with GitHub.
