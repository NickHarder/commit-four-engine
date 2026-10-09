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

## Play in two minutes (no terminal)

1. **Install the extension**: from the Chrome Web Store (listing pending), or for now download the
   built zip, unzip it, and use `chrome://extensions` → Developer mode → **Load unpacked**.
2. Click the extension's icon → **Sign in with GitHub** → enter the code GitHub shows you. GitHub
   lists your organizations too; you don't need to grant any of them.
3. **Set up my board**: creates a `commit-four-board` repo for you (or reuses/claims one).
4. **Open your board and play**: click a column on your 2016 graph, then **New game**.

Signing in grants access to your public repositories (GitHub's narrowest OAuth option for this);
Commit Four only ever writes to your board repo. Revoke any time at github.com/settings/applications.
Prefer a narrower fine-grained token, or the faster local helper? Both are under **Advanced** in the
extension settings.

## Make your own copy of the code

You need Node 22+, git, and Chrome.

1. **Copy the repo**: on GitHub click **Use this template** → **Create a new repository** (public).
   Your copy holds the code *and* becomes your board.
2. **Set it up**, in a clone of your copy:
   ```sh
   git clone https://github.com/<you>/<your-copy> && cd <your-copy>
   npm install
   npm run setup     # builds everything and claims this repo as your board
   npm run serve     # local helper; prints a pairing token
   ```
3. **Load the extension**: `chrome://extensions` → Developer mode → **Load unpacked** →
   `packages/extension/build`. In its settings choose *Local helper* and paste the pairing token.
4. **Play**: open `https://github.com/<you>?tab=overview&from=2016-12-01&to=2016-12-31` and click
   **New game**. No browser? `npm run play` plays in the terminal.

`npm run doctor` checks the things that can hide your board, such as a private profile.

### Why "Use this template" and not Fork?

**GitHub never counts commits made in a fork toward your contribution graph** (that's GitHub's rule,
not ours), so a fork can't be a board. "Use this template" gives you the same copy of the code as a
standalone repo, and its commits count. If you already forked, keep the fork for the code and give the
game its own empty repo: `node packages/cli/dist/cli.js init <you>/commit-four-board --create`
(or create the empty repo on github.com and drop `--create`). Both `setup` and the extension detect
forks and say so.

### Browser only (no terminal)

Instead of `npm run serve`, pick *Browser only* in the extension settings and paste a
[fine-grained token](https://github.com/settings/personal-access-tokens/new) limited to your copy with
**Contents: Read and write**. A copy that hasn't been set up gets a one-click **Claim this board** button.

## Safety

- Writes only to repos containing a `.commit-four-board` sentinel that names you; template copies
  are claimed once, and only the sentinel and `state/` files are written (your code is untouched).
  Never force-pushes; every write is one atomic ref update.
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
| `.commit-four-board`, `state/` | Unclaimed board files: a "Use this template" copy becomes its owner's board (the original can't be claimed) |
| `templates/board` | Contents of a dedicated board repo (regenerate both with `npx tsx scripts/make-template.ts`) |
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
