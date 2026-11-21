/**
 * Self-test of the mic page's readings (src/mic): the engine renders sounds whose answers are
 * known, and they are played to the same MicSession the page runs, frame by frame.
 *
 *   cargo build --release -p chimera-cli && cargo build --release -p chimera --example glottis_sweep
 *   node tools/mic-selftest.ts
 *
 * What it checks: vowel formants, calibration to another voice, which sounds are recognised, the
 * fold closure (against the engine's own glottis), onsets (plain, glottal, with h), the steadiness
 * of a held note, a range sung as a scale, and that none of it depends on the frame rate. Its
 * audio goes in a temporary folder that it deletes. It tests the method on the engine's voices;
 * a real voice through a real phone is the test it cannot make.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyse } from "../src/mic/formants.ts";
import { applyAffine, calibrationProblem, fitAffine, type Calibration } from "../src/mic/calibrate.ts";
import { analyseOnset } from "../src/mic/breath.ts";
import { MicSession, replay } from "../src/mic/session.ts";
import { RangeRecorder } from "../src/mic/range.ts";
import { initChimera, call } from "../src/wasm/chimera.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "target/release/chimera"), sweep = join(root, "target/release/examples/glottis_sweep");
const tmp = mkdtempSync(join(tmpdir(), "chimera-mic-"));
let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}: ${detail}`);
};
const median = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];

/** a rendered WAV as mono floats, with quiet room noise around and under it */
function wav(file: string, pad = 0.6): { x: Float32Array; sr: number } {
  const b = readFileSync(file);
  const sr = b.readUInt32LE(24), ch = b.readUInt16LE(22);
  let off = 12;
  while (b.toString("ascii", off, off + 4) !== "data") off += 8 + b.readUInt32LE(off + 4);
  const n = b.readUInt32LE(off + 4) / 2 / ch;
  off += 8;
  const lead = Math.round(pad * sr);
  const x = new Float32Array(n + 2 * lead);
  for (let i = 0; i < x.length; i++) x[i] = (Math.random() - 0.5) * 2e-4;
  for (let i = 0; i < n; i++) x[lead + i] += b.readInt16LE(off + i * 2 * ch) / 32768;
  return { x, sr };
}
const render = (...args: string[]) => execFileSync(cli, ["render", ...args], { stdio: "ignore" });
const semis = (a: number, b: number) => 12 * Math.log2(a / b);

try {
  await initChimera(readFileSync(join(root, "src/wasm/chimera.wasm")));
  const catalog = call<{ vowelTargets: Record<string, Record<string, { formants: number[] }>> }>("catalog");
  const VOWELS = ["i", "e", "ɛ", "æ", "ɑ", "ɔ", "o", "u", "ʌ", "ɝ"];

  // ---- vowels: formants, and calibration of one voice onto another body
  console.log("\nvowels");
  const measured: Record<string, Record<string, { F1: number; F2: number }>> = {};
  for (const body of ["female", "male"]) {
    render("vowels", body, join(tmp, `vowels-${body}`));
    const { x, sr } = wav(join(tmp, `vowels-${body}.wav`), 0);
    const seg = x.length / VOWELS.length;
    measured[body] = {};
    let worst = 0;
    VOWELS.forEach((v, k) => {
      const F1: number[] = [], F2: number[] = [];
      for (let s = Math.floor(k * seg + seg * 0.3); s + 2048 < (k + 1) * seg - seg * 0.3; s += 800) {
        const fr = analyse(x.subarray(s, s + 2048), sr);
        if (fr.voiced && fr.formants.length >= 2) {
          F1.push(fr.formants[0]);
          F2.push(fr.formants[1]);
        }
      }
      measured[body][v] = { F1: median(F1), F2: median(F2) };
      const t = catalog.vowelTargets[body][v].formants;
      worst = Math.max(worst, Math.abs(Math.log(median(F1) / t[0])), Math.abs(Math.log(median(F2) / t[1])));
    });
    check(`${body} vowel formants`, worst < 0.17, `worst deviation from the engine's own ${(100 * (Math.exp(worst) - 1)).toFixed(0)} % (limit 18 %)`);
  }
  for (const [singer, model] of [["male", "female"], ["female", "male"]]) {
    const T = (v: string) => ({ F1: catalog.vowelTargets[model][v].formants[0], F2: catalog.vowelTargets[model][v].formants[1] });
    const nearest = (p: { F1: number; F2: number }) => VOWELS.reduce((best, v) => (Math.hypot(Math.log(p.F1 / T(v).F1) * 2.2, Math.log(p.F2 / T(v).F2)) < Math.hypot(Math.log(p.F1 / T(best).F1) * 2.2, Math.log(p.F2 / T(best).F2)) ? v : best));
    const from = [measured[singer]["ɑ"], measured[singer]["i"], measured[singer]["u"]] as Calibration;
    const A = fitAffine(from, [T("ɑ"), T("i"), T("u")] as Calibration)!;
    const raw = VOWELS.filter((v) => nearest(measured[singer][v]) === v).length;
    const cal = VOWELS.filter((v) => nearest(applyAffine(A, measured[singer][v])) === v).length;
    check(`calibration, ${singer} voice on the ${model} body`, cal >= 8 && calibrationProblem(from) === null, `right vowel ${raw}/10 before, ${cal}/10 after (need 8)`);
  }

  // ---- which sounds are recognised
  console.log("\nsounds");
  for (const [ipa, want] of [["sː sː", "s"], ["ɕː ɕː", "sh"]] as const) {
    render("speech", join(tmp, "c"), ipa, "female");
    const { x, sr } = wav(join(tmp, "c.wav"));
    const seen = new Set<string>();
    const s = new MicSession();
    replay(s, x, sr, 60, () => seen.add(s.heard.kind));
    check(`"${ipa}" is heard as ${want}`, seen.has(want), `kinds heard: ${[...seen].join(" ")}`);
  }

  // ---- the folds: a small sweep whose open quotient the engine reports
  console.log("\nfold closure");
  for (const body of ["female", "male"] as const) {
    const dir = join(tmp, `sweep-${body}`);
    execFileSync(sweep, [dir, body, "0.1", "40", "mini"], { stdio: "ignore" });
    const recs = JSON.parse(readFileSync(join(dir, "sweep.json"), "utf8")) as { vowel: string; f0: number; pressure: number; oq: number; offset: number; len: number }[];
    const buf = readFileSync(join(dir, "sweep.f32"));
    const all = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    const got: { r: (typeof recs)[number]; est: number }[] = [];
    for (const r of recs) {
      // as the page hears it: silence, then the note, in a quiet room
      const x = new Float32Array(r.len + 24000);
      for (let i = 0; i < x.length; i++) x[i] = (Math.random() - 0.5) * 3e-4;
      for (let i = 0; i < r.len; i++) x[24000 + i] += all[r.offset + i];
      const s = new MicSession();
      s.voice = body;
      const est: number[] = [];
      replay(s, x, 48000, 60, (t) => {
        if (s.oq !== null && t > 0.5 + 0.3) est.push(s.oq);
      });
      if (est.length) got.push({ r, est: median(est) });
    }
    const mae = got.reduce((a, g) => a + Math.abs(g.est - g.r.oq), 0) / got.length;
    let right = 0, pairs = 0;
    for (let i = 0; i < got.length; i++)
      for (let j = i + 1; j < got.length; j++) {
        const a = got[i], b = got[j];
        if (a.r.vowel !== b.r.vowel || a.r.f0 !== b.r.f0 || a.r.pressure !== b.r.pressure || Math.abs(a.r.oq - b.r.oq) < 0.06) continue;
        pairs++;
        if ((a.est - b.est) * (a.r.oq - b.r.oq) > 0) right++;
      }
    check(`${body}: readings for the sweep`, got.length >= recs.length * 0.95, `${got.length} of ${recs.length} notes gave a reading`);
    // soft and loud singing only (the sweep's extremes), where the reading is known to run a few points tight and loose
    check(`${body}: closure, absolute`, mae < 0.055, `mean error ${(100 * mae).toFixed(1)} points of the cycle (limit 5.5)`);
    check(`${body}: closure, which of two takes is tighter`, right / pairs > 0.95, `${((100 * right) / pairs).toFixed(1)} % right of ${pairs} pairs (need 95 %)`);
  }

  // ---- onsets: the engine's own, and what the classifier is told apart by
  console.log("\nonsets");
  // a room: decaying reflections after the direct sound (drr: direct over reverberant energy, dB), and noise
  let seed = 11;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => rnd() + rnd() + rnd() - 1.5;
  const inRoom = (dry: Float32Array, sr: number, rt60: number, drr: number, snr: number): Float32Array => {
    const y = Float32Array.from(dry);
    if (rt60) {
      const L = Math.round(rt60 * sr * 0.8), taps: [number, number][] = [];
      let e = 0;
      for (let i = Math.round(0.004 * sr); i < L; i += 7) {
        const c = gauss() * Math.exp((-6.908 * i) / (rt60 * sr));
        taps.push([i, c]);
        e += c * c;
      }
      const g = Math.sqrt(10 ** (-drr / 10) / e);
      for (const [i, c] of taps) for (let k = 0; k + i < dry.length; k++) y[k + i] += c * g * dry[k];
    }
    let e = 0, n = 0;
    for (const v of dry)
      if (Math.abs(v) > 1e-3) {
        e += v * v;
        n++;
      }
    const sd = Math.sqrt(e / Math.max(1, n)) * 10 ** (-snr / 20);
    for (let i = 0; i < y.length; i++) y[i] += sd * gauss() * 2;
    return y;
  };
  const rooms: [string, number, number, number][] = [
    ["dry and quiet", 0, 99, 70],
    // (noisier than this, a breath only 10 dB over the room can't be told from it: at 28 dB one h in 36 reads soft)
    ["noisy (SNR 32 dB)", 0, 99, 32],
    ["a room (RT60 0.3 s, phone near)", 0.3, 12, 40],
    ["a live room (RT60 0.5 s, phone near)", 0.5, 12, 40],
  ];
  for (const [room, rt60, drr, snr] of rooms) {
    let right = 0, total = 0;
    const wrong: string[] = [];
    for (const body of ["female", "male"])
      for (const [ipa, want] of [["ɑː", "soft"], ["iː", "soft"], ["ʔɑː", "hard"], ["ʔiː", "hard"], ["hɑː", "breathy"], ["hiː", "breathy"]] as const) {
        render("speech", join(tmp, "o"), ipa, body);
        const { x, sr } = wav(join(tmp, "o.wav"));
        const heardIn = inRoom(x, sr, rt60, drr, snr);
        for (const fps of [60, 30, 15]) {
          const s = new MicSession();
          replay(s, heardIn, sr, fps);
          total++;
          if (s.onset?.kind === want) right++;
          else wrong.push(`${body} ${ipa} at ${fps} fps read ${s.onset?.kind ?? "none"}, is ${want}`);
        }
      }
    check(`onsets, ${room}`, right === total, `${right} of ${total} right (plain → soft, glottal stop → hard, h → breathy; 60 / 30 / 15 frames a second)${wrong.length ? ": " + wrong.join("; ") : ""}`);
  }
  check("no onset in a steady sound", analyseOnset(new Float32Array(32768).fill(0.1), 48000, 200) === null, "a buffer with no rise gives none");

  // ---- the breath under a held note, and a range
  console.log("\nheld note and range");
  for (const vib of [0, 40, 70]) {
    writeFileSync(join(tmp, "n.json"), JSON.stringify({ bpm: 60, vibrato: vib, lyrics: "la", notes: [[67, 5]] }));
    render("notes", join(tmp, "n.json"), join(tmp, "n"), "female");
    const { x, sr } = wav(join(tmp, "n.wav"));
    const s = new MicSession();
    replay(s, x, sr, 60);
    const st = s.steady;
    check(`held 5 s, vibrato ${vib} cents`, !!st && st.sd !== null && st.sd < 1.2 && Math.abs(st.slope) < 0.4 && Math.abs(st.seconds - 5) < 0.5, st ? `wander ±${st.sd?.toFixed(2)} dB, trend ${st.slope.toFixed(2)} dB/s, ${st.seconds.toFixed(1)} s (after the note has ended)` : "no reading");
    // the same note, sagging 1.5 dB a second: the trend must say so, the wander must not
    const y = Float32Array.from(x, (v, i) => v * 10 ** ((-1.5 * Math.max(0, i / sr - 0.6)) / 20));
    const s2 = new MicSession();
    replay(s2, y, sr, 60);
    check(`  the same, sagging 1.5 dB/s`, !!s2.steady && Math.abs(s2.steady.slope + 1.5) < 0.4 && (s2.steady.sd ?? 9) < 1.3, `trend ${s2.steady?.slope.toFixed(2)} dB/s, wander ±${s2.steady?.sd?.toFixed(2)} dB`);
  }
  // a pause inside a breath: half a second of quiet does not end it, a second and a half does
  writeFileSync(join(tmp, "n.json"), JSON.stringify({ bpm: 60, vibrato: 30, lyrics: "la", notes: [[67, 6]] }));
  render("notes", join(tmp, "n.json"), join(tmp, "n"), "female");
  for (const [pause, want] of [[0.5, 1], [1.5, 2]] as const) {
    const { x, sr } = wav(join(tmp, "n.wav"));
    const from = Math.round((0.6 + 2.5) * sr), to = from + Math.round(pause * sr);
    for (let i = from; i < to; i++) x[i] = (Math.random() - 0.5) * 2e-4;
    const s = new MicSession();
    let breaths = 0, was = false;
    const live = () => s.steady !== null;
    let lastSecs = 0;
    replay(s, x, sr, 60, () => {
      // a new breath shows as its length starting again from under a second
      const secs = s.steady?.seconds ?? 0;
      if (live() && (!was || secs < lastSecs - 1)) breaths++;
      was = live();
      lastSecs = secs;
    });
    check(`a ${pause} s pause in a held note`, breaths === want, `read as ${breaths} breath${breaths === 1 ? "" : "s"} (should be ${want})`);
  }
  const up = [...Array.from({ length: 25 }, (_, i) => 57 + i), ...Array.from({ length: 17 }, (_, i) => 80 - i)];
  const scales: [string, object][] = [
    ["slid on one syllable", { bpm: 120, vibrato: 20, lyrics: "la " + Array(up.length - 1).fill("-").join(" "), notes: up.map((m) => [m, 0.7]) }],
    ["stepped la la la", { bpm: 100, vibrato: 20, lyrics: Array(13).fill("la").join(" "), notes: Array.from({ length: 13 }, (_, i) => [57 + 2 * i, 1]) }],
  ];
  for (const [name, melody] of scales) {
    writeFileSync(join(tmp, "r.json"), JSON.stringify(melody));
    render("notes", join(tmp, "r.json"), join(tmp, "r"), "female");
    const { x, sr } = wav(join(tmp, "r.wav"));
    for (const fps of [60, 20]) {
      const s = new MicSession();
      s.ranging = new RangeRecorder();
      replay(s, x, sr, fps);
      const r = s.ranging.range;
      check(`range A3–A5, ${name}, ${fps} frames a second`, !!r && Math.abs(semis(r[0], 220)) < 0.6 && Math.abs(semis(r[1], 880)) < 0.6, r ? `${r[0].toFixed(0)}–${r[1].toFixed(0)} Hz (220–880)` : "none");
    }
  }
  // a sung line with words is one breath, however many consonants it has: two lines of a song
  // (public domain: 送别) with a rest of two beats (1.7 s) between them must read as two breaths
  // of the right length. (A breath ends after a second of quiet: a shorter pause joins them.)
  const song = {
    bpm: 72,
    vibrato: 30,
    lyrics: "长 亭 - 外 古 道 边 芳 草 - 碧 连 - 天 晚 风 - 拂 柳 笛 声 残 夕 阳 - 山 外 山",
    notes: [[67, 1], [64, 0.5], [67, 0.5], [72, 2], [69, 1], [72, 1], [67, 2], [67, 1], [60, 0.5], [62, 0.5], [64, 1], [62, 0.5], [60, 0.5], [62, 3], [0, 2], [67, 1], [64, 0.5], [67, 0.5], [72, 1.5], [71, 0.5], [69, 1], [72, 1], [67, 2], [67, 1], [62, 0.5], [64, 0.5], [65, 1.5], [59, 0.5], [60, 3]],
  };
  writeFileSync(join(tmp, "song.json"), JSON.stringify(song));
  render("notes", join(tmp, "song.json"), join(tmp, "song"), "female");
  {
    const { x, sr } = wav(join(tmp, "song.wav"));
    for (const fps of [60, 30]) {
      const s = new MicSession();
      const breaths: number[] = [];
      let was = false, kinds = new Set<string>();
      replay(s, x, sr, fps, () => {
        const on = s.heard.kind !== "silence";
        if (was && !on && s.steady) breaths.push(s.steady.seconds);
        was = on;
        kinds.add(s.heard.kind);
      });
      // 15 beats and 14 beats at 72 a minute: 12.5 s and 11.7 s, less the engine's own release
      const ok = breaths.length === 2 && Math.abs(breaths[0] - 12.2) < 1.2 && Math.abs(breaths[1] - 11.5) < 1.2;
      check(`a song with words, two lines, ${fps} frames a second`, ok, `${breaths.length} breaths read: ${breaths.map((b) => b.toFixed(1) + " s").join(", ")} (two, of about 12 s each); sounds heard: ${[...kinds].join(" ")}`);
    }
  }
  // noise and a cough are not notes
  const rr = new RangeRecorder();
  for (let i = 0; i < 600; i++) rr.feed(i * 16.7, i % 37 === 0 ? 1500 : i % 11 === 0 ? 90 : 0);
  check("stray pitches are not a range", rr.range === null, "isolated misread frames record nothing");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
