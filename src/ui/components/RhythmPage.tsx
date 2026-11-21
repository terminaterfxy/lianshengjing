/**
 * Rhythm practice, its own page off the mic page: a metronome, one "da" a beat, and how early or
 * late each one landed (src/mic/rhythm.ts).
 *
 * One audio context plays the clicks and records the microphone (an AudioWorklet posting its input
 * with the frame it was captured on), so beats and syllables are on one clock. The time a click
 * takes to come out of the speaker and back in through the microphone is measured once (the phone
 * plays clicks and hears itself) and taken off every take.
 */
import { useEffect, useRef, useState } from "react";
import { Screen } from "./Screen.tsx";
import { Segmented } from "./Controls.tsx";
import { usePhosphor } from "../usePhosphor.ts";
import { TEXT, V } from "../colors.ts";
import { dot, label, labelBlock, seg } from "../render/vector.ts";
import { findClicks, findOnsets, score, type Score } from "../../mic/rhythm.ts";

const BPM_KEY = "chimera.rhythm.bpm", METER_KEY = "chimera.rhythm.meter", DELAY_KEY = "chimera.rhythm.delay";
/** bars sung after the count-in bar */
const BARS = 4;
type Meter = "2" | "3" | "4";
type Phase = "idle" | "calibrating" | "countin" | "singing" | "result";

const load = <T,>(key: string, ok: (v: unknown) => v is T, fallback: T): T => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // private browsing: kept until the page closes
  }
};
interface Delay {
  /** the round trip, s */
  delay: number;
  /** when it was measured, ms since 1970 */
  at: number;
}

/** posts what the microphone gives, 1024 frames at a time, with the frame each piece began on */
const RECORDER = `
class LsjRec extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; this.start = 0; }
  flush() { if (this.n) this.port.postMessage({ frame: this.start, data: this.buf.slice(0, this.n) }); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    if (this.n && currentFrame !== this.start + this.n) this.flush();
    if (!this.n) this.start = currentFrame;
    for (let i = 0; i < ch.length; i++) { this.buf[this.n++] = ch[i]; if (this.n === this.buf.length) { this.flush(); this.start = currentFrame + i + 1; } }
    return true;
  }
}
registerProcessor("lsj-rec", LsjRec);
`;

interface Audio {
  ctx: AudioContext;
  stream: MediaStream;
  chunks: { frame: number; data: Float32Array }[];
}

/** The recording from frame `from` to `to`, gaps silent. */
function recorded(a: Audio, from: number, to: number): Float32Array {
  const out = new Float32Array(Math.max(0, to - from));
  for (const c of a.chunks) {
    const at = c.frame - from;
    if (at + c.data.length <= 0 || at >= out.length) continue;
    out.set(c.data.subarray(Math.max(0, -at), Math.min(c.data.length, out.length - at)), Math.max(0, at));
  }
  return out;
}

/** A click at `t` (context time): a short high tick, the bar's first beat higher. */
function click(ctx: AudioContext, t: number, accent: boolean, volume: number) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 3500 : 2500;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(volume, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.07);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ms = (x: number) => `${Math.round(Math.abs(x))} 毫秒`;

/** Each beat's offset as a dot, early to the left; the beats top to bottom; ±20 ms shaded. */
function Offsets(props: { result: Score }) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const ref = usePhosphor(({ ctx, w, h }) => {
    const { offsets } = propsRef.current.result;
    const x0 = 34, x1 = w - 10, top = 8, bot = h - 22, span = 200;
    const x = (o: number) => x0 + ((Math.max(-span, Math.min(span, o)) + span) / (2 * span)) * (x1 - x0);
    ctx.fillStyle = "rgba(91, 227, 129, 0.12)";
    ctx.fillRect(x(-20), top, x(20) - x(-20), bot - top);
    seg(ctx, x(0), top, x(0), bot, V.green, 1, { alpha: 0.8 });
    for (const o of [-200, -100, 100, 200]) seg(ctx, x(o), top, x(o), bot, V.blueDim, 0.8, { dash: [2, 5], alpha: 0.7 });
    label(ctx, "早 200", x(-200), h - 6, { size: 9, color: TEXT.secondary, align: "left", ls: 0 });
    label(ctx, "准", x(0), h - 6, { size: 9, color: V.green, align: "center", ls: 0 });
    label(ctx, "晚 200 毫秒", x(200), h - 6, { size: 9, color: TEXT.secondary, align: "right", ls: 0 });
    const row = (bot - top) / offsets.length;
    offsets.forEach((o, i) => {
      const y = top + row * (i + 0.5);
      if (i % 4 === 0) label(ctx, `${i + 1}`, 4, y + 3, { size: 9, color: TEXT.secondary, ls: 0 });
      if (o === null) label(ctx, "×", x1, y + 3, { size: 9, color: V.red, align: "right", ls: 0 });
      else dot(ctx, x(o), y, 3, Math.abs(o) > span ? V.red : V.amber);
    });
    if (!offsets.some((o) => o !== null)) labelBlock(ctx, "没有找到唱的字", x0 + 8, (top + bot) / 2, x1 - x0 - 16, { size: 11, color: TEXT.secondary, ls: 0.05 });
  });
  return <canvas ref={ref} className="instrument-canvas" aria-label="每一拍早了或晚了多少" role="img" />;
}

export function RhythmPage(props: { onBack: () => void }) {
  const [bpm, setBpm] = useState(() => load(BPM_KEY, (v): v is number => typeof v === "number" && v >= 40 && v <= 160, 72));
  const [meter, setMeter] = useState<Meter>(() => load(METER_KEY, (v): v is Meter => v === "2" || v === "3" || v === "4", "4"));
  const [delay, setDelay] = useState<Delay | null>(() => load(DELAY_KEY, (v): v is Delay => !!v && typeof (v as Delay).delay === "number" && (v as Delay).delay > 0 && (v as Delay).delay < 0.5, null));
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<Score | null>(null);
  // the beat being heard: its place in the bar, and its index in the take (a new one flashes)
  const [beat, setBeat] = useState<{ n: number; k: number; count: boolean } | null>(null);
  const audio = useRef<Audio | null>(null);
  const busy = phase === "calibrating" || phase === "countin" || phase === "singing";

  // the audio goes when the page does
  useEffect(
    () => () => {
      const a = audio.current;
      audio.current = null;
      a?.stream.getTracks().forEach((t) => t.stop());
      void a?.ctx.close().catch(() => {});
    },
    [],
  );

  /** The context and the microphone, recording from now on. The context is made here, in the tap (iOS). */
  const open = async (): Promise<Audio | null> => {
    if (audio.current) {
      void audio.current.ctx.resume().catch(() => {});
      return audio.current;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMsg("需要通过 https 打开才能用麦克风。");
      return null;
    }
    const ctx = new AudioContext({ latencyHint: "interactive" });
    void ctx.resume().catch(() => {});
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = "play-and-record";
    } catch {
      // records anyway
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
      void ctx.resume().catch(() => {});
      const url = URL.createObjectURL(new Blob([RECORDER], { type: "application/javascript" }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(ctx, "lsj-rec");
      const a: Audio = { ctx, stream, chunks: [] };
      node.port.onmessage = (e: MessageEvent<{ frame: number; data: Float32Array }>) => {
        a.chunks.push(e.data);
        // the last half minute is plenty
        const keep = ctx.sampleRate * 30;
        while (a.chunks.length && a.chunks[a.chunks.length - 1].frame - a.chunks[0].frame > keep) a.chunks.shift();
      };
      const sink = ctx.createGain();
      sink.gain.value = 0;
      ctx.createMediaStreamSource(stream).connect(node).connect(sink).connect(ctx.destination);
      audio.current = a;
      return a;
    } catch (e) {
      void ctx.close().catch(() => {});
      const name = e instanceof Error ? e.name : "";
      setMsg(name === "NotAllowedError" ? "麦克风被拒绝。请在 设置 → Safari → 麦克风 里允许，然后重试。" : `无法启动：${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  /** Wait until the context's clock passes `t`, showing the beat as it goes. */
  const follow = async (a: Audio, beats: number[], countIn: number, until: number) => {
    const per = Number(meter);
    let shown = -1;
    while (a.ctx.currentTime < until && audio.current === a) {
      // the beat heard now (the speaker's own delay, where the browser knows it)
      const t = a.ctx.currentTime - (a.ctx.outputLatency || 0);
      let k = -1;
      for (let i = 0; i < beats.length; i++) if (beats[i] <= t) k = i;
      if (k >= 0 && k !== shown) {
        shown = k;
        const count = k < countIn;
        setBeat({ n: (k % per) + 1, k, count });
        setPhase(count ? "countin" : "singing");
      }
      await wait(10);
    }
  };

  const calibrate = async () => {
    setMsg(null);
    setResult(null);
    const a = await open();
    if (!a) return;
    setPhase("calibrating");
    await wait(400);
    const sr = a.ctx.sampleRate, t0 = a.ctx.currentTime + 0.3;
    const times = Array.from({ length: 8 }, (_, k) => t0 + 0.5 * k);
    times.forEach((t) => click(a.ctx, t, false, 0.8));
    const from = Math.round((t0 - 0.2) * sr), end = times[times.length - 1] + 0.6;
    while (a.ctx.currentTime < end + 0.15) await wait(30);
    const x = recorded(a, from, Math.round(end * sr));
    const got = findClicks(x, sr, times.map((t) => Math.round(t * sr) - from));
    setPhase("idle");
    if (!got) {
      setMsg("没听清节拍声：把耳机摘下，手机音量调大，周围安静一点，再校准一次。");
      return;
    }
    const d = { delay: got.delay, at: Date.now() };
    setDelay(d);
    save(DELAY_KEY, d);
    setMsg(`校准好了：这台手机的延迟是 ${Math.round(got.delay * 1000)} 毫秒，之后每次都会扣掉。`);
  };

  const start = async () => {
    setMsg(null);
    setResult(null);
    if (!delay) {
      setMsg("先点“校准延迟”（只需一次），否则结果会整体偏晚。");
      return;
    }
    const a = await open();
    if (!a) return;
    const per = Number(meter), gap = 60 / bpm, sr = a.ctx.sampleRate;
    const t0 = a.ctx.currentTime + 0.6, n = per * (BARS + 1);
    const beats = Array.from({ length: n }, (_, k) => t0 + k * gap);
    beats.forEach((t, k) => click(a.ctx, t, k % per === 0, 0.5));
    setPhase("countin");
    const end = beats[n - 1] + gap;
    await follow(a, beats, per, end + 0.2);
    if (audio.current !== a) return;
    setBeat(null);
    const from = Math.round((beats[per] - 0.5 * gap) * sr);
    const x = recorded(a, from, Math.round(end * sr));
    const onsets = findOnsets(x, sr);
    const sung = beats.slice(per).map((t) => t - from / sr);
    setResult(score(onsets, sung, delay.delay));
    setPhase("result");
  };

  const pickBpm = (v: number) => {
    const b = Math.max(40, Math.min(160, v));
    setBpm(b);
    save(BPM_KEY, b);
  };
  const r = result;
  const verdict = r?.mean == null ? null : Math.abs(r.mean) <= 20 ? `很准：平均只差 ${ms(r.mean)}` : r.mean < 0 ? `习惯抢拍：平均早 ${ms(r.mean)}` : `习惯拖拍：平均晚 ${ms(r.mean)}`;
  const steadiness = r?.sd == null ? null : `${r.sd <= 25 ? "很稳" : r.sd <= 50 ? "较稳" : "忽早忽晚"}：每拍前后差约 ±${Math.round(r.sd)} 毫秒`;
  return (
    <div className="mic-page rhythm-page">
      <header className="mic-top">
        <button type="button" className="mic-link rhythm-back" onClick={props.onBack} disabled={busy}>
          ‹ 返回
        </button>
        <h1 className="rhythm-title">节奏练习</h1>
      </header>
      <div />
      <main className="mic-screens">
        <section className="mic-card mic-breath" aria-label="设置">
          <dl>
            <dt>速度</dt>
            <dd className="rhythm-bpm">
              <button type="button" className="chip" onClick={() => pickBpm(bpm - 4)} disabled={busy} aria-label="慢一点">
                −
              </button>
              <span>每分钟 {bpm} 拍</span>
              <button type="button" className="chip" onClick={() => pickBpm(bpm + 4)} disabled={busy} aria-label="快一点">
                +
              </button>
            </dd>
            <dt>拍子</dt>
            <dd>
              <Segmented<Meter>
                label="每小节几拍"
                value={meter}
                onChange={(m) => {
                  if (busy) return;
                  setMeter(m);
                  save(METER_KEY, m);
                }}
                options={[
                  { value: "2", label: "2 拍" },
                  { value: "3", label: "3 拍" },
                  { value: "4", label: "4 拍" },
                ]}
              />
            </dd>
            <dt>延迟</dt>
            <dd>
              {delay ? `${Math.round(delay.delay * 1000)} 毫秒（已校准）` : "还没校准"}
              <button type="button" className="mic-link rhythm-cal" onClick={() => void calibrate()} disabled={busy}>
                {phase === "calibrating" ? "正在校准…" : delay ? "重新校准" : "校准延迟"}
              </button>
            </dd>
          </dl>
          {!delay && <p className="mic-caveat">第一次用先校准：摘下耳机，手机放桌上，音量调大，保持安静，点“校准延迟”，约 5 秒。</p>}
        </section>
        <section className="mic-card rhythm-stage">
          <div className={`rhythm-beat${beat?.n === 1 ? " accent" : ""}${beat?.count ? " count" : ""}`} key={beat ? beat.k : "none"}>
            {beat ? beat.n : "♩"}
          </div>
          <p>
            {phase === "countin"
              ? "预备…（这一小节先听，不唱）"
              : phase === "singing"
                ? "每拍唱一个“哒”"
                : phase === "calibrating"
                  ? "正在校准：别出声"
                  : `先听一小节预备拍，接着唱 ${BARS} 小节，每拍一个“哒”。`}
          </p>
          <button type="button" className="primary large" onClick={() => void start()} disabled={busy}>
            {phase === "result" ? "再来一次" : busy && phase !== "calibrating" ? "唱…" : "开始"}
          </button>
          {msg && <p className="mic-caveat">{msg}</p>}
        </section>
        {r && (
          <>
            <section className="mic-card mic-breath" aria-label="结果">
              <header>
                <h2>结果</h2>
                <span className="mic-history-count">
                  唱到 {r.hit} / {r.offsets.length} 拍
                </span>
              </header>
              <dl>
                <dt>早晚</dt>
                <dd>{verdict ?? "没有找到唱的字：每拍唱一个“哒”，字和字之间稍微断开。"}</dd>
                <dt>稳定</dt>
                <dd>{steadiness ?? "—"}</dd>
                {r.extra > 0 && (
                  <>
                    <dt>多出</dt>
                    <dd>还有 {r.extra} 个声音没对上拍子（多唱了，或别的声音）</dd>
                  </>
                )}
              </dl>
            </section>
            <Screen className="rhythm-offsets" title="每一拍" sub="点在中线左边是早，右边是晚 · × 是这拍没唱">
              <Offsets result={r} />
            </Screen>
          </>
        )}
        <details className="mic-help">
          <summary>怎么练、怎么看</summary>
          <ul>
            <li>
              <b>怎么唱</b>：每拍唱一个“哒”（或“他”），字和字之间稍微断开。连着唱（“啦——啦——”）的字找不到起点，读不出来。
            </li>
            <li>
              <b>听节拍</b>：用手机外放或有线耳机。蓝牙耳机会慢 0.1–0.25 秒，结果会整体偏晚，不要用。iPhone 开着麦克风时外放可能变小，听不清就戴有线耳机。
            </li>
            <li>
              <b>校准延迟</b>：声音从喇叭出来、再被麦克风收回去要花几十毫秒，校准就是让手机自己放几下节拍、自己听，量出这段时间，以后每次扣掉。换了手机才需要重新校准。
            </li>
            <li>
              <b>早晚</b>：每个字的起点（元音开始响的地方）比拍子早还是晚，取平均。20 毫秒以内耳朵基本听不出来；20–50 毫秒是略早或略晚；50 毫秒以上就明显了（经验值）。
            </li>
            <li>
              <b>稳定</b>：各拍的早晚彼此差多少。平均准但忽早忽晚，说明拍子感还不稳。
            </li>
            <li>
              <b>准不准</b>：用合成的“哒”检验过：每个字起点的误差在 10 毫秒以内，延迟校准误差 1–2 毫秒。真人嗓音和 iPhone 上还没有验证。
            </li>
          </ul>
        </details>
      </main>
    </div>
  );
}
