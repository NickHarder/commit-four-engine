/** Files that make a repo a Commit Four board. Shared by `commit-four init`, the extension and the template. */

import { type BoardState, initialState, SENTINEL_FILE, STATE_PATH, SVG_PATH } from "./state";
import { renderBoardSvg } from "./svg";
import type { Sentinel } from "./writer";

/** Sentinel owner of a repo created from the public template and not yet claimed. */
export const UNCLAIMED_OWNER = "";

export function sentinelContent(owner: string, boardId: string): string {
  const s: Sentinel = { commitFour: 1, owner, boardId };
  return `${JSON.stringify(s, null, 2)}\n`;
}

export function randomBoardId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function boardReadme(owner: string): string {
  const who = owner || "the owner";
  return `# Commit Four board

This repository is a **game board**, not a project. ${who} plays Connect 4 against an AI on their
GitHub contribution graph, and every piece on the graph is a handful of backdated, empty commits here.

![Current game](board.svg)

| Square | Meaning |
|---|---|
| darkest green (4 commits) | ${who}'s piece |
| mid green (2 commits) | the AI's piece |
| one dark square on Jan 1 | the season's scale anchor |

Games are drawn in past "season" years (2016, then 2015, ...), six boards per year. Open the season
year on the profile to see them. The full move history lives in [\`state/game.json\`](state/game.json).

Made with [Commit Four](https://github.com/NickHarder/commit-four-engine). Unofficial; not affiliated with GitHub.

> Deleting this repo removes the pieces from the graph eventually, but GitHub can keep the year tabs around.
`;
}

export function boardFiles(
  owner: string,
  boardId: string,
  state?: BoardState,
): { path: string; content: string }[] {
  const s = state ?? initialState(owner || "unclaimed-board");
  return [
    { path: SENTINEL_FILE, content: sentinelContent(owner, boardId) },
    { path: STATE_PATH, content: `${JSON.stringify(s, null, 2)}\n` },
    { path: SVG_PATH, content: renderBoardSvg(s.games.at(-1) ?? null) },
    { path: "README.md", content: boardReadme(owner) },
  ];
}
