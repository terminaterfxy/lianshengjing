/**
 * Brightness: the energy of the voice between 2 and 4 kHz (where a trained voice's ring, the
 * singer's formant, sits) over its energy from 100 Hz to 2 kHz, dB, from the power of the last
 * second of a held sound.
 *
 * Checked on the engine (crates/chimera/examples/brightness_sweep.rs; tools/mic-selftest.ts):
 *  - Narrowing the epilarynx fully (the tube just above the folds, which makes the singer's formant)
 *    raises it 4–7 dB; closing the folds more abruptly (a pressed, edgy source) up to 9 dB.
 *  - Through a simulated phone (rooms, noise, a tilted microphone, 16–48 kHz) two takes from the same
 *    spot read the same to a few tenths of a dB, and the epilarynx's change comes through to 0.4 dB.
 *    Moving in the room changes the reading by about 1.5 dB near the phone, 2.5 dB far from it.
 *  - What else moves it, and is not the singer's "brightness": the vowel (about 25 dB from u to ɛ),
 *    the pitch (about 8 dB from A3 to C5), how loud (about 2 dB from soft to loud) and the
 *    microphone. So a reading compares only with her own, same vowel, note, loudness and spot.
 * Pure, for tests.
 */
import { fft } from "./glottis.ts";

/** the bands kept: 100 Hz wide, 0–5 kHz */
export const BAND_HZ = 100, N_BANDS = 50;

const bufs = new Map<number, { re: Float64Array; im: Float64Array; win: Float64Array }>();

/** One frame's power, summed in 100 Hz bands (Hann window; zero above the Nyquist frequency). */
export function bandPowers(x: ArrayLike<number>, sampleRate: number): Float32Array {
  const len = x.length;
  let n = 1;
  while (n < len) n *= 2;
  let b = bufs.get(len);
  if (!b) {
    const win = new Float64Array(len);
    for (let i = 0; i < len; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1));
    b = { re: new Float64Array(n), im: new Float64Array(n), win };
    bufs.set(len, b);
  }
  const { re, im, win } = b;
  re.fill(0);
  im.fill(0);
  for (let i = 0; i < len; i++) re[i] = x[i] * win[i];
  fft(re, im);
  const out = new Float32Array(N_BANDS);
  // per sample of the window, so frames of any length and rate add up alike
  const scale = 1 / len;
  for (let k = 1; k < n / 2; k++) {
    const band = Math.floor((k * sampleRate) / n / BAND_HZ);
    if (band >= N_BANDS) break;
    out[band] += (re[k] * re[k] + im[k] * im[k]) * scale;
  }
  return out;
}

/** 2–4 kHz over 100 Hz–2 kHz, dB (null when there is no energy to compare). */
export function brightnessOf(bands: ArrayLike<number>): number | null {
  let lo = 0, hi = 0;
  for (let i = 1; i < 20; i++) lo += bands[i];
  for (let i = 20; i < 40; i++) hi += bands[i];
  return lo > 0 && hi > 0 ? 10 * Math.log10(hi / lo) : null;
}

/** how long the reading looks back, and how much of a held sound it needs, s */
const WINDOW = 1.0, NEED = 0.5;
/** a break longer than this starts a new sound, s */
const BREAK = 0.3;

/** The brightness of the sound being held: the last second of it, every frame summed. */
export class ToneTracker {
  private frames: { t: number; b: Float32Array }[] = [];
  private lastAt = -1e9;
  private sum = new Float64Array(N_BANDS);
  private dirty = true;

  /** `now` in ms; `bands`: this frame's band powers when it holds a voiced sound, else null. */
  feed(now: number, bands: Float32Array | null): void {
    const t = now / 1000;
    if (!bands) {
      if (t - this.lastAt > BREAK && this.frames.length) {
        this.frames = [];
        this.dirty = true;
      }
      return;
    }
    if (t - this.lastAt > BREAK) this.frames = [];
    this.lastAt = t;
    this.frames.push({ t, b: bands });
    while (this.frames.length && this.frames[0].t < t - WINDOW) this.frames.shift();
    this.dirty = true;
  }

  private summed(): Float64Array | null {
    const f = this.frames;
    if (f.length < 6 || f[f.length - 1].t - f[0].t < NEED) return null;
    if (this.dirty) {
      this.sum.fill(0);
      for (const { b } of f) for (let i = 0; i < N_BANDS; i++) this.sum[i] += b[i];
      this.dirty = false;
    }
    return this.sum;
  }

  /** dB, or null until half a second of a held sound */
  get brightness(): number | null {
    const s = this.summed();
    return s ? brightnessOf(s) : null;
  }

  /** how loud the held sound is, dB (relative: only for comparing two readings), or null as `brightness` */
  get level(): number | null {
    const s = this.summed();
    if (!s) return null;
    let e = 0;
    for (let i = 1; i < N_BANDS; i++) e += s[i];
    return 10 * Math.log10(e / this.frames.length + 1e-20);
  }

  /** the held sound's spectrum: dB per band (relative), or null as `brightness` */
  get spectrum(): Float64Array | null {
    const s = this.summed();
    if (!s) return null;
    const n = this.frames.length, out = new Float64Array(N_BANDS);
    for (let i = 0; i < N_BANDS; i++) out[i] = 10 * Math.log10(s[i] / n + 1e-20);
    return out;
  }
}
