/**
 * Builds the Perfect-level opening book: the AI's move for every early position it can reach
 * when it follows its own (deterministic) perfect policy, for both "human first" and "AI first".
 *
 * Usage (from the repo root): npm run build:book [-- --human-first-max 7 --ai-first-max 6 --workers 4]
 * The script is bundled with esbuild first so worker threads run plain JS.
 * Output: packages/core/src/book/perfect-book.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { perfectMove } from "../packages/core/src/ai";
import { Position, WIDTH } from "../packages/core/src/board";
import { canonicalEntry } from "../packages/core/src/book";
import { Solver } from "../packages/core/src/solver";

export const BOOK_POLICY = "perfect-v1";
const OUT = resolve(process.cwd(), "packages/core/src/book/perfect-book.json");

if (!isMainThread) {
  const solver = new Solver({ ttLog2Size: 23 });
  parentPort!.on("message", (moves: number[]) => {
    const pos = Position.fromMoves(moves);
    const t0 = performance.now();
    const { col, outcome } = perfectMove(pos, solver);
    parentPort!.postMessage({ moves, col, outcome, ms: performance.now() - t0 });
  });
} else {
  await main();
}

async function main(): Promise<void> {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2)
    args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
  const humanFirstMax = Number(args.get("human-first-max") ?? 7);
  const aiFirstMax = Number(args.get("ai-first-max") ?? 6);
  const workerCount = Number(args.get("workers") ?? availableParallelism());

  const workers = Array.from({ length: workerCount }, () => new Worker(fileURLToPath(import.meta.url)));
  const entries = new Map<number, number>();
  const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

  // Theory (Allen/Allis 1988): the first player wins only by opening in the center.
  const empty = new Position();
  entries.set(...canonicalEntry(empty, 3));

  for (const humanFirst of [true, false]) {
    const maxStones = humanFirst ? humanFirstMax : aiFirstMax;
    // frontier: positions with the human to move
    let frontier: number[][] = humanFirst ? [[]] : [[3]];
    while (frontier.length > 0) {
      const aiToMove = new Map<number, number[]>();
      for (const moves of frontier) {
        const p = Position.fromMoves(moves);
        for (let c = 0; c < WIDTH; c++) {
          if (!p.canPlay(c) || p.isWinningMove(c)) continue;
          const child = [...moves, c];
          if (child.length > maxStones) continue;
          const cp = Position.fromMoves(child);
          const key = Math.min(cp.key(), cp.mirrorKey());
          if (!entries.has(key) && !aiToMove.has(key)) aiToMove.set(key, child);
        }
      }
      if (aiToMove.size === 0) break;
      const stones = [...aiToMove.values()][0]!.length;
      log(
        `${humanFirst ? "human-first" : "ai-first"}: solving ${aiToMove.size} positions with ${stones} stones`,
      );
      const results = await solveAll([...aiToMove.values()], workers, log);
      const next: number[][] = [];
      for (const r of results) {
        const pos = Position.fromMoves(r.moves);
        entries.set(...canonicalEntry(pos, r.col));
        if (!pos.isWinningMove(r.col)) next.push([...r.moves, r.col]);
      }
      writeBook(entries);
      frontier = next;
    }
  }
  await Promise.all(workers.map((w) => w.terminate()));
  log(`done: ${entries.size} entries -> ${OUT}`);
}

async function solveAll(
  jobs: number[][],
  workers: Worker[],
  log: (m: string) => void,
): Promise<{ moves: number[]; col: number; outcome: string; ms: number }[]> {
  const results: { moves: number[]; col: number; outcome: string; ms: number }[] = [];
  let next = 0;
  await Promise.all(
    workers.map(
      (w) =>
        new Promise<void>((resolveWorker, reject) => {
          const feed = () => {
            if (next >= jobs.length) return resolveWorker();
            w.postMessage(jobs[next++]);
          };
          w.on("message", (r) => {
            results.push(r);
            if (results.length % 25 === 0 || r.ms > 30_000) {
              log(
                `  ${results.length}/${jobs.length} (last ${r.moves.map((c: number) => c + 1).join("")} -> ${r.col + 1}, ${r.outcome}, ${(r.ms / 1000).toFixed(1)}s)`,
              );
            }
            feed();
          });
          w.on("error", reject);
          feed();
        }),
    ),
  );
  for (const w of workers) w.removeAllListeners("message");
  return results;
}

function writeBook(entries: Map<number, number>): void {
  mkdirSync(dirname(OUT), { recursive: true });
  const sorted = [...entries.entries()].sort((a, b) => a[0] - b[0]);
  writeFileSync(OUT, `${JSON.stringify({ version: 1, policy: BOOK_POLICY, entries: sorted })}\n`);
}
