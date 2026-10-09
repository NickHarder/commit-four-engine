# Commit Four

Play Connect 4 against an AI where **the board is your real GitHub contribution graph**.

Open your profile, click a column, and your piece drops onto the graph; the AI answers in a second
or two. Every piece is a handful of backdated, empty commits in a dedicated board repo you own:
**4 commits** for your pieces (darkest green) and **2** for the AI's (mid green). Contributions are
a vanity metric anyway; this makes the point with style.

▶ **[Watch the 25-second demo](https://youtu.be/i_M3oNOQUNA)**

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

- **Season years.** Boards are drawn in the newest past year (at least two years back) whose graph
  shows no contributions at all, six boards per year; when a year is full, the next empty one is
  picked the same way. GitHub shades each displayed range on its own, so in a year that holds
  nothing but the game the colors depend only on the game: your squares (4 commits) and the AI's
  (2) come out as two different greens for everyone, thanks to a 14-commit "scale anchor" on Jan 1
  (see `docs/research.md`). If real activity later lands in that year and changes the shades, the
  panel says so. (A last-12-months fallback is implemented in `core/calibrate.ts`.)
- **Start over.** Settings → **Erase all games…** replaces the board repo's history with one fresh
  commit (or `commit-four start-over`). GitHub can take up to a day to drop the old squares; until
  then, new games go in another empty year.
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

1. **Install the extension** from the [Chrome Web Store](https://chromewebstore.google.com/detail/cpbgpflpnknmfncknfehpkhbmfedoikl). (To run your own build
   instead: unzip the built extension and use `chrome://extensions` → Developer mode → **Load unpacked**.)
2. Click the extension's icon → **Sign in with GitHub** → enter the code GitHub shows you. GitHub
   lists your organizations too; you don't need to grant any of them.
3. **Set up my board**: creates a `commit-four-board` repo for you (or reuses/claims one).
4. **Open your board and play**: on your profile, click **New game** in the Commit Four panel. It
   finds an empty year on your graph and opens it; then click a column to move.

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
4. **Play**: open your profile (`https://github.com/<you>`) and click **New game** in the Commit Four
   panel. No browser? `npm run play` plays in the terminal.

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
