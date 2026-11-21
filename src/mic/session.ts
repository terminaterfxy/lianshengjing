/**
 * Everything the mic page reads off a voice, frame by frame, in one place and with no browser in
 * it: what kind of sound it is and its vowel (SoundTracker), how the folds close (glottis.ts), the
 * breath under the note and how the note began (breath.ts), the note's pitch and vibrato
 * (pitch.ts), how bright it is (tone.ts), and a range being recorded (range.ts).
 * The page feeds it the microphone; `tools/mic-selftest.ts` feeds it rendered audio at a fixed
 * frame rate, so what is tested is what runs.
 */
import { analyse, frameLength, type MicFrame } from "./formants.ts";
import { glottalFeatures, openQuotient, type GlottalFeatures } from "./glottis.ts";
import { SoundTracker, QUIET, type Heard } from "./track.ts";
import { analyseOnset, BreathTracker, type Onset, type Steadiness } from "./breath.ts";
import { RangeRecorder } from "./range.ts";
import { PitchTracker } from "./pitch.ts";
import { bandPowers, ToneTracker } from "./tone.ts";

export interface Frame {
  fr: MicFrame;
  glottal: GlottalFeatures | null;
  /** the frame's power in 100 Hz bands, for the brightness (null when it is not voiced) */
  bands: Float32Array | null;
}

/** One analysis frame from the newest ~43 ms of sound, `frameLength` samples (what MicListener.read gives). */
export function readFrame(samples: Float32Array, sampleRate: number): Frame {
  const fr = analyse(samples, sampleRate);
  return { fr, glottal: fr.voiced && fr.formants.length >= 2 ? glottalFeatures(samples, sampleRate, fr.f0, fr.formants) : null, bands: fr.voiced ? bandPowers(samples, sampleRate) : null };
}

export class MicSession {
  readonly tracker = new SoundTracker();
  /** the note sung, its vibrato and how steady it is */
  readonly pitch = new PitchTracker();
  /** how bright the held sound is */
  readonly tone = new ToneTracker();
  private readonly breath = new BreathTracker();
  private oqs: { t: number; v: number; db: number }[] = [];
  private beganAt = 0;
  /** the phrase in progress has not had its onset read yet */
  private onsetDue = false;
  /** which fit of the fold closure to use */
  voice: "female" | "male" = "female";
  heard: Heard = QUIET;
  /** the open share of the cycle (null when no vowel sounds) */
  oq: number | null = null;
  /** how loud that vowel is, dBFS (null with `oq`): the closure reads a few points tighter or looser as the singer sings softer or louder */
  level: number | null = null;
  /** the breath under the sound in progress, or the last one */
  steady: Steadiness | null = null;
  /** how the last note began */
  onset: Onset | null = null;
  /** a range being recorded, or null */
  ranging: RangeRecorder | null = null;
  /** how many breaths have ended, and the last one that did (for the history) */
  breathsEnded = 0;
  endedBreath: Steadiness | null = null;
  private breathWas = false;

  /** a breath is in progress (its reading is `steady`) */
  get breathSounding(): boolean {
    return this.breath.sounding;
  }

  /** the level of the note in progress (or the last) over time, for drawing */
  get breathTrace(): { t: readonly number[]; db: readonly number[] } {
    return this.breath.trace;
  }

  /** the closed share of the cycle, % */
  get closed(): number | null {
    return this.oq === null ? null : 100 * (1 - this.oq);
  }

  /**
   * One frame. `now` in ms, `dt` in s since the last. `recent` gives the last two thirds of a
   * second of sound when asked (the look back at an onset); it may return null.
   */
  step(now: number, dt: number, f: Frame, recent: () => { samples: Float32Array; sampleRate: number } | null): Heard {
    const { fr, glottal } = f;
    const h = (this.heard = this.tracker.step(fr, now, dt));
    const kind = h.kind;
    const voiced = kind === "vowel" || kind === "held";

    // the folds: this frame's estimate, then the median of the last half second (on a display
    // too slow to give three frames in that, of the last three)
    if (kind === "vowel" && glottal && fr.voiced) this.oqs.push({ t: now, v: openQuotient(glottal, fr.f0, fr.level - this.tracker.floor, this.voice), db: fr.level });
    else if (kind === "silence") this.oqs.length = 0;
    while (this.oqs.length > 3 && now - this.oqs[0].t > 500) this.oqs.shift();
    while (this.oqs.length && now - this.oqs[0].t > 2000) this.oqs.shift();
    this.oq = this.oqs.length >= 3 ? this.oqs.map((o) => o.v).sort((p, q) => p - q)[this.oqs.length >> 1] : null;
    this.level = this.oq === null ? null : this.oqs.map((o) => o.db).sort((p, q) => p - q)[this.oqs.length >> 1];

    // The breath is the whole phrase, from the first sound to the silence after it: consonants
    // and all (a sung line is not one vowel). Its onset is where its voice begins: 230 ms after
    // that, a look back (the long buffer then holds the silence before it and the rise).
    const began = this.breath.feed(now, kind !== "silence", fr.level);
    if (began) this.onsetDue = true;
    if (this.onsetDue && voiced && !this.beganAt) this.beganAt = now;
    // a voice that breaks off before the look back (a murmur ahead of an h, say) was not the
    // note's beginning: wait for the one that lasts
    else if (!voiced && this.beganAt) this.beganAt = 0;
    this.steady = this.breath.last;
    if (this.breathWas && !this.breath.sounding) {
      this.endedBreath = this.breath.last;
      this.breathsEnded++;
    }
    this.breathWas = this.breath.sounding;
    if (this.beganAt && now - this.beganAt >= 230) {
      const rec = now - this.beganAt < 580 && h.f0 > 0 ? recent() : null;
      this.beganAt = 0;
      this.onsetDue = false;
      if (rec) this.onset = analyseOnset(rec.samples, rec.sampleRate, h.f0) ?? this.onset;
    }

    this.ranging?.feed(now, voiced && fr.voiced && fr.clarity >= 0.8 ? fr.f0 : 0);
    this.pitch.feed(now, voiced && fr.voiced ? fr.f0 : 0);
    this.tone.feed(now, voiced && fr.voiced ? f.bands : null);
    return h;
  }
}

/**
 * Play `x` to a session as the page would hear it, `fps` frames a second, calling `each` after
 * every frame. For tests and tools.
 */
export function replay(session: MicSession, x: Float32Array, sampleRate: number, fps: number, each?: (tSeconds: number) => void): void {
  const short = new Float32Array(frameLength(sampleRate)), long = new Float32Array(32768);
  const hop = sampleRate / fps;
  const fill = (buf: Float32Array, end: number) => {
    for (let i = 0; i < buf.length; i++) {
      const k = end - buf.length + i;
      buf[i] = k >= 0 && k < x.length ? x[k] : 0;
    }
  };
  for (let n = 1; ; n++) {
    const end = Math.round(n * hop);
    if (end > x.length) break;
    fill(short, end);
    session.step((n * 1000) / fps, 1 / fps, readFrame(short, sampleRate), () => {
      fill(long, end);
      return { samples: long, sampleRate };
    });
    each?.(n / fps);
  }
}
