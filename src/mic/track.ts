/**
 * What kind of sound the microphone hears, frame by frame: a vowel (with its smoothed formants),
 * a hiss (s, or sh / x), breath, a voice whose vowel can't be read, or silence. Pure: the mic page
 * feeds it MicFrames and turns the result into a pose; tests feed it rendered audio.
 */
import type { MicFrame } from "./formants.ts";

export type Kind = "silence" | "vowel" | "held" | "s" | "sh" | "breath";

export interface Heard {
  kind: Kind;
  f0: number;
  F1: number;
  F2: number;
  clarity: number;
}

export const QUIET: Heard = { kind: "silence", f0: 0, F1: 0, F2: 0, clarity: 0 };

const median = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];

export class SoundTracker {
  /** the room's level, dBFS (the voice's level over it is the SNR) */
  floor = -60;
  private lastSound = -1e9;
  private lastVowel = -1e9;
  private hissSince = 0;
  private hist: { F1: number; F2: number }[] = [];
  private smooth: { F1: number; F2: number } | null = null;
  heard: Heard = QUIET;

  /** `now` in ms, `dt` in s since the last frame. */
  step(fr: MicFrame, now: number, dt: number): Heard {
    const kind = this.heard.kind;
    // the room's own level, followed down at once and up slowly
    this.floor = fr.level < this.floor ? Math.max(-90, fr.level) : Math.min(-35, this.floor + (kind === "silence" ? 3 : 0.3) * dt);
    // sounding starts 10 dB over the room and, once started, lasts until 6 dB over it: a quiet
    // moment inside a phrase must not end the phrase
    const loud = fr.level > Math.max(this.floor + (kind === "silence" ? 10 : 6), kind === "silence" ? -58 : -62);
    const strong = fr.level > Math.max(this.floor + 16, -50);
    const f = fr.formants;
    // a hiss has no pitch and crosses zero far more often than any vowel does. (A bright or breathy
    // vowel can cross zero as often: with a pitch, it is a voice.)
    const hiss = strong && !fr.voiced && fr.noiseHz > 2500 && fr.noiseHz < 9500;
    const vowel = loud && fr.voiced && !hiss && f.length >= 2 && f[0] < 1300 && f[1] > f[0] + 150 && f[1] < 3600;
    // how long the hiss has lasted (in time: a slow display must not need more frames of it)
    if (!hiss) this.hissSince = 0;
    else if (!this.hissSince) this.hissSince = now;

    if (vowel) {
      this.lastSound = this.lastVowel = now;
      this.hist.push({ F1: f[0], F2: f[1] });
      if (this.hist.length > 5) this.hist.shift();
      const F1 = median(this.hist.map((p) => p.F1)), F2 = median(this.hist.map((p) => p.F2));
      const k = 1 - Math.exp(-dt / 0.05);
      const s = this.smooth;
      this.smooth = s ? { F1: s.F1 * Math.pow(F1 / s.F1, k), F2: s.F2 * Math.pow(F2 / s.F2, k) } : { F1, F2 };
      this.heard = { kind: "vowel", f0: fr.f0, F1: this.smooth.F1, F2: this.smooth.F2, clarity: fr.clarity };
    } else if (hiss && now - this.hissSince >= 70) {
      // a hiss that lasted: s where the noise is high, sh / x lower
      this.lastSound = now;
      this.hist.length = 0;
      this.smooth = null;
      this.heard = { ...QUIET, kind: fr.noiseHz >= 6000 ? "s" : "sh" };
    } else if (hiss) {
      // a hiss just begun: wait for it
      this.lastSound = now;
    } else if (loud && fr.voiced) {
      // a voice whose vowel can't be read (a nasal, a very high note, a breathy or distant voice):
      // the last shape stays
      this.lastSound = now;
      const k: Kind = now - this.lastVowel > 250 ? "held" : kind === "silence" ? "held" : kind;
      this.heard = { ...this.heard, kind: k, f0: fr.f0, clarity: fr.clarity };
    } else if (strong && !fr.voiced) {
      // breath without a hiss: h, f
      this.lastSound = now;
      if (kind === "silence" || kind === "breath") this.heard = { ...QUIET, kind: "breath" };
    } else if (loud) {
      // something still sounds (a consonant's closure, a frame with no clear pitch): what was
      // heard stays as it was. Only quiet, for 0.3 s, is silence.
      this.lastSound = now;
    } else if (now - this.lastSound > 300) {
      this.hist.length = 0;
      this.smooth = null;
      this.heard = QUIET;
    }
    return this.heard;
  }
}
