/**
 * Register breaks (换声点), heard on one glide from low to high: where the voice changes suddenly
 * as the pitch rises, instead of drifting with it. Two things give a break away:
 *
 * - the pitch leaping (a crack, a flip into the upper register): a step of 1.5–7 semitones within
 *   0.1 s, beyond the glide's own speed, that stays (an octave misread, or one frame, is not one);
 * - the folds' closure stepping (src/mic/glottis.ts): the median of 0.3 s after against 0.3 s
 *   before, less the glide's trend (read from the 0.3 s beyond each), by 8 points or more, and
 *   by 6 or more before and after taken plainly (the trend's correction alone makes an echo 0.3 s
 *   either side of a real step). A change spread over half a second reads a quarter of its size,
 *   so a blended voice that thins gradually is not marked. Not within half a semitone of the
 *   glide's ends, where it turns into a held note and the trend bends.
 *
 * How loud the voice is changes at a break too, but also as a harmonic crosses a resonance, so it
 * is only reported where one of the two above found a break. Brightness is left out: on a glide,
 * the few harmonics in 2–4 kHz step it every time one crosses 2 kHz.
 * Pure, for tests.
 */

export interface GlidePoint {
  /** s */
  t: number;
  midi: number;
  /** % of the cycle closed, when read */
  closed: number | null;
  /** dBFS */
  db: number;
}

/** One glide: frames with a clear pitch, until a pause after it. */
export class GlideRecorder {
  points: GlidePoint[] = [];
  /** the glide is over: 1.5 s or more of it, then 0.7 s without a clear pitch (or 20 s in all) */
  done = false;
  private quietSince: number | null = null;

  /** `now` ms; `f0` Hz, or 0 when no clear pitch sounds; the frame's closure (%) and level (dB) */
  feed(now: number, f0: number, closed: number | null, db: number): void {
    if (this.done) return;
    const p = this.points;
    if (f0 > 0) {
      this.quietSince = null;
      p.push({ t: now / 1000, midi: 69 + 12 * Math.log2(f0 / 440), closed, db });
      if (this.span >= 20) this.done = true;
      return;
    }
    if (!p.length) return;
    this.quietSince ??= now;
    if (now - this.quietSince < 700) return;
    // a false start (a breath, a try) is forgotten; a glide that long is finished
    if (this.span >= 1.5) this.done = true;
    else this.points = [];
    this.quietSince = null;
  }

  /** s from the first frame to the last */
  get span(): number {
    const p = this.points;
    return p.length ? p[p.length - 1].t - p[0].t : 0;
  }
}

export interface Break {
  /** s into the glide, and the note (MIDI) just before it */
  t: number;
  midi: number;
  /** the leap, semitones (up positive), when the pitch leapt */
  jump: number | null;
  /** the closure before and after, %, when read */
  closed: [number, number] | null;
  /** how much louder after, dB, when it changed by 3 dB or more */
  db: number | null;
}

export interface Glide {
  /** the lowest and highest notes (MIDI, the 5th and 95th percentiles) */
  lo: number;
  hi: number;
  /** semitones a second, between a semitone above the lowest and one below the highest */
  speed: number;
  breaks: Break[];
  /** for drawing, smoothed over 0.15 s: one entry per frame */
  trace: { t: number; midi: number; closed: number | null; db: number }[];
}

const median = (a: number[]) => {
  const s = [...a].sort((p, q) => p - q);
  return s.length ? s[s.length >> 1] : NaN;
};

/** the closure step that marks a break, points (detrended), and taken plainly */
export const CLOSURE_STEP = 8;
const CLOSURE_PLAIN = 6;
/** a leap that marks one, semitones (and the largest that isn't an octave misread) */
export const JUMP_MIN = 1.5;
const JUMP_MAX = 7;
/** the step windows, s */
const W = 0.3;
/**
 * The notes (MIDI) the closure's fit was checked on (glottis_sweep: 175–554 Hz for a woman,
 * 98–311 Hz for a man). Beyond them it is a guess, and on a smooth glide it leaps by up to 20
 * points where a harmonic crosses a formant (a man's /ɑ/ at G4): there only a leap marks a break.
 */
export const CLOSURE_NOTES = { female: [53, 73], male: [43, 63] } as const;

/**
 * The detrended step of `v` at each frame: (after − before) less the trend, where after/before
 * are medians over W either side and the trend comes from the windows beyond them. Null where a
 * window has fewer than 3 readings.
 */
export function steps(t: number[], v: (number | null)[]): (number | null)[] {
  const win = (a: number, b: number) => {
    const xs: number[] = [];
    for (let k = 0; k < t.length; k++) if (t[k] >= a && t[k] < b && v[k] !== null) xs.push(v[k]!);
    return xs.length >= 3 ? median(xs) : null;
  };
  return t.map((T) => {
    const a2 = win(T - 2 * W, T - W), a = win(T - W, T), b = win(T, T + W), b2 = win(T + W, T + 2 * W);
    if (a2 === null || a === null || b === null || b2 === null) return null;
    return b - a - (b2 - b + (a - a2)) / 2;
  });
}

/**
 * A microphone slower than this (a Bluetooth headset's, 16 kHz) reads the closure too coarsely to
 * find its steps (on the engine's glides it missed 7 of 24 and made 2 up): only leaps count then.
 */
export const CLOSURE_MIN_RATE = 32000;

/**
 * The glide's breaks, from its frames (a GlideRecorder's points), for a woman's or a man's voice,
 * heard at `sampleRate`.
 */
export function findBreaks(points: GlidePoint[], voice: "female" | "male", sampleRate: number): Glide | null {
  if (points.length < 10) return null;
  const t = points.map((p) => p.t);
  // the pitch, a frame misread on its own taken out (the middle of three)
  const m = points.map((p, k) => (k === 0 || k === points.length - 1 ? p.midi : median([points[k - 1].midi, p.midi, points[k + 1].midi])));
  const sorted = [...m].sort((p, q) => p - q);
  const lo = sorted[Math.floor(sorted.length * 0.05)], hi = sorted[Math.floor(sorted.length * 0.95)];
  const tA = t[m.findIndex((x) => x >= lo + 1)], tB = t[m.findIndex((x) => x >= hi - 1)];
  const speed = hi - lo > 2 && tB > tA ? (hi - lo - 2) / (tB - tA) : 0;

  // ---- leaps
  const slope = (k: number) => (m[k + 1] - m[k]) / Math.max(1e-3, t[k + 1] - t[k]);
  const jumps: { t: number; k: number; from: number; jump: number }[] = [];
  for (let i = 0; i < m.length - 1; i++) {
    let j = i + 1;
    while (j < m.length - 1 && t[j] < t[i] + 0.1) j++;
    if (t[j] - t[i] > 0.2) continue;
    // the glide's own speed around it: the median frame-to-frame slope within 0.5 s
    const near: number[] = [];
    for (let k = 0; k < m.length - 1; k++) if (t[k] >= t[i] - 0.5 && t[k] <= t[j] + 0.5 && t[k + 1] - t[k] < 0.2) near.push(slope(k));
    const r = near.length ? median(near) : 0;
    const excess = m[j] - m[i] - r * (t[j] - t[i]);
    if (Math.abs(excess) < JUMP_MIN) continue;
    // and it stays: 0.25 s either side, the glide's trend taken off
    const level = (a: number, b: number) => {
      const xs: number[] = [];
      for (let k = 0; k < m.length; k++) if (t[k] >= a && t[k] <= b) xs.push(m[k] - r * t[k]);
      return xs.length >= 2 ? median(xs) : null;
    };
    const before = level(t[i] - 0.25, t[i]), after = level(t[j], t[j] + 0.25);
    if (before === null || after === null) continue;
    const jump = after - before;
    if (Math.abs(jump) < JUMP_MIN || Math.abs(jump) > JUMP_MAX || Math.sign(jump) !== Math.sign(excess)) continue;
    // where: the steepest frame of it; from what note: the glide before it, carried on to there
    let at = i;
    for (let k = i; k < j; k++) if (Math.abs(slope(k) - r) > Math.abs(slope(at) - r)) at = k;
    const found = { t: t[at], k: at, from: before + r * t[at], jump };
    // not where the glide turns into its last held note (or out of its first): the pitch sags or
    // overshoots there (a 1.6-semitone dip read at the top of a smooth glide at 16 kHz)
    if (found.from < lo + 0.75 || found.from > hi - 0.75) continue;
    const last = jumps[jumps.length - 1];
    if (last && t[at] - last.t < 0.35) {
      if (Math.abs(jump) > Math.abs(last.jump)) jumps[jumps.length - 1] = found;
    } else jumps.push(found);
  }

  // the medians of a reading just before and just after a frame
  const around = (k: number, of: (p: GlidePoint) => number | null) => {
    const pick = (a: number, b: number) => median(points.filter((p) => p.t >= a && p.t < b && of(p) !== null).map((p) => of(p)!));
    const b = pick(t[k] - W, t[k]), a = pick(t[k] + 0.05, t[k] + W + 0.05);
    return Number.isNaN(a) || Number.isNaN(b) ? null : ([b, a] as [number, number]);
  };

  // ---- steps in the closure
  const [cLo, cHi] = CLOSURE_NOTES[voice];
  const sc = steps(t, points.map((p) => p.closed));
  // which way the glide goes at a frame: the median slope within 0.4 s, semitones a second
  const rateAt = (k: number) => {
    const xs: number[] = [];
    for (let q = 0; q < m.length - 1; q++) if (Math.abs(t[q] - t[k]) <= 0.4 && t[q + 1] - t[q] < 0.2) xs.push(slope(q));
    return xs.length ? median(xs) : 0;
  };
  const closureAt: { t: number; k: number; s: number }[] = [];
  for (let k = 1; k < sc.length && sampleRate >= CLOSURE_MIN_RATE; k++) {
    const s = sc[k];
    if (s === null || Math.abs(s) < CLOSURE_STEP || m[k] < Math.max(lo + 0.5, cLo) || m[k] > Math.min(hi - 0.5, cHi)) continue;
    const plain = around(k, (p) => p.closed);
    if (!plain || Math.abs(plain[1] - plain[0]) < CLOSURE_PLAIN || Math.sign(plain[1] - plain[0]) !== Math.sign(s)) continue;
    // up into a lighter register the folds close less, down into a heavier one more: a step the
    // other way (2 of the 4 the engine's smooth glides gave at 20–30 frames a second) is the
    // estimate's, not the voice's; and a held note is not a glide
    const r = rateAt(k);
    if (Math.abs(r) < 1 || Math.sign(s) !== -Math.sign(r)) continue;
    const last = closureAt[closureAt.length - 1];
    // one step reads over a few frames: keep its largest
    if (last && t[k] - last.t < 0.35) {
      if (Math.abs(s) > Math.abs(last.s)) closureAt[closureAt.length - 1] = { t: t[k], k, s };
    } else closureAt.push({ t: t[k], k, s });
  }
  // Where exactly: the medians either side of a step change together over a third of a second
  // (each flips once half its window has passed it), so the largest step only says roughly. The
  // split of the readings within 0.45 s into two that each sit closest to their own median (L1)
  // says where: frame `c` is the first after it.
  const split = (k: number) => {
    const idx: number[] = [];
    for (let q = 0; q < points.length; q++) if (Math.abs(t[q] - t[k]) <= 0.45 && points[q].closed !== null) idx.push(q);
    const v = idx.map((q) => points[q].closed!);
    const cost = (a: number[]) => {
      const md = median(a);
      return a.reduce((s, x) => s + Math.abs(x - md), 0);
    };
    let best = k, bc = Infinity;
    for (let c = 3; c <= v.length - 3; c++) {
      const e = cost(v.slice(0, c)) + cost(v.slice(c));
      if (e < bc - 1e-9 || (Math.abs(e - bc) <= 1e-9 && Math.abs(idx[c] - k) < Math.abs(best - k))) [best, bc] = [idx[c], e];
    }
    return Math.max(1, best);
  };
  for (const c of closureAt) {
    c.k = split(c.k);
    c.t = t[c.k];
  }

  // the level's change at a break, when it is one both ways of reading it
  const sdb = steps(t, points.map((p) => p.db));
  const dbAt = (k: number) => {
    let best: number | null = null;
    for (let q = 0; q < sdb.length; q++) if (Math.abs(t[q] - t[k]) <= 0.1 && sdb[q] !== null && (best === null || Math.abs(sdb[q]!) > Math.abs(best))) best = sdb[q];
    const plain = around(k, (p) => p.db);
    return best !== null && plain && Math.abs(best) >= 3 && Math.abs(plain[1] - plain[0]) >= 3 && Math.sign(plain[1] - plain[0]) === Math.sign(best) ? plain[1] - plain[0] : null;
  };
  const breaks: Break[] = [];
  for (const j of jumps) breaks.push({ t: j.t - t[0], midi: j.from, jump: j.jump, closed: around(j.k, (p) => p.closed), db: dbAt(j.k) });
  // a step read first at frame k happened after frame k − 1: between the two
  for (const c of closureAt) if (!jumps.some((j) => Math.abs(j.t - c.t) < 0.35)) breaks.push({ t: c.t - t[0], midi: (m[c.k - 1] + m[c.k]) / 2, jump: null, closed: around(c.k, (p) => p.closed), db: dbAt(c.k) });
  breaks.sort((a, b) => a.t - b.t);

  // smoothed for drawing
  const smooth = (of: (p: GlidePoint) => number | null) =>
    points.map((p) => {
      const xs = points.filter((q) => Math.abs(q.t - p.t) <= 0.075 && of(q) !== null).map((q) => of(q)!);
      return xs.length ? median(xs) : null;
    });
  const sC = smooth((p) => p.closed), sD = smooth((p) => p.db);
  const trace = points.map((p, k) => ({ t: p.t, midi: m[k], closed: sC[k], db: sD[k] ?? p.db }));
  return { lo, hi, speed, breaks, trace };
}
