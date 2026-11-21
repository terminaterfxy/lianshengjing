/**
 * Rhythm: where each sung syllable lands against a metronome's beats, from a recording of the take.
 *
 * The page plays the clicks and records the microphone on one audio clock (RhythmPage.tsx), so a
 * click scheduled at a frame and a syllable heard at a frame are on the same count. What the clock
 * doesn't know is how long a click takes to leave the speaker and a sound to come back in through
 * the microphone: `findClicks` measures that once (the phone plays clicks and hears itself), and
 * every take is corrected by it.
 *
 * A syllable's time is its vowel's start: where the voice's band (100–900 Hz) rises out of the dip
 * a consonant or a breath leaves, a third of the way up the rise. The clicks are high (2.5–3.5
 * kHz), so a click the microphone hears while she sings lands outside that band and is not taken
 * for a syllable. Vowels sung legato, with no dip between them, have no start to find: the page asks
 * for one "da" a beat.
 * Pure, for tests.
 */
import { analyse, frameLength } from "./formants.ts";

/** the envelope's step, s */
export const HOP = 0.0025;

/** A second-order section (RBJ cookbook), run forward then backward: no delay at any frequency. */
function biquad(x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  x1 = x2 = y1 = y2 = 0;
  for (let i = x.length - 1; i >= 0; i--) {
    const u = y[i];
    const v = b0 * u + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = u;
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}
function lowpass(x: Float32Array, sr: number, f: number): Float32Array {
  const w = (2 * Math.PI * f) / sr, c = Math.cos(w), al = Math.sin(w) / Math.SQRT2, a0 = 1 + al;
  return biquad(x, (1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
}
function highpass(x: Float32Array, sr: number, f: number): Float32Array {
  const w = (2 * Math.PI * f) / sr, c = Math.cos(w), al = Math.sin(w) / Math.SQRT2, a0 = 1 + al;
  return biquad(x, (1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
}

/** The RMS of `x` in a band, over `win` s (10 ms) centred on every HOP. */
export function bandEnvelope(x: Float32Array, sr: number, lo: number, hi: number, win = 0.01): Float32Array {
  let y = highpass(x, sr, lo);
  y = highpass(y, sr, lo);
  y = lowpass(y, sr, Math.min(hi, 0.45 * sr));
  y = lowpass(y, sr, Math.min(hi, 0.45 * sr));
  const hop = sr * HOP, half = Math.max(1, Math.round((win / 2) * sr)), n = Math.floor(x.length / hop);
  const sq = new Float64Array(y.length + 1);
  for (let i = 0; i < y.length; i++) sq[i + 1] = sq[i] + y[i] * y[i];
  const env = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const c = Math.round(k * hop), a = Math.max(0, c - half), b = Math.min(y.length, c + half);
    env[k] = Math.sqrt(Math.max(0, sq[b] - sq[a]) / Math.max(1, b - a));
  }
  return env;
}

/** where a click is: 2–6 kHz */
const CLICK_LO = 2000, CLICK_HI = 6000;

/**
 * How long a click scheduled at each of `at` (sample indices of the recording) took to come back
 * in: the speaker's and the microphone's delay together, s. Null when too few clicks were heard
 * clearly (too quiet, a noisy room, or headphones on), or they disagree (something else was heard).
 */
export function findClicks(x: Float32Array, sr: number, at: number[], maxDelay = 0.4): { delay: number; spread: number; heard: number } | null {
  // a short window: a long one starts rising before the click does
  const env = bandEnvelope(x, sr, CLICK_LO, CLICK_HI, 0.002);
  const delays: number[] = [];
  for (const s of at) {
    const k0 = Math.round(s / sr / HOP), k1 = Math.min(env.length, k0 + Math.round(maxDelay / HOP));
    if (k0 < 0 || k1 - k0 < 10) continue;
    // the quiet just before (the click can't arrive before it was sent)
    const before = Array.from(env.subarray(Math.max(0, k0 - 20), k0 + 1)).sort((a, b) => a - b);
    const floor = before.length ? before[before.length >> 1] : 0;
    let peak = 0;
    for (let k = k0; k < k1; k++) peak = Math.max(peak, env[k]);
    if (!(peak > 8 * floor + 1e-6)) continue;
    let k = k0;
    while (k < k1 && env[k] < floor + 0.5 * (peak - floor)) k++;
    // between the two envelope points around the crossing
    const lo = env[k - 1] ?? floor, hi = env[k], level = floor + 0.5 * (peak - floor);
    const frac = hi > lo ? (level - lo) / (hi - lo) : 0;
    delays.push((k - 1 + frac) * HOP - s / sr);
  }
  if (delays.length < Math.max(3, at.length * 0.6)) return null;
  delays.sort((a, b) => a - b);
  const delay = delays[delays.length >> 1];
  const spread = delays[Math.floor(delays.length * 0.8)] - delays[Math.floor(delays.length * 0.2)];
  return spread > 0.006 ? null : { delay, spread, heard: delays.length };
}

/**
 * Where on its rise (in amplitude) a vowel is said to start. On synthetic "da"s with attacks of
 * 10–40 ms, a quarter of the way up let a consonant's burst through at 16 kHz (12 ms early); half
 * way read slow attacks 5–11 ms late; a third: within 8.4 ms at 16 and 48 kHz.
 */
const RISE_AT = 0.35;
/** the voice's band, Hz: under the clicks */
const VOICE_LO = 100, VOICE_HI = 900;

/**
 * The start of every syllable sung in `x`, s from its start: a rise of the voice's band of at least
 * 10 dB within 80 ms out of a dip, to within 15 dB of the take's sung level, and voiced just after.
 */
export function findOnsets(x: Float32Array, sr: number): number[] {
  const env = bandEnvelope(x, sr, VOICE_LO, VOICE_HI);
  const db = Float32Array.from(env, (v) => 20 * Math.log10(v + 1e-9));
  // voiced or not, every 10 ms
  const len = frameLength(sr), step = Math.round(0.01 * sr);
  const voiced: boolean[] = [];
  for (let s = 0; s + len <= x.length; s += step) voiced.push(analyse(x.subarray(s, s + len), sr).voiced);
  // a frame covers [s, s + len): centre it
  const voicedAt = (t: number) => {
    const i = Math.round((t * sr - len / 2) / step);
    return i >= 0 && i < voiced.length && voiced[i];
  };
  // the sung level: the loud end of the voiced part
  const loud: number[] = [];
  for (let k = 0; k < db.length; k++) if (voicedAt(k * HOP)) loud.push(db[k]);
  if (loud.length < 20) return [];
  loud.sort((a, b) => a - b);
  const sung = loud[Math.floor(loud.length * 0.9)];
  const RISE = Math.round(0.08 / HOP), out: number[] = [];
  let k = 1, armed = true, top = -Infinity;
  while (k < db.length - RISE) {
    // after a syllable: wait for a dip 8 dB under its top before looking for the next one
    if (!armed) {
      top = Math.max(top, db[k]);
      if (db[k] < top - 8) armed = true;
      k++;
      continue;
    }
    // a local minimum, then a rise of 10 dB within 80 ms to near the sung level
    if (db[k] <= db[k - 1] && db[k] <= db[k + 1]) {
      let peakK = k;
      for (let j = k + 1; j <= k + RISE; j++) if (db[j] > db[peakK]) peakK = j;
      // the rise may go on a little past 80 ms: take its top within 150 ms
      for (let j = peakK + 1; j <= Math.min(db.length - 1, k + Math.round(0.15 / HOP)); j++) if (db[j] > db[peakK]) peakK = j;
      if (db[peakK] - db[k] >= 10 && db[peakK] > sung - 15) {
        // part of the way up, in amplitude
        const level = env[k] + RISE_AT * (env[peakK] - env[k]);
        let j = k;
        while (j < peakK && env[j + 1] < level) j++;
        const frac = env[j + 1] > env[j] ? (level - env[j]) / (env[j + 1] - env[j]) : 0;
        const t = (j + frac) * HOP;
        // voiced within 100 ms: a syllable, not a cough or a click's low tail
        let v = 0;
        for (let q = 0; q <= 10; q++) if (voicedAt(t + q * 0.01)) v++;
        if (v >= 5) {
          out.push(t);
          armed = false;
          top = db[peakK];
          k = peakK;
          continue;
        }
      }
    }
    k++;
  }
  return out;
}

export interface Score {
  /** each beat's offset, ms (late positive), or null when no syllable was sung near it */
  offsets: (number | null)[];
  /** the mean offset (her habit: early or late), ms, and how far each strays from it (SD), ms */
  mean: number | null;
  sd: number | null;
  /** beats with a syllable, and syllables that were near no beat (or a second one on a beat) */
  hit: number;
  extra: number;
}

/**
 * Each onset (s, on the recording) matched to its nearest beat (s), once the round-trip `delay`
 * (s) is taken off: within 40 % of a beat's length either side, the nearest onset of each beat.
 */
export function score(onsets: number[], beats: number[], delay: number): Score {
  const gap = beats.length > 1 ? beats[1] - beats[0] : 1;
  const offsets: (number | null)[] = beats.map(() => null);
  let extra = 0;
  for (const o of onsets) {
    const t = o - delay;
    let best = -1, bd = Infinity;
    beats.forEach((b, i) => {
      if (Math.abs(t - b) < bd) [best, bd] = [i, Math.abs(t - b)];
    });
    if (best < 0 || bd > 0.4 * gap) {
      extra++;
      continue;
    }
    const ms = (t - beats[best]) * 1000, was = offsets[best];
    if (was === null) offsets[best] = ms;
    else {
      extra++;
      if (Math.abs(ms) < Math.abs(was)) offsets[best] = ms;
    }
  }
  const got = offsets.filter((o): o is number => o !== null);
  const mean = got.length ? got.reduce((a, b) => a + b, 0) / got.length : null;
  const sd = got.length >= 2 && mean !== null ? Math.sqrt(got.reduce((a, b) => a + (b - mean) ** 2, 0) / (got.length - 1)) : null;
  return { offsets, mean, sd, hit: got.length, extra };
}
