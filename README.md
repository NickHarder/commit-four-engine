# Commit Four

Play Connect 4 against an AI where **the board is your real GitHub contribution graph**.

Click a column on your own profile and your piece lands on the graph; the AI answers instantly.
Each piece is a day square shaded by a few backdated commits in a dedicated "board" repo:
4 commits for your pieces (darkest shade), 2 for the AI's (mid shade).

> Status: in development. See `docs/` for the design and research notes.

## Packages

| Package | What it is |
|---|---|
| `packages/core` | Rules, bitboard AI (Casual / Hard / Perfect), calendar mapping, GitHub's shading formula, render planning |

## Development

```sh
npm install
npm run lint && npm run typecheck && npm test
```

MIT licensed. Unofficial; not affiliated with GitHub.
