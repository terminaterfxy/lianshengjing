/**
 * Pitch: which note is sung and how far it is from the nearest semitone, the note's vibrato, how
 * steady its centre is, and whether it sinks or rises while held.
 *
 * The detector (formants.ts) is good to about a cent on a clean tone (3 cents at A5), so this
 * adds no detector of its own; it reads the pitch frame by frame:
 *  - the note now: the pitch averaged over 0.4 s under a Hann window, so a vibrato's swing (4–8 a
 *    second) averages out and what is shown is the note's centre;
 *  - notes: a voiced stretch is split where its centre moves more than ¾ of a semitone away and
 *    stays there (a step, a leap, a slide to the next note);
 *  - for the note in progress, or the last one held long enough: its centre and distance from the
 *    nearest semitone, the vibrato's rate and extent (a sine fitted at each rate from 3.5 to 9 Hz,
 *    which needs no even frame timing), and its centre line (the same fit, a line and a sine, over
 *    a cycle and a half around each point) for how much it wanders and where it heads.
 *
 * It does not know which note the singer means: "off" is from the nearest semitone of equal
 * temperament (A4 = 440 Hz), so a note sung more than half a semitone off reads as its neighbour.
 * Pure, for tests.
 */

export interface Vibrato {
  /** cycles a second */
  rate: number;
  /** half the swing, cents (a vibrato of ±50 swings a semitone from top to bottom) */
  extent: number;
}

export interface NoteReading {
  /** the note's centre, in semitones (MIDI numbers: 69 = A4) */
  midi: number;
  /** how far that centre is from the nearest semitone, cents (− flat, + sharp) */
  cents: number;
  /** how long the note has lasted, s */
  seconds: number;
  /** how much its centre wanders around its own trend, cents (null under a second) */
  wobble: number | null;
  /** where its centre went from the start of the note to its end, cents (null under a second) */
  drift: number | null;
  /** null when the pitch does not swing periodically (or not for long enough to tell) */
  vibrato: Vibrato | null;
}

const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
/** "A4" for 69 */
export const noteOf = (midi: number): string => {
  const m = Math.round(midi);
  return NOTES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
};
export const midiOf = (hz: number): number => 69 + 12 * Math.log2(hz / 440);

/**
 * A gap in the pitch longer than this ends the voiced stretch (a detector's missed frame does not).
 * Only a gap with a frame in it that had no pitch: on a slow display every frame is this far apart.
 */
const GAP = 0.15;
/** a note's centre this far (semitones) from where the note sits, for this long (s), is a new note */
const SPLIT = 0.75, SPLIT_FOR = 0.1;
/** a one-frame jump this large (semitones) away from both neighbours is the detector slipping, not the voice */
const SLIP = 2.5;
/** the slowest display a note is read on, frames a second */
export const MIN_FPS = 12;
/** a note whose centre line moves more than this (semitones) over its body is not read as one note */
const MOVES = 0.8;
/** the note's own body: not its first 0.2 s (the attack, a scoop up to it) nor its last 0.15 s (the release) */
const HEAD = 0.2, TAIL = 0.15;
/**
 * The analysis window (43–46 ms at any sample rate: formants.ts frameLength) averages the pitch over
 * its length and so shrinks a vibrato's swing, as a moving average this long would (measured on
 * sines of known swing, 4.5–7.5 Hz)
 */
const WINDOW = 0.04;

interface Pt {
  t: number;
  m: number;
}

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/** Solve a 4×4 system in place (Gaussian elimination with pivoting); null when singular. */
function solve4(A: number[][], b: number[]): number[] | null {
  const n = 4;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = [0, 0, 0, 0];
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

/**
 * The vibrato in `pts` (cents over time): for each rate from 3.5 to 9 Hz, a line plus a sine at
 * that rate fitted by least squares; the rate whose sine explains most of what the line leaves.
 * Vibrato when the sine explains at least half of it and swings at least ±12 cents.
 */
export function findVibrato(pts: readonly Pt[]): Vibrato | null {
  const n = pts.length;
  if (n < 8 || pts[n - 1].t - pts[0].t < 0.7) return null;
  const t0 = pts[0].t;
  // the line alone
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) {
    const x = p.t - t0, y = 100 * p.m;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  if (!den) return null;
  const k = (n * sxy - sx * sy) / den, c = (sy - k * sx) / n;
  let lineSse = 0;
  for (const p of pts) lineSse += (100 * p.m - c - k * (p.t - t0)) ** 2;
  if (lineSse <= 0) return null;
  let best: { rate: number; amp: number; gain: number } | null = null;
  for (let rate = 3.5; rate <= 9.0001; rate += 0.05) {
    const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
    for (const p of pts) {
      const x = p.t - t0, w = 2 * Math.PI * rate * x;
      const row = [1, x, Math.sin(w), Math.cos(w)], y = 100 * p.m;
      for (let i = 0; i < 4; i++) {
        b[i] += row[i] * y;
        for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j];
      }
    }
    const q = solve4(A, b);
    if (!q) continue;
    let sse = 0;
    for (const p of pts) {
      const x = p.t - t0, w = 2 * Math.PI * rate * x;
      sse += (100 * p.m - q[0] - q[1] * x - q[2] * Math.sin(w) - q[3] * Math.cos(w)) ** 2;
    }
    const gain = 1 - sse / lineSse;
    if (!best || gain > best.gain) best = { rate, amp: Math.hypot(q[2], q[3]), gain };
  }
  if (!best || best.gain < 0.5) return null;
  // the analysis window averaged the swing over its length: undo that
  const extent = best.amp / Math.max(0.5, sinc(best.rate * WINDOW));
  return extent >= 12 ? { rate: best.rate, extent } : null;
}

/**
 * The note's centre line: at each point, a line plus (with a vibrato) a sine at the vibrato's rate,
 * fitted by least squares to the points within a cycle and a half of it (without one, a tenth of a
 * second); the line's value there. Fitted, not averaged: frames that bunch up (a display that
 * stalls and catches up) would pull an average toward whatever part of the swing they fell on.
 */
function centreLine(t: readonly number[], m: readonly number[], rate: number | null): number[] {
  const half = rate ? 1.5 / rate : 0.1, w = rate ? 2 * Math.PI * rate : 0;
  const out = new Array<number>(t.length);
  let lo = 0, hi = 0;
  for (let i = 0; i < t.length; i++) {
    while (hi < t.length && t[hi] <= t[i] + half) hi++;
    while (t[lo] < t[i] - half) lo++;
    let mean = 0;
    for (let j = lo; j < hi; j++) mean += m[j];
    mean /= hi - lo;
    out[i] = mean;
    if (rate) {
      if (hi - lo < 8) continue;
      const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
      for (let j = lo; j < hi; j++) {
        const x = t[j] - t[i], row = [1, x, Math.sin(w * x), Math.cos(w * x)], y = m[j] - mean;
        for (let r = 0; r < 4; r++) {
          b[r] += row[r] * y;
          for (let c = 0; c < 4; c++) A[r][c] += row[r] * row[c];
        }
      }
      const q = solve4(A, b);
      if (q) out[i] = mean + q[0];
    } else {
      if (hi - lo < 3) continue;
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let j = lo; j < hi; j++) {
        const x = t[j] - t[i], y = m[j] - mean;
        sx += x;
        sy += y;
        sxx += x * x;
        sxy += x * y;
      }
      const n = hi - lo, den = n * sxx - sx * sx;
      if (den > 1e-12) out[i] = mean + (sy - ((n * sxy - sx * sy) / den) * sx) / n;
    }
  }
  return out;
}

/** What one note's points say: its centre, vibrato, wobble and drift (null if its body is too short). */
export function readNote(all: readonly Pt[]): NoteReading | null {
  if (all.length < 3) return null;
  // a held note stays within a semitone or so of itself, vibrato and all: what strays more than
  // two is a slip of the detector that outlasted one frame (or a scoop, in the attack anyway)
  const mid = all.map((p) => p.m).sort((x, y) => x - y)[all.length >> 1];
  const pts = all.filter((p) => Math.abs(p.m - mid) <= 2);
  if (pts.length < 3) return null;
  const start = pts[0].t, end = pts[pts.length - 1].t;
  const a = start + HEAD, b = end - TAIL;
  const body = pts.filter((p) => p.t >= a && p.t <= b);
  if (body.length < 3 || b - a < 0.3) return null;
  // Under a dozen frames a second a vibrato (5–7 a second) can't be told from the frames' own
  // rhythm, and every reading below comes out wrong: none rather than a wrong one.
  const gaps = body.slice(1).map((p, i) => p.t - body[i].t).sort((x, y) => x - y);
  if (gaps[gaps.length >> 1] > 1 / MIN_FPS) return null;
  // the vibrato over the last two seconds of the body (a vibrato often starts late, and changes)
  const vibrato = findVibrato(body.filter((p) => p.t >= b - 2));
  const t = pts.map((p) => p.t), m = pts.map((p) => p.m);
  const line = centreLine(t, m, vibrato ? vibrato.rate : null);
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (t[i] < a || t[i] > b) continue;
    const x = t[i] - a, y = 100 * line[i];
    lo = Math.min(lo, line[i]);
    hi = Math.max(hi, line[i]);
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
  }
  // A centre that moves most of a semitone is not one note: two short ones the split missed (it
  // needs a few tenths of a second of each), or a slide. Its mean would be a note nobody sang.
  if (hi - lo > MOVES) return null;
  const midi = sy / n / 100;
  const long = b - a >= 1;
  const den = n * sxx - sx * sx, slope = den ? (n * sxy - sx * sy) / den : 0;
  const varY = syy / n - (sy / n) ** 2, varT = sxx / n - (sx / n) ** 2;
  return {
    midi,
    cents: 100 * (midi - Math.round(midi)),
    seconds: end - start,
    wobble: long ? Math.sqrt(Math.max(0, varY - slope * slope * varT)) : null,
    drift: long ? slope * (b - a) : null,
    vibrato,
  };
}

export class PitchTracker {
  /** the voiced stretch in progress (median-of-3 filtered), and where its current note starts in it */
  private run: Pt[] = [];
  private noteFrom = 0;
  /** when the note in progress began (s): a long one keeps only its last 12 s of points */
  private noteT0 = 0;
  /** since when the centre has been away from the note (s), or 0 */
  private awaySince = 0;
  /** the last three readings: one is kept once the next is in (see feed) */
  private raw: Pt[] = [];
  private lastPitch = -1e9;
  private now = 0;
  /** what is drawn: the last ten seconds, NaN in the gaps */
  private tt: number[] = [];
  private mm: number[] = [];
  /** the last note held long enough to read, after it ended */
  private held: NoteReading | null = null;
  /** the note in progress as last read (every tenth of a second), while it read as one note */
  private current: NoteReading | null = null;
  private readAt = -1e9;

  /** `now` in ms; `f0` in Hz, 0 when there is no pitch (silence, a hiss, a consonant). */
  feed(now: number, f0: number): void {
    const t = now / 1000, before = this.now;
    this.now = t;
    if (f0 > 0) {
      this.raw.push({ t, m: midiOf(f0) });
      if (this.raw.length > 3) this.raw.shift();
    }
    // the pitch broke off: a frame without it, and longer ago than a missed frame or two
    const broke = t - this.lastPitch > GAP && (this.lastPitch < before || t - this.lastPitch > 0.5);
    if (f0 > 0 && broke) {
      // a new voiced stretch
      this.closeNote();
      this.run = [];
      this.noteFrom = 0;
      this.noteT0 = t;
      this.awaySince = 0;
      this.raw = [{ t, m: midiOf(f0) }];
    } else if (!(f0 > 0) && t - this.lastPitch > GAP && this.run.length) {
      // the stretch has ended
      this.closeNote();
      this.run = [];
      this.raw = [];
    }
    if (f0 > 0) {
      this.lastPitch = t;
      // A reading is kept once the next one is in, unless it jumped away from both its neighbours
      // the same way by more than 2½ semitones: a detector's one-frame slip (an octave, a fifth).
      // Not a median of three: on a slow display that would shave a vibrato's peaks off.
      const r = this.raw;
      if (r.length === 1) this.add(r[0], true);
      else if (r.length === 3) {
        const up = r[1].m - r[0].m, down = r[1].m - r[2].m;
        if (!(Math.abs(up) > SLIP && Math.abs(down) > SLIP && up * down > 0)) this.add(r[1]);
      }
    }
    // the note in progress, read ten times a second whatever the frame rate; a reading that fails
    // (the next note has begun, and the split has not caught up yet) leaves the last good one
    if (this.run.length && t - this.readAt >= 0.1) {
      this.readAt = t;
      this.current = this.timed(readNote(this.run.slice(this.noteFrom))) ?? this.current;
    }
  }

  private add(p: Pt, fresh = false): void {
    this.run.push(p);
    this.tt.push(p.t);
    this.mm.push(p.m);
    // a gap in the drawing where the pitch broke off
    const n = this.tt.length;
    if (fresh && n >= 2) {
      this.tt.splice(n - 1, 0, (p.t + this.tt[n - 2]) / 2);
      this.mm.splice(n - 1, 0, NaN);
    }
    while (this.tt.length && this.tt[0] < p.t - 10) {
      this.tt.shift();
      this.mm.shift();
    }
    // a long stretch keeps its last 12 s: the cost per frame must not grow without end
    if (this.run.length > 1 && p.t - this.run[0].t > 12) {
      const cut = this.run.findIndex((q) => q.t >= p.t - 12);
      this.run.splice(0, cut);
      this.noteFrom = Math.max(0, this.noteFrom - cut);
    }
    // a new note: the centre of the last 0.3 s away from the note's own median, for a while
    const note = this.run.slice(this.noteFrom);
    if (note.length < 4 || p.t - note[0].t < 0.3) return;
    const recent = note.filter((q) => q.t >= p.t - 0.3).map((q) => q.m).sort((x, y) => x - y);
    const here = recent[recent.length >> 1];
    const settled = note.filter((q) => q.t >= p.t - 1.5 && q.t < p.t - 0.3).map((q) => q.m).sort((x, y) => x - y);
    if (settled.length < 3) return;
    const sits = settled[settled.length >> 1];
    if (Math.abs(here - sits) > SPLIT) {
      if (!this.awaySince) this.awaySince = p.t;
      if (p.t - this.awaySince >= SPLIT_FOR) {
        // the new note starts where the move began
        const from = this.run.findIndex((q, i) => i >= this.noteFrom && q.t >= this.awaySince - 0.15);
        this.closeNote(from);
        this.noteFrom = from;
        this.noteT0 = this.run[from].t;
        this.awaySince = 0;
      }
    } else this.awaySince = 0;
  }

  /** the note in progress ends (at `until` in the run, or at the stretch's end) */
  private closeNote(until = this.run.length): void {
    const r = (this.run.length ? this.timed(readNote(this.run.slice(this.noteFrom, until))) : null) ?? this.current;
    if (r && r.seconds >= 0.6) this.held = r;
    this.current = null;
    this.readAt = -1e9;
  }

  /** a reading's length from the note's real start, however much of it is still kept */
  private timed(r: NoteReading | null): NoteReading | null {
    if (r && this.run.length && this.noteT0 < this.run[this.noteFrom].t) r.seconds += this.run[this.noteFrom].t - this.noteT0;
    return r;
  }

  /** the note's centre now, in semitones (vibrato averaged out); null without a pitch */
  get centre(): number | null {
    const n = this.run.length;
    if (!n || this.now - this.lastPitch > GAP) return null;
    const tEnd = this.run[n - 1].t;
    let w = 0, s = 0;
    for (let i = n - 1; i >= this.noteFrom; i--) {
      const age = tEnd - this.run[i].t;
      if (age > 0.4) break;
      const k = 0.5 + 0.5 * Math.cos((Math.PI * age) / 0.4);
      w += k;
      s += k * this.run[i].m;
    }
    return w > 0 ? s / w : null;
  }

  /** The note in progress, once its body is long enough to read; otherwise the last note held. */
  get note(): NoteReading | null {
    return this.current ?? this.held;
  }

  /** `note` is the note being sung (not the last one held) */
  get noteLive(): boolean {
    return this.current !== null && this.centre !== null;
  }

  /** a pitch is sounding */
  get live(): boolean {
    return this.centre !== null;
  }

  /** the last ten seconds of pitch (semitones, NaN in gaps) and their times (s), for drawing */
  get trace(): { t: readonly number[]; m: readonly number[] } {
    return { t: this.tt, m: this.mm };
  }
}
