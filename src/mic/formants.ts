/**
 * The microphone as a formant meter: the newest ~40 ms of a real voice → level, pitch and the first
 * formants (LPC, autocorrelation method). The mic page turns (F1, F2) into the tongue, jaw and lips
 * that would make that vowel (VoiceModel.articForFormants). `analyse` is pure, for tests.
 */

import { glottalFeatures, type GlottalFeatures } from "./glottis.ts";

export interface MicFrame {
  /** RMS level of the whole band, dBFS */
  level: number;
  /** how periodic the sound is, 0…1 (a clear voice is above 0.9, a breathy one lower) */
  clarity: number;
  /** energy above 800 Hz over the total below ~5.5 kHz, dB (a hum through the nose is far down) */
  hiRatio: number;
  /** where a noise sits, Hz, from its zero crossings (s is high, sh lower); for unvoiced sounds */
  noiseHz: number;
  /** a pitched sound is present */
  voiced: boolean;
  /** Hz (0 when unvoiced) */
  f0: number;
  /** resonances found, ascending Hz (empty when unvoiced) */
  formants: number[];
}

const ORDER = 12;

/**
 * How many of the newest samples one frame analyses: 2048 at 44.1 kHz (46 ms) and 48 kHz (43 ms),
 * and as long in time at a lower rate (743 at 16 kHz, a Bluetooth headset's microphone; 1115 at
 * 24 kHz). 2048 samples at 16 kHz would be 128 ms: long enough to smear a vibrato to a third of
 * its swing, and to read the folds 10 points off where they read 6 (measured on the closure sweep).
 */
export const frameLength = (sampleRate: number): number => Math.min(2048, Math.round((sampleRate * 2048) / 44100));
const firs = new Map<number, Float64Array>();

/** windowed-sinc low-pass for decimating by `d` */
function fir(d: number): Float64Array {
  let h = firs.get(d);
  if (h) return h;
  const n = 8 * d + 1, mid = (n - 1) / 2, fc = 0.45 / d;
  h = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const t = i - mid;
    const s = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    h[i] = s * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
    sum += h[i];
  }
  for (let i = 0; i < n; i++) h[i] /= sum;
  firs.set(d, h);
  return h;
}

export function analyse(x: Float32Array, sampleRate: number): MicFrame {
  // to about 11-12 kHz: five formants of a woman's voice fit under the Nyquist
  // the whole band first: a hiss lives above what the formant analysis keeps
  let raw = 0, zc = 0;
  for (let i = 1; i < x.length; i++) {
    raw += x[i] * x[i];
    if (x[i] >= 0 !== x[i - 1] >= 0) zc++;
  }
  const level = 10 * Math.log10(raw / x.length + 1e-12);
  const noiseHz = (zc / 2 / x.length) * sampleRate;
  const none = (voiced: boolean, f0 = 0, clarity = 0, hiRatio = 0): MicFrame => ({ level, voiced, f0, clarity, hiRatio, noiseHz, formants: [] });
  const d = Math.max(1, Math.round(sampleRate / 11025));
  const fs = sampleRate / d;
  const h = fir(d);
  const n = Math.floor((x.length - h.length) / d) + 1;
  if (n < 64 || level < -66) return none(false);
  const y = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0, o = i * d; k < h.length; k++) s += h[k] * x[o + k];
    y[i] = s;
    mean += s;
  }
  mean /= n;
  let e = 0;
  for (let i = 0; i < n; i++) {
    y[i] -= mean;
    e += y[i] * y[i];
  }
  if (e / n < 1e-9) return none(false);
  // share of the energy above 800 Hz (2nd-order high-pass)
  let hiE = 0;
  {
    const w0 = (2 * Math.PI * 800) / fs, c = Math.cos(w0), al = Math.sin(w0) / Math.SQRT2, a0 = 1 + al;
    const b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0, a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
    let z1 = 0, z2 = 0;
    for (let i = 0; i < n; i++) {
      const v = y[i], o = b0 * v + z1;
      z1 = b1 * v - a1 * o + z2;
      z2 = b0 * v - a2 * o;
      hiE += o * o;
    }
  }
  const hiRatio = 10 * Math.log10((hiE + 1e-15) / (e + 1e-15));

  // Pitch: the first strong peak of the normalized autocorrelation, 70-900 Hz. A peak counts
  // only after the correlation has dipped to under half of it: a hiss is still correlated with
  // itself a few samples on, sliding down from 1 with no dip, and that slope is not a pitch.
  const lo = Math.max(2, Math.floor(fs / 900)), hi = Math.min(n - 32, Math.ceil(fs / 70));
  const r = new Float64Array(hi + 2);
  for (let lag = 1; lag <= hi + 1; lag++) {
    let s = 0, a = 0, b = 0;
    for (let i = 0; i + lag < n; i++) {
      s += y[i] * y[i + lag];
      a += y[i] * y[i];
      b += y[i + lag] * y[i + lag];
    }
    r[lag] = a > 0 && b > 0 ? s / Math.sqrt(a * b) : 0;
  }
  const peaks: number[] = [];
  let best = 0;
  for (let lag = 2, dip = r[1]; lag <= hi; lag++) {
    if (lag >= lo && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1] && dip < 0.5 * r[lag]) {
      peaks.push(lag);
      if (r[lag] > best) best = r[lag];
    }
    if (r[lag] < dip) dip = r[lag];
  }
  let f0 = 0;
  if (best >= 0.4) {
    for (const lag of peaks) {
      if (r[lag] >= 0.9 * best) {
        const den = r[lag - 1] - 2 * r[lag] + r[lag + 1];
        f0 = fs / (lag + (den ? (0.5 * (r[lag - 1] - r[lag + 1])) / den : 0));
        break;
      }
    }
  }
  if (!f0) return none(false, 0, best, hiRatio);

  // LPC: pre-emphasis, Hamming window, autocorrelation, Levinson-Durbin
  const w = new Float64Array(n);
  for (let i = n - 1; i > 0; i--) w[i] = (y[i] - 0.97 * y[i - 1]) * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
  w[0] = 0;
  const ac = new Float64Array(ORDER + 1);
  for (let k = 0; k <= ORDER; k++) {
    let s = 0;
    for (let i = 0; i + k < n; i++) s += w[i] * w[i + k];
    ac[k] = s;
  }
  if (ac[0] <= 0) return none(true, f0, best, hiRatio);
  ac[0] *= 1 + 1e-9;
  const a = new Float64Array(ORDER + 1), tmp = new Float64Array(ORDER + 1);
  a[0] = 1;
  let err = ac[0];
  for (let i = 1; i <= ORDER; i++) {
    let acc = ac[i];
    for (let j = 1; j < i; j++) acc += a[j] * ac[i - j];
    const k = -acc / err;
    tmp.set(a);
    for (let j = 1; j < i; j++) a[j] = tmp[j] + k * tmp[i - j];
    a[i] = k;
    err *= 1 - k * k;
    if (!(err > 0)) return none(true, f0, best, hiRatio);
  }

  // roots of z^p + a1 z^(p-1) + … + ap (Durand-Kerner)
  const re = new Float64Array(ORDER), im = new Float64Array(ORDER);
  for (let i = 0; i < ORDER; i++) {
    const ang = (2 * Math.PI * i) / ORDER + 0.4;
    re[i] = 0.9 * Math.cos(ang);
    im[i] = 0.9 * Math.sin(ang);
  }
  for (let it = 0; it < 80; it++) {
    let move = 0;
    for (let i = 0; i < ORDER; i++) {
      // p(z) by Horner
      let pr = 1, pi = 0;
      for (let k = 1; k <= ORDER; k++) {
        const t = pr * re[i] - pi * im[i] + a[k];
        pi = pr * im[i] + pi * re[i];
        pr = t;
      }
      let qr = 1, qi = 0;
      for (let j = 0; j < ORDER; j++) {
        if (j === i) continue;
        const dr = re[i] - re[j], di = im[i] - im[j];
        const t = qr * dr - qi * di;
        qi = qr * di + qi * dr;
        qr = t;
      }
      const q = qr * qr + qi * qi;
      if (q === 0) continue;
      const sr = (pr * qr + pi * qi) / q, si = (pi * qr - pr * qi) / q;
      re[i] -= sr;
      im[i] -= si;
      move += Math.abs(sr) + Math.abs(si);
    }
    if (move < 1e-10) break;
  }
  const formants: number[] = [];
  for (let i = 0; i < ORDER; i++) {
    if (im[i] <= 0) continue;
    const f = (Math.atan2(im[i], re[i]) * fs) / (2 * Math.PI);
    const bw = (-Math.log(Math.hypot(re[i], im[i])) * fs) / Math.PI;
    if (f > 180 && f < fs / 2 - 200 && bw < 700) formants.push(f);
  }
  formants.sort((p, q) => p - q);
  return { level, voiced: true, f0, clarity: best, hiRatio, noiseHz, formants };
}

/** The microphone, analysed on demand (call `read` once per animation frame). */
export class MicListener {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AnalyserNode | null = null;
  private buf = new Float32Array(2048);
  // two thirds of a second, for looking back at how a sound began
  private longNode: AnalyserNode | null = null;
  private longBuf = new Float32Array(32768);
  /** the last frame's glottal features (null when it had no readable vowel) */
  glottal: GlottalFeatures | null = null;

  get running(): boolean {
    return !!this.node;
  }

  /** Ask for the microphone; rejects with the browser's error (NotAllowedError, …). */
  async start(): Promise<void> {
    if (this.node) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("insecure");
    // The context first, here, in the tap that called this: iOS lets audio start only inside a
    // tap, and by the time the permission prompt has been answered the tap is over. A context made
    // after it stays suspended, and the page would listen to silence. resume() is never awaited:
    // where it isn't allowed yet its promise stays pending for good.
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    void ctx.resume().catch(() => {});
    try {
      // a session that records as well as plays (iOS): set before the microphone is asked for
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = "play-and-record";
    } catch {
      // a browser without the switch records anyway
    }
    let stream: MediaStream;
    try {
      // as raw as the device gives it: its speech processing reshapes the spectrum
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    } catch (e) {
      this.ctx = null;
      void ctx.close().catch(() => {});
      throw e;
    }
    this.stream = stream;
    // capturing now, which is itself leave to run: once more
    void ctx.resume().catch(() => {});
    const node = ctx.createAnalyser();
    node.fftSize = 2048;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(node);
    const long = ctx.createAnalyser();
    long.fftSize = 32768;
    src.connect(long);
    // a silent path to the output: some browsers only run the part of a graph that reaches it
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink);
    sink.connect(ctx.destination);
    this.longNode = long;
    this.node = node;
  }

  /** "running" when sound is arriving; "suspended" when the browser is holding the audio back (a tap, then wake()) */
  get state(): string {
    return this.ctx?.state ?? "closed";
  }

  /** a context the page left (or iOS interrupted) resumes */
  wake(): void {
    if (this.ctx && this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.longNode = null;
  }

  /** The last two thirds of a second of sound, oldest first, and its sample rate (null when not running). */
  recent(): { samples: Float32Array; sampleRate: number } | null {
    if (!this.longNode || !this.ctx) return null;
    this.longNode.getFloatTimeDomainData(this.longBuf);
    return { samples: this.longBuf, sampleRate: this.ctx.sampleRate };
  }

  read(): MicFrame | null {
    if (!this.node || !this.ctx) return null;
    this.node.getFloatTimeDomainData(this.buf);
    const sr = this.ctx.sampleRate, x = this.buf.subarray(this.buf.length - frameLength(sr));
    const fr = analyse(x, sr);
    // how the folds close, for a voice with a readable vowel
    this.glottal = fr.voiced && fr.formants.length >= 2 ? glottalFeatures(x, sr, fr.f0, fr.formants) : null;
    return fr;
  }

  /** the sample rate the microphone runs at (0 when not running) */
  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 0;
  }
}
