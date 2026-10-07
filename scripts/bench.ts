/**
 * Solver benchmark: solve time and node rate for random positions at several depths.
 * Usage: npm run bench [-- --plies 8,10,12,14 --samples 5 --budget 60000]
 */
import { HEIGHT, Position, WIDTH } from "../packages/core/src/board";
import { SearchAborted, Solver } from "../packages/core/src/solver";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i]!.replace(/^--/, "");
  const v = process.argv[i + 1];
  if (v !== undefined && !v.startsWith("--")) {
    args.set(k, v);
    i++;
  } else args.set(k, "");
}
const plies = (args.get("plies") ?? "8,10,12,14,16").split(",").map(Number);
const samples = Number(args.get("samples") ?? 5);
const budget = Number(args.get("budget") ?? 60_000);

let seed = 12345;
const rand = () => {
  seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
  return seed / 2 ** 32;
};

function randomPosition(stones: number): Position {
  for (;;) {
    const p = new Position();
    let ok = true;
    while (p.moves < stones) {
      const legal = [...Array(WIDTH).keys()].filter((c) => p.canPlay(c) && !p.isWinningMove(c));
      if (legal.length === 0 || p.height(0) > HEIGHT) {
        ok = false;
        break;
      }
      p.play(legal[Math.floor(rand() * legal.length)]!);
    }
    if (ok && !p.canWinNext()) return p;
  }
}

for (const ply of plies) {
  const times: number[] = [];
  let nodes = 0;
  let aborted = 0;
  for (let i = 0; i < samples; i++) {
    const solver = new Solver();
    const p = randomPosition(ply);
    const t0 = performance.now();
    try {
      solver.solve(p, { deadline: t0 + budget, weak: args.has("weak") });
      times.push(performance.now() - t0);
      nodes += solver.nodes;
    } catch (e) {
      if (!(e instanceof SearchAborted)) throw e;
      aborted++;
    }
  }
  const total = times.reduce((a, b) => a + b, 0);
  const sorted = [...times].sort((a, b) => a - b);
  console.log(
    `ply ${String(ply).padStart(2)}: mean ${(total / Math.max(1, times.length)).toFixed(0).padStart(7)} ms, ` +
      `max ${(sorted.at(-1) ?? 0).toFixed(0).padStart(7)} ms, ` +
      `${(((nodes / Math.max(1, total)) * 1000) / 1e6).toFixed(2)} M nodes/s, aborted ${aborted}/${samples}`,
  );
}
