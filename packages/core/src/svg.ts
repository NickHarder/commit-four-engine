/** A small SVG of a game for the board repo's README (for spectators who don't have the extension). */

import { parseMoves } from "./board";
import { BOARD_COLS, BOARD_ROWS } from "./calendar";
import { gamePieces } from "./renderPlan";
import { replay } from "./rules";
import type { GameRecord } from "./state";

const COLORS = { empty: "#ebedf0", ai: "#40c463", human: "#216e39", text: "#57606a", win: "#bf8700" };
const CELL = 22;
const GAP = 4;

export function renderBoardSvg(game: GameRecord | null, opts: { title?: string } = {}): string {
  const width = BOARD_COLS * (CELL + GAP) + GAP;
  const boardHeight = BOARD_ROWS * (CELL + GAP) + GAP;
  const height = boardHeight + 44;
  const pieces = game ? gamePieces(game) : [];
  const win = game ? replay(parseMoves(game.moves)).winLine : [];
  const isWin = (col: number, row: number) => win.some((w) => w.col === col && w.row === row);
  const rects: string[] = [];
  for (let col = 0; col < BOARD_COLS; col++) {
    for (let row = 0; row < BOARD_ROWS; row++) {
      const piece = pieces.find((p) => p.col === col && p.row === row);
      const fill = piece ? COLORS[piece.player] : COLORS.empty;
      const x = GAP + col * (CELL + GAP);
      const y = GAP + (BOARD_ROWS - 1 - row) * (CELL + GAP);
      const stroke = isWin(col, row) ? ` stroke="${COLORS.win}" stroke-width="3"` : "";
      rects.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="4" fill="${fill}"${stroke}/>`);
    }
  }
  const status = !game
    ? "No game yet"
    : game.status === "in_progress"
      ? `Game ${game.id} in progress (${game.difficulty})`
      : `Game ${game.id}: ${{ human_won: "you won", ai_won: "AI won", draw: "draw", resigned: "resigned" }[game.status]}`;
  const title = escapeXml(opts.title ?? "Commit Four");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}: ${escapeXml(status)}">`,
    `<title>${title}</title>`,
    ...rects,
    `<text x="${GAP}" y="${boardHeight + 16}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="12" fill="${COLORS.text}">${escapeXml(status)}</text>`,
    `<rect x="${GAP}" y="${boardHeight + 26}" width="10" height="10" rx="2" fill="${COLORS.human}"/>`,
    `<text x="${GAP + 14}" y="${boardHeight + 35}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="11" fill="${COLORS.text}">you</text>`,
    `<rect x="${GAP + 44}" y="${boardHeight + 26}" width="10" height="10" rx="2" fill="${COLORS.ai}"/>`,
    `<text x="${GAP + 58}" y="${boardHeight + 35}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="11" fill="${COLORS.text}">AI</text>`,
    "</svg>",
    "",
  ].join("\n");
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}
