/** Dedicated worker running the four-in-a-row AI (solver + opening book). */

import { chooseMove, type Difficulty, Solver } from "@commit-four/core";
import { PERFECT_BOOK } from "@commit-four/core/defaultBook";

const solver = new Solver({ ttLog2Size: 22 });

self.onmessage = (ev: MessageEvent<{ id: number; moves: number[]; difficulty: Difficulty }>) => {
  const { id, moves, difficulty } = ev.data;
  try {
    const choice = chooseMove(moves, { difficulty, solver, book: PERFECT_BOOK });
    self.postMessage({ id, col: choice.col });
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
