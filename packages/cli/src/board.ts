/** Terminal rendering of the board. */

import { BOARD_COLS, BOARD_ROWS, type GameRecord, gamePieces, parseMoves, replay } from "@commit-four/core";

const color = !process.env.NO_COLOR && process.stdout.isTTY;
const paint = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);

export function renderBoard(game: GameRecord): string {
  const pieces = gamePieces(game);
  const win = replay(parseMoves(game.moves)).winLine;
  const lines: string[] = [];
  for (let row = BOARD_ROWS - 1; row >= 0; row--) {
    let line = " ";
    for (let col = 0; col < BOARD_COLS; col++) {
      const p = pieces.find((x) => x.col === col && x.row === row);
      const winning = win.some((w) => w.col === col && w.row === row);
      let cell = color ? paint("90", "·") : ".";
      // you: dark green, AI: light green, winning four: gold (no-color: Y / A, winning four: * )
      if (p?.player === "human")
        cell = color ? paint(winning ? "1;33" : "38;5;28", "●") : winning ? "*" : "Y";
      if (p?.player === "ai") cell = color ? paint(winning ? "1;33" : "38;5;114", "●") : winning ? "*" : "A";
      line += ` ${cell}`;
    }
    lines.push(line);
  }
  lines.push(`  ${Array.from({ length: BOARD_COLS }, (_, i) => i + 1).join(" ")}`);
  return lines.join("\n");
}

export function describeStatus(game: GameRecord): string {
  switch (game.status) {
    case "human_won":
      return "You won! Your four just landed on the graph.";
    case "ai_won":
      return "The AI won this one.";
    case "draw":
      return "Draw — the board is full.";
    case "resigned":
      return "You resigned.";
    default:
      return "";
  }
}
