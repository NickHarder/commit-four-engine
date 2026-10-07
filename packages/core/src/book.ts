/**
 * Opening book: precomputed AI moves for early positions on the Perfect line, so the AI never
 * has to search the expensive opening. Keys are canonical (min of a position's key and its
 * mirror's key) and the stored column is for the canonical orientation.
 */

import { type Position, WIDTH } from "./board";

export interface BookData {
  version: 1;
  /** Policy the entries were generated with; a mismatch means the book is stale. */
  policy: string;
  /** [canonicalKey, column] pairs. */
  entries: [number, number][];
}

export class OpeningBook {
  private readonly map = new Map<number, number>();

  constructor(readonly data: BookData) {
    if (data.version !== 1) throw new Error(`Unsupported book version ${String(data.version)}`);
    for (const [key, col] of data.entries) this.map.set(key, col);
  }

  get size(): number {
    return this.map.size;
  }

  lookup(pos: Position): number | undefined {
    const key = pos.key();
    const mirror = pos.mirrorKey();
    if (key <= mirror) {
      const col = this.map.get(key);
      return col === undefined ? undefined : col;
    }
    const col = this.map.get(mirror);
    return col === undefined ? undefined : WIDTH - 1 - col;
  }
}

export function canonicalEntry(pos: Position, col: number): [number, number] {
  const key = pos.key();
  const mirror = pos.mirrorKey();
  return key <= mirror ? [key, col] : [mirror, WIDTH - 1 - col];
}
