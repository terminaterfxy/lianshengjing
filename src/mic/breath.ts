/**
 * The breath under a note, and how the note starts.
 *
 *  - Steadiness: over one sustained sound, how much its level wanders (the standard deviation, dB)
 *    and where it is heading (dB a second). A supported breath holds the level; one running out
 *    lets it sag or shake.
 *  - Onset: from the first third of a second of the sound, how fast the level rises, whether it
 *    overshoots, and whether breath is heard before the voice. Hard (the folds shut first and
 *    burst open), breathy (air first, then voice) or balanced.
 *
 * Pure, for tests.
 */
export interface Steadiness {
  /** how long the sound has lasted, s */
  seconds: number;
  /** how much the level wanders around its trend, dB (null until there is a second of it) */
  sd: number | null;
  /** trend of the level, dB/s */
  slope: number;
}

/**
 * One breath's level over time: a phrase from its first sound until it has been quiet for a second
 * (0.3 s before the caller calls it quiet, then `gapMs` more), so a short pause or a consonant's
 * closure does not start a new one. The sound's own body only: not its first quarter second
 * (the onset), not its last 0.35 s (the release, and the moment the tracker takes to call it
 * silence), and nothing that has fallen 12 dB under the note (a fade is not unsteadiness).
 */
export class BreathTracker {
  private t: number[] = [];
  private db: number[] = [];
  private start = 0;
  private live = false;
  private raw: { t: number; v: number }[] = [];
  private quietSince = 0;
  /** how long the quiet must last, beyond the caller's own wait, before the sound has ended (ms) */
  gapMs = 700;
  /** the sound in progress, or the last one finished */
  last: Steadiness | null = null;

  /** `now` in ms; `sounding`: a voice is present; `level` in dB. Returns true when a sound has just begun. */
  feed(now: number, sounding: boolean, level: number): boolean {
    let began = false;
    if (sounding && !this.live) {
      this.live = true;
      this.start = now;
      this.t = [];
      this.db = [];
      this.raw = [];
      this.last = null;
      began = true;
      this.quietSince = 0;
    } else if (!sounding && this.live) {
      // A pause is not the end: the phrase goes on if the sound comes back within the gap. (The
      // caller has already waited its own 0.3 s before calling this quiet.)
      if (!this.quietSince) this.quietSince = now;
      if (now - this.quietSince >= this.gapMs) this.live = false;
      return false;
    } else if (sounding) this.quietSince = 0;
    // once it has ended, the reading stays as it was 0.35 s before the sound stopped
    if (!this.live) return began;
    const tNow = (now - this.start) / 1000;
    // the level averaged over a fifth of a second: a vibrato's own pulse (5–7 a second) is not
    // the breath wavering, and is left out; slower wandering stays
    this.raw.push({ t: tNow, v: level });
    while (this.raw.length && this.raw[0].t < tNow - 0.2) this.raw.shift();
    if (tNow >= 0.25) {
      let sum = 0;
      for (const r of this.raw) sum += r.v;
      this.t.push(tNow - 0.1);
      this.db.push(sum / this.raw.length);
      // a very long sound keeps every other point: the cost per frame must not grow without end
      if (this.t.length > 2400) {
        this.t = this.t.filter((_, i) => i % 2 === 0);
        this.db = this.db.filter((_, i) => i % 2 === 0);
      }
    }
    // up to 0.35 s ago
    let n = this.t.length;
    while (n > 0 && this.t[n - 1] > tNow - 0.35) n--;
    if (n < 4) return began;
    const sorted = Array.from(this.db.slice(0, n)).sort((a, b) => a - b);
    const body = sorted[n >> 1] - 12;
    let m = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, end = this.t[0];
    for (let i = 0; i < n; i++) {
      if (this.db[i] < body) continue;
      const x = this.t[i], y = this.db[i];
      m++;
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
      syy += y * y;
      end = x;
    }
    const seconds = end;
    if (m < 4 || end - this.t[0] < 0.75) {
      this.last = { seconds, sd: null, slope: 0 };
      return began;
    }
    const den = m * sxx - sx * sx, slope = den ? (m * sxy - sx * sy) / den : 0;
    // around its own trend: a level that sags evenly is steady, and its slope says it sags
    const varY = syy / m - (sy / m) ** 2, varT = sxx / m - (sx / m) ** 2;
    this.last = { seconds, sd: Math.sqrt(Math.max(0, varY - slope * slope * varT)), slope };
    return began;
  }

  get sounding(): boolean {
    return this.live;
  }

  /** The level of the sound in progress (or the last one) over its own time: seconds, dB. For drawing. */
  get trace(): { t: readonly number[]; db: readonly number[] } {
    return { t: this.t, db: this.db };
  }
}

export type OnsetKind = "hard" | "soft" | "breathy";

export interface Onset {
  kind: OnsetKind;
  /** 10 % → 90 % of the level's rise, ms */
  riseMs: number;
  /** the peak of the first 100 ms over the level that follows, dB */
  overshoot: number;
  /** sound before the voice, ms */
  breathMs: number;
}

/**
 * The onset in `x`: a stretch of audio that holds the silence before a sound and at least
 * 150 ms of the sound itself. Null when no onset is found in it.
 */
export function analyseOnset(x: Float32Array, sampleRate: number, f0: number): Onset | null {
  // The level every 2.5 ms, each over one pitch period: a shorter window would follow the wave
  // itself (a low voice's period is 9 ms), a longer one would blur the rise.
  const B = Math.max(32, Math.round(sampleRate * 0.0025));
  if (!(f0 > 50)) return null;
  const T = Math.min(Math.round(sampleRate / f0), Math.round(sampleRate * 0.02));
  const n = Math.floor((x.length - T) / B);
  if (n < 60) return null;
  const sm = new Float64Array(n);
  let acc = 0;
  for (let k = 0; k < T; k++) acc += x[k] * x[k];
  for (let i = 0, at = 0; i < n; i++) {
    sm[i] = Math.sqrt(Math.max(0, acc) / T);
    for (let k = 0; k < B; k++, at++) acc += x[at + T] * x[at + T] - x[at] * x[at];
  }
  // The level the note settles at straight after its rise: the median of 20–120 ms past the
  // point where it first reaches half its peak and stays. (Not the end of the buffer: a note that
  // fades or swells afterwards would move the marks the rise is measured between, and the answer
  // would depend on when the look back happened.)
  let floor = Infinity, peak = 0;
  for (let i = 0; i < n; i++) {
    if (sm[i] < floor) floor = sm[i];
    if (sm[i] > peak) peak = sm[i];
  }
  if (!(peak > floor * 4)) return null;
  const per = (msec: number) => Math.round(msec / 2.5);
  let half = -1;
  for (let i = 0; i + per(120) < n; i++) {
    if (sm[i] < floor + 0.5 * (peak - floor)) continue;
    let stays = true;
    for (let k = i; k < i + per(40); k++) if (sm[k] < floor + 0.25 * (peak - floor)) stays = false;
    if (stays) {
      half = i;
      break;
    }
  }
  if (half < 0) return null;
  const after = Array.from(sm.subarray(half + per(20), half + per(120))).sort((a, b) => a - b);
  const S = after[after.length >> 1];
  if (!(S > floor * 4)) return null;
  // the rise that leads to the settled sound: back from the first block at 90 % that stays up
  let i90 = -1;
  for (let i = 0; i < n; i++) {
    if (sm[i] < floor + 0.9 * (S - floor)) continue;
    let stays = true;
    for (let k = i; k < Math.min(n, i + 16); k++) if (sm[k] < floor + 0.5 * (S - floor)) stays = false;
    if (stays) {
      i90 = i;
      break;
    }
  }
  if (i90 < 2) return null;
  let i10 = i90;
  while (i10 > 0 && sm[i10 - 1] > floor + 0.1 * (S - floor)) i10--;
  const ms = (blocks: number) => (blocks * B * 1000) / sampleRate;
  let P = 0;
  for (let i = i90; i < Math.min(n, i90 + per(100)); i++) if (sm[i] > P) P = sm[i];
  // Breath before the voice: sound well below the note (but more than a rumble: over 3 % of its
  // level) that runs unbroken into the rise. A note that starts with air has a stretch of it. A
  // glottal attack may click first, but a silence (the closure) parts the click from the voice,
  // so it isn't counted; a note that starts on the voice climbs through the band in milliseconds.
  let first = i10;
  while (first > 0 && sm[first - 1] > 0.03 * S && sm[first - 1] > floor * 3) first--;
  let breathMs = ms(i10 - first);
  // ...unless that stretch dies away toward the voice: then it is a click ringing in the room
  // (breath holds its level or grows into the note), and the folds were shut behind it.
  let tail = false;
  if (i10 - first >= 4) {
    let top = 0, at = first;
    for (let i = first; i < i10; i++) {
      if (sm[i] > top) {
        top = sm[i];
        at = i;
      }
    }
    let low = Infinity;
    for (let i = Math.max(at + 1, i10 - Math.max(2, Math.round((i10 - first) / 3))); i < i10; i++) if (sm[i] < low) low = sm[i];
    if (at - first < (i10 - first) / 2 && low < 0.5 * top && top > 0.25 * S) {
      tail = true;
      breathMs = 0;
    }
  }
  const riseMs = ms(i90 - i10), overshoot = 20 * Math.log10(P / S);
  // A click before the voice, parted from it by a silence: the folds were shut and burst open.
  let burst = tail;
  for (let i = Math.max(0, first - per(150)), dipped = false; i < first && !burst; i++) {
    if (sm[i] > 0.2 * S) {
      for (let k = i; k < first; k++) if (sm[k] < 0.05 * S) dipped = true;
      burst = dipped;
    }
  }
  // Breathy: air first, or a rise so slow the air is part of it. Hard: a burst before the voice,
  // or the level is there within 25 ms (the engine's glottal-stop onsets take about 20 ms, its
  // plain ones 30–45 ms), or nearly so with a peak over the level that follows.
  const kind: OnsetKind = breathMs > 60 || riseMs > 90 ? "breathy" : burst || riseMs < 25 || (riseMs < 40 && overshoot > 2.5) ? "hard" : "soft";
  return { kind, riseMs, overshoot, breathMs };
}
