/**
 * The mic page (the default route): a real voice's pitch, breath, folds, tone and mouth, one tab
 * each. The readings are src/mic/session.ts's; this file draws them. Below, how
 * the mouth tab's head is driven.
 *
 * The microphone gives three things (src/mic/formants.ts): the pitch, how clear or breathy the
 * tone is, and the vowel's formants, or for a hiss where its noise sits. From those the page
 * picks the tongue, jaw and lips that would make that sound on this body
 * (VoiceModel.articForFormants, the vowel map's own inverse; the planner's targets for s and sh)
 * and has the engine sing it, muted, at the singer's pitch: the engine's telemetry then draws
 * every screen as it does in Play. So the head is an inference from the sound and the folds are a
 * simulation at the heard pitch; neither is a view of the singer's own throat. What can't be
 * heard this way (the soft palate, the larynx, m/n/ng) stays at rest.
 *
 * If the audio can't start, the head still follows the voice, drawn from the store.
 */
import { useEffect, useRef, useState } from "react";
import { AnatomyView, nearestVowel, type InfoFn, type SlotsFn } from "./AnatomyView.tsx";
import { Screen } from "./Screen.tsx";
import { Segmented } from "./Controls.tsx";
import { Stroboscope } from "./Stroboscope.tsx";
import { TubeView } from "./TubeView.tsx";
import { MicListener } from "../../mic/formants.ts";
import { QUIET, type Heard, type Kind } from "../../mic/track.ts";
import { MicSession } from "../../mic/session.ts";
import { RangeRecorder } from "../../mic/range.ts";
import { findBreaks, GlideRecorder } from "../../mic/register.ts";
import { RegisterCard, type GlideState } from "./RegisterCard.tsx";
import { midiOf, MIN_FPS, noteOf, type NoteReading, type Vibrato } from "../../mic/pitch.ts";
import { applyAffine, CalibrationRun, calibrationProblem, fitAffine, loadCalibration, REFS, saveCalibration, type Affine, type Calibration } from "../../mic/calibrate.ts";
import type { VoiceModel } from "../analysis.ts";
import type { Onset, OnsetKind, Steadiness } from "../../mic/breath.ts";
import { addRecord, parseRecords, recordOf, type BreathRecord } from "../../mic/history.ts";
import { BreathHistory, sdWord } from "./BreathHistory.tsx";
import { ToneTab, type ToneTake } from "./ToneTab.tsx";
import { RhythmPage } from "./RhythmPage.tsx";
import { engine } from "../../audio/AudioEngine.ts";
import { useStore } from "../store.ts";
import { useModel } from "../useModel.ts";
import { presetOf, PRESETS, type BodyMix } from "../body.ts";
import { V } from "../colors.ts";
import { NEUTRAL, planUtterance, restTip, tokenizeIpa, type HumanArtic } from "../../wasm/engine.ts";
import type { BodyName } from "../../worklet/protocol.ts";
import { usePhosphor } from "../usePhosphor.ts";
import { TEXT } from "../colors.ts";
import { beamPts, dot, label, labelBlock, seg, type Pt } from "../render/vector.ts";

/** what the page shows: one thing at a time */
type Tab = "pitch" | "breath" | "folds" | "tone" | "mouth";
const TAB_KEY = "chimera.mic.tab";
const loadTab = (): Tab => {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t === "mouth" || t === "folds" || t === "breath" || t === "tone" ? t : "pitch";
  } catch {
    return "pitch";
  }
};

/** The level of the note being sung over its own time, ±6 dB around its middle. */
function LevelTrace(props: { get: () => { t: readonly number[]; db: readonly number[] } | null }) {
  const getRef = useRef(props.get);
  getRef.current = props.get;
  const ref = usePhosphor(({ ctx, w, h }) => {
    const x0 = 34, x1 = w - 10, mid = h / 2, half = h / 2 - 16;
    seg(ctx, x0, mid, x1, mid, V.blueDim, 0.8, { dash: [2, 5], alpha: 0.8 });
    label(ctx, "+6", 6, mid - half + 4, { size: 9, color: TEXT.secondary, ls: 0.1 });
    label(ctx, "−6", 6, mid + half + 4, { size: 9, color: TEXT.secondary, ls: 0.1 });
    label(ctx, "dB", 6, mid + 4, { size: 9, color: TEXT.secondary, ls: 0.1 });
    const tr = getRef.current();
    if (!tr || tr.t.length < 2) {
      labelBlock(ctx, "唱一个长音，这里画出音量的走势：越平越稳", (x0 + x1) / 2 - (x1 - x0) / 2 + 8, mid - 18, x1 - x0 - 16, { size: 11, color: TEXT.secondary, ls: 0.05 });
      return;
    }
    const sorted = Array.from(tr.db).sort((a, b) => a - b);
    const m = sorted[sorted.length >> 1];
    const span = Math.max(5, tr.t[tr.t.length - 1]);
    const pts: Pt[] = [];
    for (let i = 0; i < tr.t.length; i++) pts.push([x0 + (tr.t[i] / span) * (x1 - x0), mid - (Math.max(-6, Math.min(6, tr.db[i] - m)) / 6) * half]);
    beamPts(ctx, pts, V.green, 1.5, { hot: true });
    for (let sec = 1; sec <= span; sec++) {
      if (span > 12 && sec % 5) continue;
      const x = x0 + (sec / span) * (x1 - x0);
      seg(ctx, x, h - 12, x, h - 8, V.blueDim, 1);
      label(ctx, String(sec), x, h - 1, { size: 8, color: TEXT.secondary, align: "center", ls: 0 });
    }
  });
  return <canvas ref={ref} className="instrument-canvas" aria-label="这口气的音量随时间的走势" role="img" />;
}

/**
 * The pitch over the last ten seconds on a staff of semitones (15 of them, following the voice),
 * with the remembered take's note as a dashed line.
 */
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
function PitchTrace(props: { get: () => { t: readonly number[]; m: readonly number[] } | null; refMidi: number | null; current: () => number | null }) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const view = useRef<number | null>(null);
  const ref = usePhosphor(({ ctx, w, h, now, dt }) => {
    const x0 = 30, x1 = w - 8, top = 10, bot = h - 20, span = 10, half = 7.5;
    const { get, refMidi, current } = propsRef.current;
    const singing = current();
    const tr = get();
    const tNow = now / 1000;
    // the staff follows the voice: the median of the last three seconds, at once when it leaps
    const recent: number[] = [];
    if (tr) for (let i = tr.t.length - 1; i >= 0 && tr.t[i] > tNow - 3; i--) if (!Number.isNaN(tr.m[i])) recent.push(tr.m[i]);
    if (recent.length > 5) {
      recent.sort((a, b) => a - b);
      const med = recent[recent.length >> 1], v = view.current;
      view.current = v === null || Math.abs(med - v) > 5 ? med : v + (med - v) * Math.min(1, dt / 0.8);
    }
    const c = view.current ?? refMidi ?? 64;
    const y = (m: number) => top + (bot - top) * (0.5 - (m - c) / (2 * half));
    for (let m = Math.ceil(c - half); m <= Math.floor(c + half); m++) {
      const pc = ((m % 12) + 12) % 12, nat = NATURAL.includes(pc), yy = y(m);
      // the note being sung: its line lit, and named even when it is a black key
      if (m === singing) seg(ctx, x0, yy, x1, yy, V.blue, 1.2);
      else seg(ctx, x0, yy, x1, yy, pc === 0 ? V.blueMid : V.blueDim, 0.8, nat ? { alpha: pc === 0 ? 1 : 0.75 } : { alpha: 0.45, dash: [2, 5] });
      if (nat || m === singing) label(ctx, noteOf(m), 3, yy + 3, { size: 9, color: m === singing ? V.blue : TEXT.secondary, ls: 0.05 });
    }
    if (refMidi !== null && Math.abs(refMidi - c) < half) {
      seg(ctx, x0, y(refMidi), x1, y(refMidi), V.white, 1, { dash: [6, 5], alpha: 0.8 });
      // at the old end, where the voice now is not
      label(ctx, "参考", x0 + 4, y(refMidi) - 4, { size: 9, color: V.white, ls: 0.05 });
    }
    label(ctx, "10 秒前", x0, h - 4, { size: 9, color: TEXT.secondary, ls: 0.05 });
    label(ctx, "现在", x1, h - 4, { size: 9, color: TEXT.secondary, align: "right", ls: 0.05 });
    if (!tr || !tr.t.length || tr.t[tr.t.length - 1] < tNow - span) {
      labelBlock(ctx, "唱几个音，这里画出音高：越贴着横线越准，波浪是颤音", x0 + 8, (top + bot) / 2, x1 - x0 - 16, { size: 11, color: TEXT.secondary, ls: 0.05 });
      return;
    }
    let pts: Pt[] = [];
    const flush = () => {
      if (pts.length > 1) beamPts(ctx, pts, V.amber, 1.6, { hot: true });
      else if (pts.length === 1) dot(ctx, pts[0][0], pts[0][1], 1.5, V.amber);
      pts = [];
    };
    let prev = NaN;
    for (let i = 0; i < tr.t.length; i++) {
      const t = tr.t[i], m = tr.m[i];
      if (t < tNow - span) continue;
      // a break in the voice, or a leap off the staff: the line lifts
      if (Number.isNaN(m) || Math.abs(m - prev) > 3) flush();
      if (!Number.isNaN(m)) pts.push([x1 - ((tNow - t) / span) * (x1 - x0), clamp(y(m), top, bot)]);
      prev = m;
    }
    flush();
  });
  return <canvas ref={ref} className="instrument-canvas" aria-label="最近 10 秒的音高曲线" role="img" />;
}

/** what the sound decides */
const KEYS = ["tbX", "tbY", "jaw", "lipAp", "lipProt", "lipWidth", "root", "larynx", "ttCurl"] as const;
type Pose = Partial<HumanArtic>;
const rest = (): Pose => Object.fromEntries(KEYS.map((k) => [k, NEUTRAL[k]]));

const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const noteName = (hz: number) => {
  const m = Math.round(69 + 12 * Math.log2(hz / 440));
  return NOTES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
};
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** The tongue, jaw and lips the planner gives a consonant between two /ɑ/ on this body. */
function consonantPose(ipa: string, body: BodyMix): Pose {
  const plan = planUtterance(tokenizeIpa(`ɑ${ipa}ɑ`), { body, t0: 0 });
  const out: Pose = {};
  for (const g of plan.gestures) {
    if (g.label !== ipa) continue;
    for (const [k, v] of Object.entries(g.targets)) if (k in NEUTRAL && v !== undefined) out[k as keyof HumanArtic] = v;
  }
  return out;
}

/** The singer's three reference vowels mapped onto this body's own (null: no usable calibration). */
function affineFor(cal: Calibration | null, m: VoiceModel): Affine | null {
  if (!cal) return null;
  const to = REFS.map((r) => m.vowels.find((v) => v.ipa === r.ipa));
  if (to.some((v) => !v)) return null;
  return fitAffine(cal, to.map((v) => ({ F1: v!.F1, F2: v!.F2 })) as Calibration);
}

/** A closure the singer chose to remember: the closed share of the cycle, and the note it was sung on. */
interface ClosureRef {
  /** the closed share, % (absent when the take had no readable vowel: a hum, say) */
  closed?: number;
  f0: number;
  /** how loud it was, dBFS: a reading only compares with one sung about as loud */
  level?: number;
  /** how much the level wandered, dB, and how the note began, when they were known */
  sd?: number;
  onset?: OnsetKind;
  /** the note's centre (MIDI), how its centre wandered (cents) and its vibrato (null: none), when read */
  midi?: number;
  wobble?: number;
  vib?: Vibrato | null;
  /** the tone tab's brightness (dB), the vowel it was read on, and how loud that sound was (dB) */
  bright?: number;
  brightVowel?: string;
  brightLevel?: number;
  /** the vowel's first two formants then (Hz): two takes are the same vowel when these are close */
  brightFormants?: { F1: number; F2: number };
}
/** the reference's note as the pitch tab named it (its centre), else from the closure take's pitch */
const refNote = (r: ClosureRef) => (r.midi != null ? noteOf(r.midi) : noteName(r.f0));
const ONSET_WORD: Record<OnsetKind, string> = { soft: "软起音", hard: "硬起音", breathy: "气起音" };
const ONSET_HINT: Record<OnsetKind, string> = { soft: "气和声同时到", hard: "声带先闭紧再撞开", breathy: "先漏气再出声" };
/** off from the nearest semitone, in words; the bands (±10, ±25 cents) are rules of thumb */
const centsText = (c: number) => {
  const r = Math.round(c), a = Math.abs(r);
  return a <= 10 ? `准（${r >= 0 ? "+" : "−"}${a} 音分）` : `${a <= 25 ? "略" : ""}${r > 0 ? "偏高" : "偏低"} ${a} 音分`;
};
const wobbleWord = (w: number) => (w <= 6 ? "很稳" : w <= 15 ? "较稳" : "晃动明显");
const vibText = (v: Vibrato) => `每秒 ${v.rate.toFixed(1)} 次 · 上下 ±${Math.round(v.extent)} 音分${v.rate < 4.5 ? "（偏慢，像在摇）" : v.rate > 7.5 ? "（偏快，像在抖）" : ""}`;
const REF_KEY = "chimera.mic.closureRef";
function loadClosureRef(): ClosureRef | null {
  try {
    const r = JSON.parse(localStorage.getItem(REF_KEY) ?? "null") as ClosureRef | null;
    return r && r.f0 > 0 && ((r.closed ?? 0) > 0 || (r.midi ?? 0) > 0 || typeof r.bright === "number") ? r : null;
  } catch {
    return null;
  }
}
/**
 * How far the folds are stretched, 0…1, from the pitch alone: a voice climbs mostly by lengthening
 * and thinning its folds, about half as long again from the bottom of its range to the top. The
 * ranges are a typical voice's of each kind, not the singer's own.
 */
const RANGE: Record<"male" | "female" | "child", [number, number]> = { male: [82, 440], female: [165, 880], child: [220, 1050] };
function stretchOf(f0: number, body: BodyMix, own: [number, number] | null = null): number {
  const [lo, hi] = own ?? RANGE[body.child > 0.5 ? "child" : body.female > 0.5 ? "female" : "male"];
  return clamp(Math.log2(f0 / lo) / Math.log2(hi / lo), 0, 1);
}

/** her long breaths over the days (src/mic/history.ts) */
const HISTORY_KEY = "chimera.mic.breaths";
function loadHistory(): BreathRecord[] {
  try {
    return parseRecords(localStorage.getItem(HISTORY_KEY));
  } catch {
    return [];
  }
}

/** the singer's own lowest and highest notes (Hz), once she has sung them */
const RANGE_KEY = "chimera.mic.range";
function loadRange(): [number, number] | null {
  try {
    const r = JSON.parse(localStorage.getItem(RANGE_KEY) ?? "null") as [number, number] | null;
    return Array.isArray(r) && r[0] > 40 && r[1] > r[0] * 1.5 ? r : null;
  } catch {
    return null;
  }
}

/** the closed share's scale on the meter, % */
const CLOSED_LO = 12, CLOSED_HI = 60;
const closedWord = (c: number) => (c < 26 ? "偏松：每个周期合拢的时间短，容易漏气、声音发虚" : c <= 40 ? "适中：合拢和张开比较均衡" : "偏紧：合拢时间长，声音集中；再紧就是挤着唱");

const KIND_TEXT: Record<Kind, string> = {
  silence: "正在听… 唱一个音，图会跟着动。",
  vowel: "",
  held: "有声音，但这个音的口型认不出来（鼻音 m / n / ng、太高的音会这样），图停在上一个口型。",
  s: "齿音（s / c / z 一类）：舌尖靠近上齿龈，气流从缝里挤出去。",
  sh: "舌面音（sh / x 一类）：舌面抬起靠近硬腭。",
  breath: "气声（h / f 一类）：声带打开，只有气流。",
};

export function MicPage() {
  const model = useModel();
  const body = useStore((s) => s.body);
  const setBody = useStore((s) => s.setBody);
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [heard, setHeard] = useState<Heard>(QUIET);
  const mic = useRef<MicListener | null>(null);
  if (!mic.current) mic.current = new MicListener();
  const heardRef = useRef<Heard>(QUIET);
  // the singer's reference vowels (kept on this device), and a calibration in progress
  const [cal, setCal] = useState<Calibration | null>(() => loadCalibration());
  const calRef = useRef(cal);
  calRef.current = cal;
  const [calStep, setCalStep] = useState<number | null>(null);
  const [calProgress, setCalProgress] = useState(0);
  const [calMsg, setCalMsg] = useState<string | null>(null);
  // how the folds close: the closed share of the cycle now (%, null when no vowel sounds), and one to compare with
  const [closed, setClosed] = useState<number | null>(null);
  const closedRef = useRef<number | null>(null);
  const shownClosed = useRef<number | null>(null);
  const nowMark = useRef<HTMLElement | null>(null);
  const levelRef = useRef<number | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [mark, setMark] = useState<ClosureRef | null>(() => loadClosureRef());
  // her own range for the stretch, and one being recorded: the lowest and highest notes she holds
  const [range, setRange] = useState<[number, number] | null>(() => loadRange());
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const [ranging, setRanging] = useState<[number, number] | null>(null);
  const rangeRun = useRef<RangeRecorder | null>(null);
  // a glide recorded for its register breaks: in progress, or what it read
  const [glide, setGlide] = useState<GlideState | null>(null);
  const glideRun = useRef<GlideRecorder | null>(null);
  const sessionRef = useRef<MicSession | null>(null);
  // the breath under the note in progress (or the last one), and how that note began
  const [steady, setSteady] = useState<Steadiness | null>(null);
  const steadyRef = useRef<Steadiness | null>(null);
  const [onset, setOnset] = useState<Onset | null>(null);
  const onsetRef = useRef<Onset | null>(null);
  // the note now (its centre, vibrato averaged out) and the note in progress or the last one held
  const [centre, setCentre] = useState<number | null>(null);
  const shownCentre = useRef<number | null>(null);
  // the note named: it changes only once the voice is 60 cents from it, so a note sung half a
  // semitone off is not named by turns as itself and its neighbour
  const [shownNote, setShownNote] = useState<number | null>(null);
  const shownNoteRef = useRef<number | null>(null);
  const centsMark = useRef<HTMLElement | null>(null);
  const [pitchNote, setPitchNote] = useState<NoteReading | null>(null);
  const [pitchLive, setPitchLive] = useState(false);
  // the held sound's brightness now, or the last one read (kept after the sound stops)
  const [tone, setTone] = useState<ToneTake | null>(null);
  const [toneLive, setToneLive] = useState(false);
  const lastTone = useRef<ToneTake | null>(null);
  const lastPitchAt = useRef(-1e9);
  // a word of confirmation (remembered), for a moment
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef(0);
  const say = (msg: string) => {
    setFlash(msg);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 3000);
  };
  // The airflow simulation: the engine singing along, muted, to light the head and the tube with
  // pressure and flow. Off unless asked for: it is by far the heaviest thing on the page, and
  // every reading works without it.
  const [sim, setSim] = useState<boolean>(() => {
    try {
      return localStorage.getItem("chimera.mic.sim") === "1";
    } catch {
      return false;
    }
  });
  const simRef = useRef(sim);
  simRef.current = sim;
  const toggleSim = () => {
    const next = !sim;
    setSim(next);
    simRef.current = next;
    try {
      localStorage.setItem("chimera.mic.sim", next ? "1" : "0");
    } catch {
      // not remembered
    }
    const st = useStore.getState();
    if (next) {
      // in this tap: iOS resumes audio only inside one
      if (on) void st.start().then(() => useStore.getState().setVolume(0));
    } else {
      st.setHold(false);
      void engine.sleep();
    }
  };
  const [fps, setFps] = useState(60);
  // no sound arriving (the audio's state then), or null
  const [deaf, setDeaf] = useState<string | null>(null);
  const deafRef = useRef<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => loadTab());
  // rhythm practice: its own page, off this one
  const [rhythm, setRhythm] = useState(false);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  // her long breaths, kept on the phone: each one that ends is added
  const [history, setHistory] = useState<BreathRecord[]>(() => loadHistory());
  const historyRef = useRef(history);
  const keepBreath = (s: Steadiness | null) => {
    const r = recordOf(s, Date.now());
    if (!r) return;
    const list = historyRef.current;
    const best = list.length > 0 && r.seconds > Math.max(...list.map((x) => x.seconds));
    const next = addRecord(list, r);
    historyRef.current = next;
    setHistory(next);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      // private browsing: kept until the page closes
    }
    if (tabRef.current === "breath") say(`${best ? "新纪录！" : ""}这口气 ${r.seconds.toFixed(1)} 秒，已记进历史。`);
  };
  const clearHistory = () => {
    historyRef.current = [];
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // nothing to remove
    }
    say("历史记录已清除。");
  };
  const pickTab = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // not remembered
    }
  };
  // the last note's readings stay good for a few seconds, so "remember this" can be tapped after it ends
  const lastTake = useRef<{ at: number; closed: number; f0: number; level: number | null } | null>(null);
  const [canRemember, setCanRemember] = useState(false);
  const run = useRef<CalibrationRun | null>(null);
  const calStepRef = useRef(calStep);
  calStepRef.current = calStep;

  // a woman's tract by default, in Play (the breath is ours to gate), muted: the microphone would hear it
  useEffect(() => {
    const st = useStore.getState();
    st.setMode("play");
    st.setVolume(0);
    st.setSource({ vibratoDepth: 0, drift: 0, roughness: 0, glide: 0.03 });
    setBody(PRESETS.female);
    st.setArtic({ ...rest() }, true);
    return () => {
      mic.current?.stop();
      useStore.getState().setHold(false);
    };
  }, [setBody]);

  useEffect(() => {
    if (!on) return;
    const listener = mic.current!;
    const poses = { s: consonantPose("s", body), sh: consonantPose("ɕ", body) };
    let raf = 0;
    let last = performance.now();
    let shown = 0;
    let sentF0 = 0, sentBreath = -1, sentVoiced = true;
    const session = new MicSession();
    session.ranging = rangeRun.current;
    session.gliding = glideRun.current;
    sessionRef.current = session;
    // the fallback's own pose (no engine): eased here, tip and all
    const pose: Record<string, number> = { ...useStore.getState().artic };
    let target: Pose = rest();
    let tipFree = true;
    let frames = 0, framesSince = performance.now();
    let noteAwaySince: number | null = null;
    let seenBreaths = 0;
    // the vowels heard over the last second, for naming the held sound's vowel
    const vowels: { t: number; v: string; F1: number; F2: number }[] = [];
    let lastAudio = performance.now();
    let affine: Affine | null = null, affineOf: Calibration | null | undefined = undefined, affineModel: VoiceModel | null = null;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const fr = listener.read();
      const m = model.current;
      if (!fr || !m) return;
      // digital silence means no sound is arriving at all (a room is never that quiet): the
      // browser is holding the audio back, or something else has the microphone
      if (fr.level > -110) lastAudio = now;
      deafRef.current = now - lastAudio > 2000 ? listener.state : null;
      const st = useStore.getState();
      session.voice = st.body.female < 0.5 && st.body.child < 0.5 ? "male" : "female";
      const h = session.step(now, dt, { fr, glottal: listener.glottal, bands: listener.bands }, () => listener.recent());
      heardRef.current = h;
      const kind = h.kind;
      // a calibration in progress: each reference vowel, held for a while, after a pause
      const c = run.current;
      if (c) {
        const f = fr.formants;
        const own = kind === "vowel" && fr.voiced && f.length >= 2 && f[0] < 1300 && f[1] > f[0] + 150 && f[1] < 3600 ? { F1: f[0], F2: f[1] } : null;
        const done = c.feed(own, kind === "silence", dt);
        if (done) {
          const bad = calibrationProblem(done) ?? (affineFor(done, m) ? null : "三个音太接近，无法校准，请重录。");
          run.current = null;
          setCalStep(null);
          if (bad) setCalMsg(bad);
          else {
            saveCalibration(done);
            setCal(done);
            setCalMsg("校准完成。之后的口型按你的声音来推断。");
          }
        } else if (c.step !== calStepRef.current) setCalStep(c.step);
      }
      // the singer's vowels land where this body has them
      if (affineOf !== calRef.current || affineModel !== m) {
        affineOf = calRef.current;
        affineModel = m;
        affine = affineFor(affineOf, m);
      }
      if (kind === "vowel") {
        const p = affine ? applyAffine(affine, h) : h;
        target = { ...rest(), ...m.articForFormants(p.F1, p.F2) };
        vowels.push({ t: now, v: nearestVowel(m, p.F1, p.F2), F1: p.F1, F2: p.F2 });
        tipFree = true;
      } else if (kind === "s" || kind === "sh") {
        target = { ...rest(), ...poses[kind] };
        tipFree = false;
      } else if (kind === "silence") {
        target = rest();
        tipFree = true;
      }

      // the folds, the breath and the onset are the session's (src/mic/session.ts)
      const oq = session.oq;
      closedRef.current = session.closed;
      // what is shown glides toward the reading (which steps), every frame
      const cNow = session.closed;
      shownClosed.current = cNow === null ? null : shownClosed.current === null ? cNow : shownClosed.current + (cNow - shownClosed.current) * Math.min(1, dt / 0.25);
      if (nowMark.current) {
        const sc = shownClosed.current;
        nowMark.current.style.opacity = sc === null ? "0" : "1";
        if (sc !== null) nowMark.current.style.left = `${clamp(((sc - CLOSED_LO) / (CLOSED_HI - CLOSED_LO)) * 100, 0, 100)}%`;
      }
      levelRef.current = session.level;
      steadyRef.current = session.steady;
      onsetRef.current = session.onset;
      if (session.breathsEnded !== seenBreaths) {
        seenBreaths = session.breathsEnded;
        keepBreath(session.endedBreath);
      }
      // the pitch needle glides too (a new note jumps there)
      const pc = session.pitch.centre, ps = shownCentre.current;
      // the take's note: the pitch tab's centre (one frame's pitch swings with the vibrato)
      if (session.closed !== null && h.f0 > 0) lastTake.current = { at: now, closed: session.closed, f0: pc !== null ? 440 * 2 ** ((pc - 69) / 12) : h.f0, level: session.level };
      shownCentre.current = pc === null ? null : ps === null || Math.abs(pc - ps) > 0.5 ? pc : ps + (pc - ps) * Math.min(1, dt / 0.08);
      // the named note holds through small crossings of the boundary (no flicker), and moves when the
      // centre is clearly past it, or has stayed past it for a quarter second (the first name was a coin toss)
      const sc = shownCentre.current, sn = shownNoteRef.current;
      const off = sc === null || sn === null ? 0 : Math.abs(sc - sn);
      if (off <= 0.5) noteAwaySince = null;
      else noteAwaySince ??= now;
      if (sc === null) shownNoteRef.current = null;
      else if (sn === null || off > 0.6 || (noteAwaySince !== null && now - noteAwaySince >= 250)) {
        shownNoteRef.current = Math.round(sc);
        noteAwaySince = null;
      }
      if (centsMark.current) {
        centsMark.current.style.opacity = sc === null ? "0" : "1";
        if (sc !== null) centsMark.current.style.left = `${clamp(50 + (sc - shownNoteRef.current!) * 100, 0, 100)}%`;
      }
      if (session.pitch.note && sc !== null) lastPitchAt.current = now;
      // the tone: the held sound's brightness, the vowel heard most over its second, its note and level
      while (vowels.length && vowels[0].t < now - 1000) vowels.shift();
      const bright = session.tone.brightness;
      if (bright !== null) {
        const count = new Map<string, number>();
        for (const { v } of vowels) count.set(v, (count.get(v) ?? 0) + 1);
        let vowel: string | null = null, most = 0;
        for (const [v, c] of count) if (c > most) [vowel, most] = [v, c];
        const mid = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1];
        const formants = vowels.length >= 5 ? { F1: mid(vowels.map((q) => q.F1)), F2: mid(vowels.map((q) => q.F2)) } : null;
        lastTone.current = { at: now, bright, vowel, formants, level: session.tone.level!, midi: pc ?? (h.f0 > 0 ? midiOf(h.f0) : null) };
      }

      const sounding = kind !== "silence";
      const voicedNow = kind === "vowel" || kind === "held";
      if (simRef.current && st.started) {
        // the engine sings what was heard, muted: its telemetry draws the head and the tube
        if (st.hold !== sounding) st.setHold(sounding);
        if (sounding && voicedNow && h.f0 > 0) {
          const breath = clamp(0.1 + (0.97 - h.clarity) * 2.2, 0.05, 0.9);
          if (!sentVoiced || Math.abs(h.f0 - sentF0) > sentF0 * 0.003 || Math.abs(breath - sentBreath) > 0.04) {
            st.setSource({ voiced: true, f0: clamp(h.f0, 60, 1200), breathiness: breath });
            sentF0 = h.f0;
            sentBreath = breath;
            sentVoiced = true;
          }
        } else if (sounding && !voicedNow && sentVoiced) {
          st.setSource({ voiced: false });
          sentVoiced = false;
        }
        st.setArtic(target, tipFree);
      } else {
        // no engine: ease the drawing ourselves (the jaw and tongue body take some tens of ms)
        const ease = 1 - Math.exp(-dt / 0.07);
        const tip = tipFree || target.ttX === undefined || target.ttY === undefined ? null : { x: target.ttX, y: target.ttY };
        for (const key of KEYS) pose[key] += ((target[key] ?? NEUTRAL[key]) - pose[key]) * ease;
        const goal = tip ?? restTip(pose.jaw, pose.tbX, pose.tbY);
        pose.ttX += (goal.x - pose.ttX) * (tip ? ease : 1);
        pose.ttY += (goal.y - pose.ttY) * (tip ? ease : 1);
        st.setArtic({ ...pose }, true);
      }
      frames++;
      if (now - framesSince >= 1000) {
        setFps(Math.round((frames * 1000) / (now - framesSince)));
        frames = 0;
        framesSince = now;
      }
      if (now - shown > 150) {
        shown = now;
        setHeard(heardRef.current);
        setCalProgress(run.current ? run.current.progress : 0);
        setDeaf(deafRef.current);
        setClosed(shownClosed.current);
        setLevel(levelRef.current);
        setCanRemember((!!lastTake.current && now - lastTake.current.at < 4000) || now - lastPitchAt.current < 4000 || (!!lastTone.current && now - lastTone.current.at < 4000));
        setTone(lastTone.current);
        setToneLive(!!lastTone.current && now - lastTone.current.at < 400);
        setSteady(steadyRef.current);
        setOnset(onsetRef.current);
        setCentre(shownCentre.current);
        setShownNote(shownNoteRef.current);
        setPitchNote(session.pitch.note);
        setPitchLive(session.pitch.noteLive);
        const r = rangeRun.current;
        if (r && r.hi > 0) setRanging([r.lo, r.hi]);
        // a glide: over once she stops (the recorder decides), or its notes so far
        const g = glideRun.current;
        if (g?.done) finishGlide();
        else if (g && g.points.length >= 5) {
          const ms = g.points.map((p) => p.midi).sort((p, q) => p - q);
          setGlide({ recording: true, lo: ms[Math.floor(ms.length * 0.05)], hi: ms[Math.floor(ms.length * 0.95)] });
        }
      }
    };
    raf = requestAnimationFrame(loop);
    // any touch gives the browser leave to run the audio, if it was holding it back
    const touch = () => listener.wake();
    document.addEventListener("pointerdown", touch);
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      listener.wake();
      if (simRef.current) void engine.start().catch(() => {});
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", wake);
      document.removeEventListener("pointerdown", touch);
    };
  }, [on, model, body]);

  const toggle = async (): Promise<boolean> => {
    const listener = mic.current!;
    const st = useStore.getState();
    if (on) {
      run.current = null;
      setCalStep(null);
      // a breath still going when she stops counts as ended here, and so does a glide
      const s = sessionRef.current;
      if (s?.breathSounding) keepBreath(s.steady);
      finishGlide();
      listener.stop();
      st.setHold(false);
      setOn(false);
      setHeard(QUIET);
      heardRef.current = QUIET;
      // the live needles go; what was read (the last note, the breath) stays
      shownCentre.current = shownNoteRef.current = shownClosed.current = null;
      setCentre(null);
      setShownNote(null);
      setClosed(null);
      setPitchLive(false);
      setToneLive(false);
      setCanRemember(false);
      if (centsMark.current) centsMark.current.style.opacity = "0";
      if (nowMark.current) nowMark.current.style.opacity = "0";
      st.setArtic({ ...rest() }, true);
      return false;
    }
    setError(null);
    setCalMsg(null);
    setNote(null);
    // with the airflow simulation on: the engine first, in this tap (iOS resumes audio only inside
    // one), then a session that records too
    const started = simRef.current ? st.start() : null;
    try {
      await listener.start();
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      const msg = e instanceof Error ? e.message : String(e);
      setError(name === "NotAllowedError" ? "麦克风被拒绝。请在 设置 → Safari → 麦克风 里允许，然后重试。" : msg === "insecure" ? "需要通过 https 打开才能用麦克风。" : name === "NotFoundError" ? "没有找到麦克风。" : `无法启动麦克风：${msg}`);
      return false;
    }
    if (started) {
      await started;
      const now = useStore.getState();
      now.setVolume(0);
      if (!now.started) setNote("气流模拟没能启动，头部口型仍然可用。");
    }
    setOn(true);
    return true;
  };

  /** Start (or abandon) a calibration; the microphone starts first if it isn't on. */
  const calibrate = async () => {
    if (run.current) {
      run.current = null;
      setCalStep(null);
      setCalMsg(null);
      return;
    }
    if (!on && !(await toggle())) return;
    setCalMsg(null);
    run.current = new CalibrationRun();
    setCalProgress(0);
    setCalStep(0);
  };
  /** Record her range (the microphone starts first if it isn't on), or finish and keep it. */
  const recordRange = async () => {
    const r = rangeRun.current;
    if (r) {
      rangeRun.current = null;
      if (sessionRef.current) sessionRef.current.ranging = null;
      setRanging(null);
      // less than a fifth isn't a range: keep what there was
      const mine = r.range;
      if (mine) {
        try {
          localStorage.setItem(RANGE_KEY, JSON.stringify(mine));
        } catch {
          // private browsing: kept until the page closes
        }
        setRange(mine);
      }
      return;
    }
    if (!on && !(await toggle())) return;
    rangeRun.current = new RangeRecorder();
    if (sessionRef.current) sessionRef.current.ranging = rangeRun.current;
    setRanging([0, 0]);
  };
  /** Record a glide for its register breaks (the microphone starts first if it isn't on), or finish it now. */
  const recordGlide = async () => {
    if (glideRun.current) {
      finishGlide();
      return;
    }
    if (!on && !(await toggle())) return;
    glideRun.current = new GlideRecorder();
    if (sessionRef.current) sessionRef.current.gliding = glideRun.current;
    setGlide({ recording: true, lo: null, hi: null });
  };
  /** The glide in progress, read (when there is one). */
  const finishGlide = () => {
    const r = glideRun.current;
    if (!r) return;
    glideRun.current = null;
    const s = sessionRef.current;
    if (s) s.gliding = null;
    const voice = s?.voice ?? "female", sampleRate = mic.current?.sampleRate || 48000;
    setGlide({ recording: false, glide: r.span >= 1.5 ? findBreaks(r.points, voice, sampleRate) : null, span: r.span, fps: r.span > 0 ? r.points.length / r.span : 0, sampleRate, voice });
  };
  const forgetRange = () => {
    try {
      localStorage.removeItem(RANGE_KEY);
    } catch {
      // nothing to remove
    }
    setRange(null);
  };
  // the note being sung by name, steadied like the pitch tab's (raw pitch flips names on a vibrato near a boundary)
  const nameNow = (hz: number) => (shownNoteRef.current !== null ? noteOf(shownNoteRef.current) : noteName(hz));
  const remember = () => {
    const now = performance.now();
    const t = lastTake.current && now - lastTake.current.at <= 4000 ? lastTake.current : null;
    const p = now - lastPitchAt.current <= 4000 ? sessionRef.current?.pitch.note ?? null : null;
    const tn = lastTone.current && now - lastTone.current.at <= 4000 ? lastTone.current : null;
    const midi = p?.midi ?? tn?.midi ?? null;
    if (!t && midi === null) return;
    const f0 = t?.f0 ?? 440 * 2 ** ((midi! - 69) / 12);
    const r: ClosureRef = { closed: t?.closed, f0, level: t?.level ?? undefined, sd: steadyRef.current?.sd ?? undefined, onset: onsetRef.current?.kind, midi: p?.midi, wobble: p?.wobble ?? undefined, vib: p && p.seconds >= 1.1 ? p.vibrato : undefined, bright: tn?.bright, brightVowel: tn?.vowel ?? undefined, brightLevel: tn?.level, brightFormants: tn?.formants ?? undefined };
    say(`已记为参考（${refNote(r)}${r.closed != null ? ` · 闭合 ${Math.round(r.closed)}%` : ""}）。各页读数下面的“参考”就是这一次。`);
    try {
      localStorage.setItem(REF_KEY, JSON.stringify(r));
    } catch {
      // private browsing: kept until the page closes
    }
    setMark(r);
  };
  const forget = () => {
    try {
      localStorage.removeItem(REF_KEY);
    } catch {
      // nothing to remove
    }
    setMark(null);
    say("参考已清除。");
  };
  const clearCalibration = () => {
    saveCalibration(null);
    setCal(null);
    setCalMsg("已清除校准，恢复为标准模型。");
  };

  const info: InfoFn = (_m, f, tele) => {
    const h = heardRef.current;
    const lines = [`声道长 ${f.length.toFixed(1)} 厘米`, `口开 ${f.lipArea.toFixed(1)} cm²`];
    if (h.kind === "vowel") lines.push(`实测 F1 ${Math.round(h.F1)}`, `实测 F2 ${Math.round(h.F2)} Hz`);
    if (h.f0 > 0) lines.push(`音高 ${nameNow(h.f0)}`);
    if (tele && tele.t.pLung > 0.2) lines.push(`肺压 ${tele.t.pLung.toFixed(1)} cmH₂O`);
    return lines;
  };
  const slots: SlotsFn = (m, a, f, formants) => {
    const k = heardRef.current.kind;
    const tongue = k === "s" ? { label: "舌位", value: "s", color: V.green, ipa: true } : k === "sh" ? { label: "舌位", value: "ɕ", color: V.green, ipa: true } : formants.length >= 2 ? { label: "舌位", value: nearestVowel(m, formants[0], formants[1]), color: V.green, ipa: true } : { label: "舌位", value: "-", color: V.green };
    return [
      tongue,
      { label: "下巴", value: a.jaw.toFixed(1), unit: "厘米", color: V.red },
      { label: "嘴唇", value: a.lipAp.toFixed(1), unit: "厘米", color: V.pink },
      f.velumPort > 0.02 ? { label: "软腭", value: f.velumPort.toFixed(2), unit: "cm²", color: V.white } : { label: "软腭", value: "关", color: V.white },
    ];
  };

  // louder or softer than the remembered take, dB (the closure reads differently by loudness)
  const loudGap = mark?.level != null && level !== null ? level - mark.level : null;
  const pos = (c: number) => clamp(((c - CLOSED_LO) / (CLOSED_HI - CLOSED_LO)) * 100, 0, 100);
  const high = heard.kind !== "silence" && heard.f0 > 450;
  const ref = calStep !== null ? REFS[calStep] : null;
  // what the bottom line says while listening: the mouth tab's own detail there, a plain word elsewhere
  const listening = tab === "mouth" ? (heard.kind === "vowel" ? `${nameNow(heard.f0)}${high ? "：音太高时口型测不准，仅供参考。" : ` · 实测共振峰 F1 ${Math.round(heard.F1)} · F2 ${Math.round(heard.F2)} Hz`}` : KIND_TEXT[heard.kind]) : heard.kind === "silence" ? "正在听… 唱一个音。" : heard.kind === "vowel" || heard.kind === "held" ? "正在听。" : "听到辅音或气声：没有音高。";
  const status = error ?? flash ?? (on && deaf ? (deaf === "running" ? "没有收到声音：麦克风可能被别的应用占用（电话、录音、其他网页）。关掉它们，再点“停止”后重新“开始听”。" : "音频被系统暂停了：点一下屏幕任意位置即可恢复。") : ref ? `校准 ${calStep! + 1} / ${REFS.length}：用舒服的中低音唱“${ref.char}——”（${ref.hint}），保持约 2 秒。${heard.f0 > 350 ? "音有点高，低一些更准。" : ""}` : calMsg && heard.kind === "silence" ? calMsg : !on ? "点“开始听”，对着手机唱。长元音（啊、一、乌…）最清楚。" : listening);
  const refLine = mark ? `参考：${mark.closed != null ? `闭合 ${Math.round(mark.closed)}%（${refNote(mark)}）` : `${refNote(mark)}（那次没读到闭合）`}${mark.sd != null ? ` · 起伏 ±${mark.sd.toFixed(1)} dB` : ""}${mark.onset ? ` · ${ONSET_WORD[mark.onset]}` : ""}` : null;
  if (rhythm) return <RhythmPage onBack={() => setRhythm(false)} />;
  return (
    <div className="mic-page">
      <header className="mic-top">
        <span className="wordmark">Chimera</span>
        <button
          type="button"
          className="chip mic-rhythm-entry"
          onClick={() => {
            // one microphone at a time: this page stops listening first
            if (on) void toggle();
            setRhythm(true);
          }}
        >
          节奏
        </button>
        <Segmented<BodyName>
          label="声音类型"
          value={presetOf(body)}
          onChange={(b) => setBody(PRESETS[b])}
          options={[
            { value: "female", label: "女声" },
            { value: "male", label: "男声" },
            { value: "child", label: "童声" },
          ]}
        />
      </header>
      <nav className="mic-tabs">
        <Segmented<Tab>
          label="看什么"
          value={tab}
          onChange={pickTab}
          options={[
            { value: "pitch", label: "音准" },
            { value: "breath", label: "气息" },
            { value: "folds", label: "声带" },
            { value: "tone", label: "音色" },
            { value: "mouth", label: "口型" },
          ]}
        />
      </nav>
      <main className={`mic-screens mic-on-${tab}`}>
        {tab === "pitch" && (
          <>
            <section className="mic-card mic-pitch" aria-label="音准">
              <header>
                <h2>音准</h2>
                <span className="mic-pitch-note">{shownNote === null ? "—" : noteOf(shownNote)}</span>
              </header>
              <div className="mic-closure-bar" aria-hidden="true">
                <i className="zone" style={{ left: "40%", width: "20%" }} />
                <i className="mid" />
                <i className="now" ref={centsMark} style={{ opacity: 0 }} />
              </div>
              <div className="mic-closure-scale" aria-hidden="true">
                <span>偏低</span>
                <span>准</span>
                <span>偏高</span>
              </div>
              <p>{centre === null || shownNote === null ? (on ? "唱一个音，这里显示离它最近的音名，以及偏高还是偏低。" : "点下面的“开始听”，然后唱一个音。") : `${centsText(100 * (centre - shownNote))} · ${(440 * 2 ** ((centre - 69) / 12)).toFixed(1)} Hz`}</p>
            </section>
            <Screen className="mic-pitch-trace" title="音高曲线" sub="最近 10 秒 · 横线是半音">
              <PitchTrace get={() => sessionRef.current?.pitch.trace ?? null} refMidi={mark ? mark.midi ?? midiOf(mark.f0) : null} current={() => shownNoteRef.current} />
            </Screen>
            <section className="mic-card mic-breath" aria-label="这个音">
              <header>
                <h2>{pitchNote && !pitchLive ? "上一个长音" : "这个音"}</h2>
                <span className="mic-breath-secs">{pitchNote ? `${pitchNote.seconds.toFixed(1)} 秒` : "—"}</span>
              </header>
              <dl>
                <dt>音高</dt>
                <dd>
                  {pitchNote ? `${noteOf(pitchNote.midi)} · ${centsText(pitchNote.cents)}` : on && fps < MIN_FPS ? `画面太卡（每秒 ${fps} 帧），读不出这个音` : "唱一个长音（1 秒以上）后显示"}
                  {mark?.midi != null && <em>参考 {noteOf(mark.midi)} · {centsText(100 * (mark.midi - Math.round(mark.midi)))}</em>}
                </dd>
                <dt>摆动</dt>
                <dd>
                  {pitchNote?.wobble != null ? `±${Math.round(pitchNote.wobble)} 音分 · ${wobbleWord(pitchNote.wobble)}` : "唱满 1 秒后显示"}
                  {mark?.wobble != null && <em>参考 ±{Math.round(mark.wobble)} 音分</em>}
                </dd>
                <dt>走势</dt>
                <dd>{pitchNote?.drift != null ? (pitchNote.drift <= -10 ? `越唱越低：后段低了 ${Math.round(-pitchNote.drift)} 音分` : pitchNote.drift >= 10 ? `越唱越高：后段高了 ${Math.round(pitchNote.drift)} 音分` : "平稳") : "—"}</dd>
                <dt>颤音</dt>
                <dd>
                  {pitchNote ? (pitchNote.vibrato ? vibText(pitchNote.vibrato) : pitchNote.seconds >= 1.1 ? "没有（直音）" : "音太短，看不出") : "—"}
                  {mark?.vib !== undefined && <em>参考 {mark.vib ? `每秒 ${mark.vib.rate.toFixed(1)} 次 · ±${Math.round(mark.vib.extent)} 音分` : "没有颤音"}</em>}
                </dd>
              </dl>
            </section>
            <details className="mic-help">
              <summary>怎么看</summary>
              <ul>
                <li>
                  <b>音名和偏差</b>：程序不知道你想唱哪个音，只能和离得最近的半音比（按 A4 = 440 Hz 的十二平均律）。1 个半音 = 100 音分；偏差超过 50 音分，就会被认成旁边那个音。指针看的是最近 0.4 秒的平均音高，颤音的上下起伏已经抵消掉了。±10 音分以内算“准”，±25 以内算“略偏”，这个分档是经验值。
                </li>
                <li>
                  <b>音高曲线</b>：横线是半音，标了字母的是钢琴白键上的音（C 那条最亮）。线越贴着横线越准；波浪是颤音。白色虚线是记为参考那次唱的音，想照着找时先唱到这条线上。
                </li>
                <li>
                  <b>这个音</b>：正在唱的音，或上一个唱得够长的音。开头 0.2 秒（起音、往上滑的那一下）和结尾 0.15 秒不算。
                </li>
                <li>
                  <b>摆动</b>：去掉颤音以后，音高中心晃动的幅度。±6 音分以内算很稳，±15 以内算较稳（经验值）。
                </li>
                <li>
                  <b>走势</b>：从这个音开头到结尾，音高中心往哪边走了，差 10 音分以上才提示。长音越唱越低很常见，常和后段气息跟不上有关，可以对照“气息”页的音量走势一起看。
                </li>
                <li>
                  <b>颤音</b>：每秒起伏几次、上下摆多少音分。常见的是每秒 5–7 次；流行唱法幅度多在 ±20–50 音分，美声更宽。慢于 4.5 次听起来像摇，快于 7.5 次像抖（经验值）。没有颤音（直音）不是毛病。音要唱满 1 秒多才看得出。
                </li>
                <li>
                  <b>准不准</b>：用已知答案的合成声音检验过：音高误差 1–3 音分，颤音速度误差 0.2 次/秒以内，幅度误差 10% 以内，画面每秒 20 帧以上都一样。约 A5（880 Hz）以上的音测不出来。真人嗓音和 iPhone 麦克风上还没有系统验证。
                </li>
              </ul>
            </details>
          </>
        )}
        {tab === "tone" && (
          <ToneTab
            tone={tone}
            live={toneLive}
            on={on}
            mark={mark?.bright != null ? { bright: mark.bright, vowel: mark.brightVowel ?? null, formants: mark.brightFormants ?? null, level: mark.brightLevel ?? null, midi: mark.midi ?? midiOf(mark.f0) } : null}
            spectrum={() => sessionRef.current?.tone.spectrum ?? null}
          />
        )}
        {tab === "mouth" && (
          <>
            <Screen className="mic-head" focus label="由麦克风推断的声道剖面">
              <AnatomyView info={info} slots={slots} />
            </Screen>
            <section className="mic-card mic-line">
              <p>{cal ? "已按你的声音校准：口型是照你本人的元音范围推断的。" : "还没校准：现在按标准嗓音推断口型，校准后更贴合你本人。"}</p>
              <div className="mic-actions">
                <button type="button" className={`chip${ref ? " on" : ""}`} onClick={() => void calibrate()}>
                  {ref ? "取消校准" : cal ? "重新校准" : "校准"}
                </button>
                {cal && !ref && (
                  <button type="button" className="chip" onClick={clearCalibration}>
                    清除校准
                  </button>
                )}
              </div>
            </section>
            <section className="mic-card mic-line">
              <p>{sim ? "气流模拟开着：头部和气道图上会显示声压和气流，手机会比较吃力。" : "气流模拟关着：只显示口型，最省电、最流畅。"}</p>
              <div className="mic-actions">
                <button type="button" className={`chip${sim ? " on" : ""}`} onClick={toggleSim}>
                  {sim ? "关闭气流模拟" : "打开气流模拟"}
                </button>
              </div>
            </section>
            <Screen className="mic-tube" title="气道" sub="从声门到嘴唇的粗细">
              <TubeView />
            </Screen>
            <details className="mic-help">
              <summary>怎么看</summary>
              <ul>
                <li>
                  <b>头部剖面</b>：绿色是舌头，橙色是下巴，粉色是嘴唇，白色是软腭。它是根据你声音的共振峰<b>反推</b>出来的口型，不是拍到的。
                </li>
                <li>
                  <b>F1 / F2 / F3</b>（黄色数字）：图上这个口型的共振峰。“实测 F1 / F2”是你声音里量到的，两组越接近，图越能代表你。F1 高 = 嘴张得大、舌位低；F2 高 = 舌头靠前。
                </li>
                <li>
                  <b>气道</b>：把声道拉直，从声门（左）到嘴唇（右），越粗的地方越宽敞，最细的地方就是舌头抬起的位置。颜色越亮声压越大。
                </li>
                <li>
                  <b>校准</b>：每个人的声道长短不同，同一个字的共振峰也不同。点“校准”，按提示依次唱“啊、衣、乌”，程序会记住你的声音范围。换人用要重新校准。
                </li>
                <li>
                  <b>认不出的音</b>：鼻音（m / n / ng）、很高的音、短促的辅音（b d g p t k）从声音里反推不出口型，图会停在上一个口型。
                </li>
              </ul>
            </details>
          </>
        )}
        {tab === "folds" && (
          <>
            <section className="mic-card mic-closure" aria-label="声带闭合">
              <header>
                <h2>声带闭合</h2>
                <span className="mic-closure-num">{closed === null ? "—" : `${Math.round(closed)}%`}</span>
              </header>
              <div className="mic-closure-bar" aria-hidden="true">
                <i className="zone" style={{ left: `${pos(26)}%`, width: `${pos(40) - pos(26)}%` }} />
                {mark?.closed != null && <i className="mark" style={{ left: `${pos(mark.closed)}%` }} />}
                <i className="now" ref={nowMark} style={{ opacity: 0 }} />
              </div>
              <div className="mic-closure-scale" aria-hidden="true">
                <span>松 · 漏气</span>
                <span>适中</span>
                <span>紧 · 挤</span>
              </div>
              <p>
                {closed === null
                  ? "唱一个长元音，这里显示每个振动周期里声带合拢的时间占比（由声音估计）。"
                  : `${closedWord(closed)}。${mark?.closed != null ? `现在${Math.abs(closed - mark.closed) < 3 ? "和参考差不多" : closed > mark.closed ? `比参考紧 ${Math.round(closed - mark.closed)} 点` : `比参考松 ${Math.round(mark.closed - closed)} 点`}。${loudGap !== null && Math.abs(loudGap) > 4 ? `但现在的音量比参考${loudGap > 0 ? "大" : "小"} ${Math.abs(Math.round(loudGap))} dB：力度不同，读数本身会差 3–4 点，请用相近的音量再比。` : ""}` : ""}`}
              </p>
              {refLine && <p className="mic-ref">{mark?.closed != null ? "白线 = " : ""}{refLine}</p>}
            </section>
            <Screen className="mic-folds" title="声带" sub="俯视 · 慢放 · 开合和长短按你的声音">
              <Stroboscope
                pulse={() => sessionRef.current?.oq ?? null}
                caption={() => (shownClosed.current === null ? null : `闭合 ${Math.round(shownClosed.current)}%`)}
                // the drawing opens as wide as the closure is loose: 12 % closed → nearly full width, 46 % → a slit
                opening={() => (shownClosed.current === null ? null : clamp(1.15 - shownClosed.current / 50, 0.22, 1))}
                // and as long as the pitch is high
                stretch={() => (heardRef.current.f0 > 0 ? stretchOf(heardRef.current.f0, useStore.getState().body, rangeRef.current) : null)}
              />
            </Screen>
            <section className="mic-card mic-line">
              <p>
                {ranging
                  ? `正在记录音域：从你最低的音慢慢唱到最高的音，滑上去或一个一个唱都行。${ranging[1] > 0 ? `目前最低 ${noteName(ranging[0])}，最高 ${noteName(ranging[1])}。` : ""}唱完点“完成”。`
                  : heard.f0 > 0
                    ? `声带拉长：比最低音时长约 ${Math.round(50 * stretchOf(heard.f0, body, range))}%（按音高 ${nameNow(heard.f0)} 推算，${range ? `你的音域 ${noteName(range[0])}–${noteName(range[1])}` : "常见音域"}）`
                    : `声带拉长：按音高推算，音越高拉得越长、越薄。${range ? `你的音域 ${noteName(range[0])}–${noteName(range[1])}。` : "录下你的音域后按你本人来算。"}`}
              </p>
              <div className="mic-actions">
                <button type="button" className={`chip${ranging ? " on" : ""}`} onClick={() => void recordRange()}>
                  {ranging ? "完成" : range ? "重录音域" : "录我的音域"}
                </button>
                {range && !ranging && (
                  <button type="button" className="chip" onClick={forgetRange}>
                    清除音域
                  </button>
                )}
              </div>
            </section>
            <RegisterCard state={glide} on={on} onRecord={() => void recordGlide()} />
            <details className="mic-help">
              <summary>怎么看</summary>
              <ul>
                <li>
                  <b>声带闭合</b>：每个振动周期里声带合拢的时间占比，由你声音的泛音结构估计。数字越大合得越紧。用模拟器造的已知声音检验过（加了混响、噪声、不同的麦克风频响和采样率）：绝对值平均差约 4 个点；同一个音、同一个字、相近的音量比两次，差 6 个点以上时判断谁更紧的正确率约 97%。所以它最适合“和上次比”：唱对的时候点底部的“记为参考”，以后照着那条白线找。它分不出“合得时间短”和“合不严有缝”，两者都显示为偏松。还有一个已知的干扰：唱的力度。同样的闭合，轻声唱读数会偏紧几个点，大声唱偏松几个点，所以要用相近的音量比；音量和参考差得多时页面会提醒。手机离嘴的距离也要固定，否则音量没法比。
                </li>
                <li>
                  <b>声带动画</b>：从上往下看的声带，慢放。合拢时间和张开的宽度都按上面的估计值画：读数越小张得越开，读数越大越像一条缝；音越高，声带画得越长越细。右边两条线是按这个闭合比例画出的开口和气流的示意波形。这是照估计值画的示意图，不是你声带的实拍。
                </li>
                <li>
                  <b>声带拉长</b>：唱高音主要靠把声带拉长、拉薄。拉了多长从声音里量不出来，这里是按音高换算的：以音域的最低音为起点，到最高音大约长出一半。默认按女声 / 男声 / 童声的常见音域算；点“录我的音域”，从最低音唱到最高音，之后就按你本人的音域算。
                </li>
                <li>
                  <b>换声区（实验性）</b>：从低往高滑的时候，嗓音从“真声”换到“头声 / 假声”的地方常会突然变：音高一下跳上去（破音），或者声带闭合一下变松、音量一下变小。这里只找“突然”的变化，慢慢变过去的（过渡得好）不标。下面的图横轴是音高，绿线是闭合，蓝线是音量，黄色虚线是突变的位置。用模拟器造的滑音检验过：故意在某个音突然变的，标出的位置误差在半个半音以内；一路平滑或慢慢变薄的不会误标，加了混响和噪声也一样。但模拟器并不会真的换声区，真人嗓音上没有验证过，只作参考。请用“啊”滑，一口气 3–6 秒滑完。闭合只在检验过的音高范围里看（女声 F3–C♯5，男声 G2–D♯4），之外和用蓝牙耳机时只看音高有没有突然跳。
                </li>
              </ul>
            </details>
          </>
        )}
        {tab === "breath" && (
          <>
            <section className="mic-card mic-breath" aria-label="气息与起音">
              <header>
                <h2>这口气</h2>
                <span className="mic-breath-secs">{steady ? `${steady.seconds.toFixed(1)} 秒` : "—"}</span>
              </header>
              <div className="mic-trace">
                <LevelTrace get={() => sessionRef.current?.breathTrace ?? null} />
              </div>
              <dl>
                <dt>音量起伏</dt>
                <dd>
                  {steady?.sd != null ? `±${steady.sd.toFixed(1)} dB · ${sdWord(steady.sd)}` : "唱满 1 秒后显示"}
                  {mark?.sd != null && <em>参考 ±{mark.sd.toFixed(1)} dB</em>}
                </dd>
                <dt>音量走势</dt>
                <dd>{steady?.sd != null ? (steady.slope < -0.5 ? `在变弱（每秒 ${steady.slope.toFixed(1)} dB），后段气息没托住` : steady.slope > 0.5 ? `在变强（每秒 +${steady.slope.toFixed(1)} dB）` : "平稳") : "—"}</dd>
                <dt>起音</dt>
                <dd>
                  {onset ? `${ONSET_WORD[onset.kind]}：${ONSET_HINT[onset.kind]}（${onset.kind === "breathy" ? `先出气 ${Math.round(onset.breathMs)} 毫秒` : `上升 ${Math.round(onset.riseMs)} 毫秒`}）` : "从安静开始唱一个音后显示"}
                  {mark?.onset && <em>参考 {ONSET_WORD[mark.onset]}</em>}
                </dd>
              </dl>
            </section>
            <BreathHistory list={history} onClear={clearHistory} />
            <details className="mic-help">
              <summary>怎么看</summary>
              <ul>
                <li>
                  <b>曲线</b>：这一口气里音量的走势，中线是这个音的平均音量，上下各 6 dB。线越平，气息托得越稳；一路往下掉，说明后段气不够了。
                </li>
                <li>
                  <b>音量起伏</b>：音量围绕自身走势晃动的幅度。正常颤音带来的轻微脉动已经滤掉，不算在内。
                </li>
                <li>
                  <b>音量走势</b>：整体在变强还是变弱。有意做渐强渐弱时可以忽略。
                </li>
                <li>
                  <b>起音</b>：软起音是气和声同时到；硬起音是声带先闭紧再撞开；气起音是先漏一段气才出声。要从安静开始唱才能判断。
                </li>
                <li>
                  <b>历史记录</b>：从出声到安静满 1 秒算一口气，中间换字、短暂停顿不算断。唱满 2 秒以上的一口气自动记下它的时长、音量起伏和走势；正唱着时点“停止”也会记下。柱子是每天最长的一口气，柱子下面的数字是当天各口气音量起伏的中间值。练长音时用同一个音、差不多的音量，前后才好比。记录只存在这台手机的这个网页里，清除浏览器数据会一起清掉。
                </li>
              </ul>
            </details>
          </>
        )}
        {note && <p className="mic-note">{note}</p>}
      </main>
      <footer className="mic-bar">
        <button className="primary large" onClick={() => void toggle()}>
          {on ? "停止" : "开始听"}
        </button>
        <div className="mic-status-box">
          <p className={`mic-status${error ? " error" : ""}`} role="status">
            {status}
            {on && fps < 30 && <span className="mic-fps">　画面 {fps} 帧/秒{sim ? "，可关闭气流模拟" : ""}</span>}
          </p>
          {ref && (
            <div className="mic-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(calProgress * 100)}>
              <i style={{ width: `${Math.min(100, calProgress * 100)}%` }} />
            </div>
          )}
        </div>
        <div className="mic-ref-actions">
          <button type="button" className={`chip${mark ? " on" : ""}`} disabled={!canRemember} onClick={remember} title="把刚才这个音的音准、颤音、闭合、音量、气息、起音和明亮度记下来，以后照着找">
            记为参考
          </button>
          {mark && (
            <button type="button" className="mic-link" onClick={forget}>
              清除
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
