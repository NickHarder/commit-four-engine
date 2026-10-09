/**
 * The demo video's soundtrack, composed in code: an original 8-bit loop (pulse-wave lead and
 * arpeggios, stepped-triangle bass, noise drums) plus sound effects at given times, rendered to a
 * 48 kHz stereo WAV. No samples, so there is nothing to license.
 */

const RATE = 48_000;
const BEAT = 60 / 140;
const STEP = BEAT / 4; // a 16th note
const BAR = BEAT * 4;
/** The jingle's pickup notes before its downbeat. */
const JINGLE_DOWNBEAT = 2 * STEP;

export type Sfx = "pop" | "bloop" | "tick" | "uhoh" | "womp" | "chime" | "jump" | "whoosh" | "jingle";

export interface Soundtrack {
  /** Length in seconds. */
  secs: number;
  /** When the full arrangement starts (a bar line lands here); before it, only bass, arps and hats. */
  dropAt: number;
  /** When the music stops. A "jingle" later on brings it back, from the top, on its downbeat. */
  musicEnd: number;
  /** Sound effects, in seconds from the start. */
  events: { t: number; sfx: Sfx }[];
}

/** One oscillator sample at `phase` (0..1) advancing `dt` cycles per sample. */
type Wave = (phase: number, dt: number) => number;

interface Voice {
  /** Frequency in Hz, `t` seconds into the note. */
  freq: (t: number) => number;
  wave: Wave;
  gain: number;
  /** -1 left .. 1 right. */
  pan?: number;
  attack?: number;
  release?: number;
  /** Exponential decay time constant, in seconds. */
  decay?: number;
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const fixed = (f: number) => () => f;

/** PolyBLEP correction, so pulse edges don't alias into a harsh buzz. */
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** The NES-style pulse wave, without its DC offset. */
const pulse =
  (duty: number): Wave =>
  (p, dt) =>
    (p < duty ? 1 : -1) + blep(p, dt) - blep((p - duty + 1) % 1, dt) - (2 * duty - 1);

/** The NES triangle: 16 steps. */
const triangle: Wave = (p) => Math.round((p < 0.5 ? 4 * p - 1 : 3 - 4 * p) * 7.5) / 7.5;

let seed = 0x2545f491;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 31 - 1;
};
/** High-passed noise for hats and snares. */
const hiss = (): Wave => {
  let prev = 0;
  return () => {
    const n = rnd();
    const out = (n - prev) / 2;
    prev = n;
    return out;
  };
};
/** Noise through a one-pole low-pass whose cutoff is the voice's frequency. */
const rumble = (): Wave => {
  let y = 0;
  return (_, dt) => {
    y += (1 - Math.exp(-2 * Math.PI * dt)) * (rnd() - y);
    return y * 2.5;
  };
};

class Track {
  readonly l: Float32Array;
  readonly r: Float32Array;
  constructor(secs: number) {
    this.l = new Float32Array(Math.ceil(secs * RATE));
    this.r = new Float32Array(this.l.length);
  }

  add(start: number, dur: number, v: Voice): void {
    const attack = v.attack ?? 0.004;
    const release = v.release ?? 0.03;
    const decay = v.decay ?? Number.POSITIVE_INFINITY;
    const pan = v.pan ?? 0;
    const gl = v.gain * Math.min(1, 1 - pan);
    const gr = v.gain * Math.min(1, 1 + pan);
    const i0 = Math.max(0, Math.ceil(start * RATE));
    const i1 = Math.min(this.l.length, Math.floor((start + dur + release) * RATE));
    let phase = 0;
    for (let i = i0; i < i1; i++) {
      const t = i / RATE - start;
      const dt = v.freq(t) / RATE;
      const env =
        Math.min(1, t / attack) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / release)) * Math.exp(-t / decay);
      const s = v.wave(phase, dt) * env;
      phase = (phase + dt) % 1;
      this.l[i]! += s * gl;
      this.r[i]! += s * gr;
    }
  }
}

// --- the loop: Am F C G at 140 BPM ---------------------------------------------------------------

const CHORDS = [
  { root: 45, arp: [57, 60, 64, 69] }, // Am
  { root: 41, arp: [53, 57, 60, 65] }, // F
  { root: 48, arp: [55, 60, 64, 67] }, // C
  { root: 43, arp: [55, 59, 62, 67] }, // G
];
/** Lead phrases, one list per bar: [16th step, length in 16ths, MIDI note]. */
const PHRASE_A: [number, number, number][][] = [
  [
    [0, 3, 76],
    [3, 1, 74],
    [4, 2, 72],
    [6, 2, 74],
    [8, 4, 76],
    [12, 2, 72],
    [14, 2, 69],
  ],
  [
    [0, 3, 72],
    [3, 1, 74],
    [4, 2, 72],
    [6, 2, 69],
    [8, 6, 65],
    [14, 2, 69],
  ],
  [
    [0, 3, 67],
    [3, 1, 69],
    [4, 2, 72],
    [6, 2, 76],
    [8, 4, 79],
    [12, 2, 76],
    [14, 2, 72],
  ],
  [
    [0, 3, 74],
    [3, 1, 76],
    [4, 2, 74],
    [6, 2, 71],
    [8, 2, 67],
    [10, 2, 71],
    [12, 4, 74],
  ],
];
const PHRASE_B: [number, number, number][][] = [
  [
    [0, 2, 81],
    [2, 2, 79],
    [4, 2, 76],
    [6, 2, 79],
    [8, 4, 81],
    [12, 4, 76],
  ],
  [
    [0, 2, 77],
    [2, 2, 76],
    [4, 2, 72],
    [6, 2, 76],
    [8, 6, 77],
    [14, 2, 76],
  ],
  [
    [0, 2, 76],
    [2, 2, 72],
    [4, 2, 67],
    [6, 2, 72],
    [8, 4, 76],
    [12, 2, 79],
    [14, 2, 76],
  ],
  [
    [0, 4, 74],
    [4, 4, 79],
    [8, 8, 71],
  ],
];

const vibrato = (f: number, after: number) => (t: number) =>
  f * (1 + (t > after ? 0.007 * Math.sin(2 * Math.PI * 5.5 * (t - after)) : 0));

function kick(m: Track, t: number, gain = 0.55): void {
  m.add(t, 0.11, { freq: (x) => 48 + 120 * Math.exp(-x / 0.025), wave: triangle, gain, decay: 0.09 });
}
function snare(m: Track, t: number, gain = 0.3): void {
  m.add(t, 0.1, { freq: fixed(1), wave: hiss(), gain, decay: 0.06 });
  m.add(t, 0.06, { freq: (x) => 200 - 300 * x, wave: triangle, gain: gain * 0.6, decay: 0.04 });
}

/** The loop from `from` to `end`; bars before `dropAt` (a bar line) are the light intro. */
function compose(m: Track, from: number, dropAt: number, end: number): void {
  const intro = Math.ceil((dropAt - from) / BAR);
  const origin = dropAt - intro * BAR;
  for (let bar = 0; origin + bar * BAR < end; bar++) {
    const t0 = origin + bar * BAR;
    const k = bar - intro; // bar of the loop; negative in the intro, which leads into Am
    const loopBar = ((k % 4) + 4) % 4;
    const chord = CHORDS[loopBar]!;
    const full = k >= 0;
    const at = (step: number) => t0 + step * STEP;
    for (let j = 0; j < 8; j++)
      m.add(at(j * 2), STEP * 1.5, {
        freq: fixed(hz(chord.root + (j % 2 ? 12 : 0))),
        wave: triangle,
        gain: 0.34,
        release: 0.02,
      });
    for (let j = 0; j < 16; j++)
      m.add(at(j), STEP * 0.7, {
        freq: fixed(hz(chord.arp[j % 4]! + (full ? 12 : 0))),
        wave: pulse(0.125),
        gain: full ? 0.07 : 0.09,
        pan: -0.35,
        release: 0.02,
      });
    for (let j = 0; j < 16; j += 2)
      m.add(at(j), j % 4 === 2 ? 0.05 : 0.015, {
        freq: fixed(1),
        wave: hiss(),
        gain: j % 4 === 2 ? 0.1 : 0.07,
        pan: 0.3,
        decay: j % 4 === 2 ? 0.04 : 0.015,
      });
    if (!full) continue;
    for (const s of loopBar % 2 ? [0, 8, 10] : [0, 8]) kick(m, at(s));
    for (const s of [4, 12]) snare(m, at(s));
    if (loopBar === 3) for (const s of [13, 14, 15]) snare(m, at(s), 0.2);
    const phrase = (Math.floor(k / 4) % 2 ? PHRASE_B : PHRASE_A)[loopBar]!;
    for (const [step, len, note] of phrase) {
      const lead = { freq: vibrato(hz(note), 0.14), wave: pulse(0.25), release: 0.04 };
      m.add(at(step), len * STEP * 0.85, { ...lead, gain: 0.19, pan: 0.15 });
      m.add(at(step) + 3 * STEP, len * STEP * 0.85, { ...lead, gain: 0.06, pan: -0.4 }); // echo
    }
  }
}

// --- sound effects ---------------------------------------------------------------------------------

const SFX: Record<Sfx, (s: Track, t: number) => void> = {
  // your piece: a rising pop
  pop: (s, t) =>
    s.add(t, 0.05, {
      freq: (x) => 600 * 2 ** Math.min(1, x / 0.06),
      wave: pulse(0.5),
      gain: 0.42,
      release: 0.06,
    }),
  // the AI's piece: a lower, falling bloop
  bloop: (s, t) =>
    s.add(t, 0.08, {
      freq: (x) => 420 * (220 / 420) ** Math.min(1, x / 0.09),
      wave: pulse(0.25),
      gain: 0.42,
      release: 0.08,
    }),
  tick: (s, t) => s.add(t, 0.018, { freq: fixed(1760), wave: pulse(0.5), gain: 0.2, release: 0.015 }),
  uhoh: (s, t) => {
    s.add(t, 0.13, { freq: vibrato(hz(72), 0.06), wave: pulse(0.5), gain: 0.34, attack: 0.01 });
    s.add(t + 0.19, 0.24, {
      freq: (x) => hz(67) * (1 - 0.05 * Math.min(1, Math.max(0, x - 0.1) / 0.15)),
      wave: pulse(0.5),
      gain: 0.34,
      attack: 0.01,
      release: 0.08,
    });
  },
  // the sad trombone
  womp: (s, t) => {
    const notes = [62, 61, 60, 59];
    notes.forEach((n, i) => {
      const last = i === notes.length - 1;
      const dur = last ? 0.95 : 0.26;
      const freq = last
        ? (x: number) =>
            hz(n) *
            (1 - 0.02 * Math.min(1, x / 0.9)) *
            (1 + 0.025 * Math.min(1, x / 0.3) * Math.sin(2 * Math.PI * 6 * x))
        : fixed(hz(n));
      s.add(t + i * 0.32, dur, { freq, wave: pulse(0.25), gain: 0.3, attack: 0.04, release: 0.12 });
      s.add(t + i * 0.32, dur, {
        freq: (x) => freq(x) / 2,
        wave: triangle,
        gain: 0.3,
        attack: 0.04,
        release: 0.12,
      });
    });
  },
  // the title: a quick sparkle with an echo
  chime: (s, t) => {
    for (const [echo, g] of [
      [0, 0.22],
      [0.2, 0.08],
    ] as const)
      [81, 85, 88, 93].forEach((n, i) => {
        s.add(t + echo + i * 0.055, 0.1, {
          freq: fixed(hz(n)),
          wave: pulse(0.125),
          gain: g,
          decay: 0.25,
          release: 0.15,
        });
        s.add(t + echo + i * 0.055, 0.1, {
          freq: fixed(hz(n)),
          wave: triangle,
          gain: g,
          decay: 0.25,
          release: 0.15,
        });
      });
  },
  // the dino joke
  jump: (s, t) =>
    s.add(t, 0.16, {
      freq: (x) => 260 * 2 ** (1.7 * Math.min(1, x / 0.16)),
      wave: pulse(0.5),
      gain: 0.3,
      release: 0.04,
    }),
  // the camera moving
  whoosh: (s, t) =>
    s.add(t, 0.75, {
      freq: (x) => 300 + 2600 * Math.sin((Math.PI * Math.min(x, 0.75)) / 0.75),
      wave: rumble(),
      gain: 0.18,
      attack: 0.3,
      release: 0.25,
      decay: 0.5,
    }),
  // "Can you beat it?"
  jingle: (s, t) => {
    const at = (step: number) => t + step * STEP;
    s.add(at(0), STEP * 0.8, { freq: fixed(hz(76)), wave: pulse(0.25), gain: 0.26 });
    s.add(at(1), STEP * 0.8, { freq: fixed(hz(79)), wave: pulse(0.25), gain: 0.26 });
    // the music comes back in here, from the top
    s.add(at(2), 0.5, {
      freq: vibrato(hz(81), 0.2),
      wave: pulse(0.25),
      gain: 0.22,
      release: 0.2,
      decay: 0.8,
    });
    kick(s, at(2), 0.5);
    s.add(at(2), 0.5, { freq: fixed(1), wave: hiss(), gain: 0.14, decay: 0.35, release: 0.2 });
  },
};

/** The mixed soundtrack as a 16-bit stereo WAV file. */
export function soundtrackWav(track: Soundtrack): Buffer {
  const music = new Track(track.secs);
  const sfx = new Track(track.secs);
  compose(music, 0, track.dropAt, track.musicEnd);
  const jingle = track.events.find((e) => e.sfx === "jingle");
  const reprise = jingle ? jingle.t + JINGLE_DOWNBEAT : Number.POSITIVE_INFINITY;
  if (jingle) compose(music, reprise, reprise, track.secs);
  for (const e of track.events) SFX[e.sfx](sfx, e.t);

  const n = music.l.length;
  const out = [new Float32Array(n), new Float32Array(n)] as const;
  const attack = 1 - Math.exp(-1 / (0.005 * RATE));
  const release = 1 - Math.exp(-1 / (0.2 * RATE));
  let env = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.max(Math.abs(sfx.l[i]!), Math.abs(sfx.r[i]!));
    env += (x > env ? attack : release) * (x - env);
    const t = i / RATE;
    // music ducks under the effects, and cuts off (quickly, not with a click) at musicEnd until
    // the reprise
    const duck =
      (1 - 0.55 * Math.min(1, env / 0.25)) *
      (t >= reprise ? 1 : Math.max(0, Math.min(1, (track.musicEnd + 0.06 - t) / 0.06)));
    const fade = Math.min(1, t / 0.25, (track.secs - t) / 0.45);
    for (const [ch, m, s] of [
      [0, music.l, sfx.l],
      [1, music.r, sfx.r],
    ] as const) {
      // mostly linear: tanh only rounds off the rare peaks where everything lands at once
      const v = Math.tanh((m[i]! * 0.8 * duck + s[i]!) * 0.7) * Math.max(0, fade);
      out[ch][i] = v;
      peak = Math.max(peak, Math.abs(v));
    }
  }
  const gain = peak > 0 ? 0.89 / peak : 1; // -1 dBFS
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(out[0][i]! * gain * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(out[1][i]! * gain * 32767), 46 + i * 4);
  }
  return buf;
}
