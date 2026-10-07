/**
 * Connect 4 bitboard (7 columns x 6 rows), using the layout popularised by Pascal Pons'
 * "Solving Connect 4" articles: 7 bits per column (6 cells + 1 sentinel), bit = col * 7 + row.
 * This is an independent TypeScript implementation of those ideas.
 *
 * JS bitwise ops are 32-bit, so the 49-bit board is split into two words that never share a
 * column: `lo` holds columns 0-3 (bits 0-27) and `hi` holds columns 4-6 (bits 0-20). Per-column
 * arithmetic (the mask + bottom trick) therefore never carries between words.
 */

export const WIDTH = 7;
export const HEIGHT = 6;
export const CELLS = WIDTH * HEIGHT;
const LO_COLS = 4;
const LO_BITS = 28;
const LO_MASK = 0x0fffffff;
const HI_MASK = 0x001fffff;

/** Center-first exploration order: 3, 2, 4, 1, 5, 0, 6. */
export const COLUMN_ORDER: readonly number[] = [3, 2, 4, 1, 5, 0, 6];

function colWord(col: number): 0 | 1 {
  return col < LO_COLS ? 0 : 1;
}
function colShift(col: number): number {
  return 7 * (col < LO_COLS ? col : col - LO_COLS);
}

const BOTTOM: number[] = [];
const TOP: number[] = [];
const COLUMN: number[] = [];
let BOTTOM_L = 0;
let BOTTOM_H = 0;
let BOARD_L = 0;
let BOARD_H = 0;
for (let c = 0; c < WIDTH; c++) {
  const s = colShift(c);
  BOTTOM[c] = (1 << s) >>> 0;
  TOP[c] = (1 << (s + HEIGHT - 1)) >>> 0;
  COLUMN[c] = (((1 << HEIGHT) - 1) << s) >>> 0;
  if (colWord(c) === 0) {
    BOTTOM_L |= BOTTOM[c]!;
    BOARD_L |= COLUMN[c]!;
  } else {
    BOTTOM_H |= BOTTOM[c]!;
    BOARD_H |= COLUMN[c]!;
  }
}

// 49-bit shifts on a (lo, hi) pair; k is 1..24.
function shlL(l: number, k: number): number {
  return (l << k) & LO_MASK;
}
function shlH(l: number, h: number, k: number): number {
  return ((h << k) | (l >>> (LO_BITS - k))) & HI_MASK;
}
function shrL(l: number, h: number, k: number): number {
  return ((l >>> k) | (h << (LO_BITS - k))) & LO_MASK;
}
function shrH(h: number, k: number): number {
  return h >>> k;
}

export function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

// Scratch outputs, to keep the search loop allocation-free.
let WL = 0;
let WH = 0;

/** Empty cells that would complete four for the stones in (pl, ph). Result in WL/WH. */
function winningCells(pl: number, ph: number, ml: number, mh: number): void {
  // vertical: three stones directly below
  let rl = shlL(pl, 1) & shlL(pl, 2) & shlL(pl, 3);
  let rh = shlH(pl, ph, 1) & shlH(pl, ph, 2) & shlH(pl, ph, 3);
  // horizontal (7) and the two diagonals (6, 8)
  for (let i = 0; i < 3; i++) {
    const s = i === 0 ? 7 : i === 1 ? 6 : 8;
    const s2 = 2 * s;
    const s3 = 3 * s;
    let al = shlL(pl, s) & shlL(pl, s2);
    let ah = shlH(pl, ph, s) & shlH(pl, ph, s2);
    rl |= (al & shlL(pl, s3)) | (al & shrL(pl, ph, s));
    rh |= (ah & shlH(pl, ph, s3)) | (ah & shrH(ph, s));
    al = shrL(pl, ph, s) & shrL(pl, ph, s2);
    ah = shrH(ph, s) & shrH(ph, s2);
    rl |= (al & shlL(pl, s)) | (al & shrL(pl, ph, s3));
    rh |= (ah & shlH(pl, ph, s)) | (ah & shrH(ph, s3));
  }
  WL = (rl & (BOARD_L ^ ml)) >>> 0;
  WH = (rh & (BOARD_H ^ mh)) >>> 0;
}

// Rows 0, 2, 4 (1-based odd rows) favour the first player in zugzwang play; rows 1, 3, 5 the second.
let ODD_ROWS_L = 0;
let ODD_ROWS_H = 0;
for (let c = 0; c < WIDTH; c++) {
  for (let r = 0; r < HEIGHT; r += 2) {
    const bit = (1 << (colShift(c) + r)) >>> 0;
    if (colWord(c) === 0) ODD_ROWS_L |= bit;
    else ODD_ROWS_H |= bit;
  }
}
const CENTER = COLUMN[3]!; // column 3 lives in the lo word
const NEAR_CENTER_L = COLUMN[2]!; // column 2 (lo)
const NEAR_CENTER_H = COLUMN[4]!; // column 4 (hi)

export class Position {
  /** Stones of the player to move. */
  cl = 0;
  ch = 0;
  /** All stones. */
  ml = 0;
  mh = 0;
  moves = 0;

  static fromMoves(moves: readonly number[]): Position {
    const p = new Position();
    let over = false;
    for (const col of moves) {
      if (over) throw new Error(`Move sequence continues after a win at ply ${p.moves}`);
      if (!Number.isInteger(col) || col < 0 || col >= WIDTH || !p.canPlay(col)) {
        throw new Error(`Illegal move ${col} at ply ${p.moves}`);
      }
      over = p.isWinningMove(col);
      p.play(col);
    }
    return p;
  }

  clone(): Position {
    const p = new Position();
    p.cl = this.cl;
    p.ch = this.ch;
    p.ml = this.ml;
    p.mh = this.mh;
    p.moves = this.moves;
    return p;
  }

  canPlay(col: number): boolean {
    const top = TOP[col]!;
    return colWord(col) === 0 ? (this.ml & top) === 0 : (this.mh & top) === 0;
  }

  /** Plays `col` for the side to move (caller checks canPlay). */
  play(col: number): void {
    this.cl ^= this.ml;
    this.ch ^= this.mh;
    if (colWord(col) === 0) this.ml = (this.ml | (this.ml + BOTTOM[col]!)) >>> 0;
    else this.mh = (this.mh | (this.mh + BOTTOM[col]!)) >>> 0;
    this.moves++;
  }

  /** Height of a column (0..6). */
  height(col: number): number {
    const w = colWord(col) === 0 ? this.ml : this.mh;
    return popcount32((w >>> colShift(col)) & 0x3f);
  }

  /** 1 = side to move, 2 = opponent, 0 = empty. */
  cellOwner(col: number, row: number): 0 | 1 | 2 {
    const bit = (1 << (colShift(col) + row)) >>> 0;
    const lo = colWord(col) === 0;
    if (((lo ? this.ml : this.mh) & bit) === 0) return 0;
    return ((lo ? this.cl : this.ch) & bit) !== 0 ? 1 : 2;
  }

  isWinningMove(col: number): boolean {
    winningCells(this.cl, this.ch, this.ml, this.mh);
    const pl = (this.ml + BOTTOM_L) & BOARD_L;
    const ph = (this.mh + BOTTOM_H) & BOARD_H;
    const colMask = COLUMN[col]!;
    return colWord(col) === 0 ? (WL & pl & colMask) !== 0 : (WH & ph & colMask) !== 0;
  }

  canWinNext(): boolean {
    winningCells(this.cl, this.ch, this.ml, this.mh);
    return (WL & (this.ml + BOTTOM_L) & BOARD_L) !== 0 || (WH & (this.mh + BOTTOM_H) & BOARD_H) !== 0;
  }

  /**
   * Bitmask (as a per-column flag set, bit c = column c) of moves that don't hand the opponent an
   * immediate win. 0 means every move loses. Assumes the side to move cannot win immediately.
   */
  nonLosingColumns(): number {
    let pl = (this.ml + BOTTOM_L) & BOARD_L;
    let ph = (this.mh + BOTTOM_H) & BOARD_H;
    winningCells(this.cl ^ this.ml, this.ch ^ this.mh, this.ml, this.mh);
    const ol = WL;
    const oh = WH;
    const fl = pl & ol;
    const fh = ph & oh;
    if (fl !== 0 || fh !== 0) {
      if (popcount32(fl) + popcount32(fh) > 1) return 0;
      pl = fl;
      ph = fh;
    }
    // never play directly below an opponent's winning cell
    pl &= ~shrL(ol, oh, 1);
    ph &= ~shrH(oh, 1);
    let cols = 0;
    for (let c = 0; c < WIDTH; c++) {
      if ((colWord(c) === 0 ? pl : ph) & COLUMN[c]!) cols |= 1 << c;
    }
    return cols;
  }

  /** Number of winning cells the side to move would own after playing `col` (move ordering). */
  moveScore(col: number): number {
    let ml = this.ml;
    let mh = this.mh;
    if (colWord(col) === 0) ml = (ml | (ml + BOTTOM[col]!)) >>> 0;
    else mh = (mh | (mh + BOTTOM[col]!)) >>> 0;
    const pl = (this.cl | (ml ^ this.ml)) >>> 0;
    const ph = (this.ch | (mh ^ this.mh)) >>> 0;
    winningCells(pl, ph, ml, mh);
    return popcount32(WL) + popcount32(WH);
  }

  /**
   * Static evaluation from the side to move's point of view: open threats (weighted by whether
   * they sit on rows that favour their owner in zugzwang play) plus center control.
   */
  evaluate(): number {
    const firstToMove = (this.moves & 1) === 0;
    winningCells(this.cl, this.ch, this.ml, this.mh);
    const myOdd = popcount32(WL & ODD_ROWS_L) + popcount32(WH & ODD_ROWS_H);
    const myAll = popcount32(WL) + popcount32(WH);
    winningCells(this.cl ^ this.ml, this.ch ^ this.mh, this.ml, this.mh);
    const thOdd = popcount32(WL & ODD_ROWS_L) + popcount32(WH & ODD_ROWS_H);
    const thAll = popcount32(WL) + popcount32(WH);
    const myGood = firstToMove ? myOdd : myAll - myOdd;
    const thGood = firstToMove ? thAll - thOdd : thOdd;
    const ol = this.cl ^ this.ml;
    const oh = this.ch ^ this.mh;
    const center =
      3 * (popcount32(this.cl & CENTER) - popcount32(ol & CENTER)) +
      (popcount32(this.cl & NEAR_CENTER_L) - popcount32(ol & NEAR_CENTER_L)) +
      (popcount32(this.ch & NEAR_CENTER_H) - popcount32(oh & NEAR_CENTER_H));
    return 6 * (myAll - thAll) + 10 * (myGood - thGood) + center;
  }

  /** Unique key < 2^49 (position + mask), exact as a JS number. */
  key(): number {
    return ((this.cl + this.ml) >>> 0) + ((this.ch + this.mh) >>> 0) * 2 ** LO_BITS;
  }

  /** Key of the left-right mirrored position. */
  mirrorKey(): number {
    let key = 0;
    for (let c = 0; c < WIDTH; c++) key += this.columnKey(WIDTH - 1 - c) * 2 ** (7 * c);
    return key;
  }

  private columnKey(col: number): number {
    const lo = colWord(col) === 0;
    const v = ((lo ? this.cl : this.ch) + (lo ? this.ml : this.mh)) >>> 0;
    return (v >>> colShift(col)) & 0x7f;
  }

  isFull(): boolean {
    return this.moves >= CELLS;
  }
}

/** "4453" style (1-based) move string <-> 0-based columns. */
export function parseMoves(moves: string): number[] {
  if (!/^[1-7]*$/.test(moves)) throw new Error(`Invalid move string: ${moves}`);
  return [...moves].map((ch) => Number(ch) - 1);
}

export function formatMoves(cols: readonly number[]): string {
  return cols.map((c) => String(c + 1)).join("");
}
