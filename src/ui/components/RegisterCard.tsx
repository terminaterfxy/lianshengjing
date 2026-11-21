/**
 * The register-break card on the folds tab (experimental): she glides from low to high once,
 * and the card says where the voice changed suddenly (src/mic/register.ts), with the closure and
 * the level drawn along the pitch. What it can't see (a Bluetooth microphone, notes beyond the
 * closure's checked range, a slow phone) it says.
 */
import { useRef } from "react";
import { Screen } from "./Screen.tsx";
import { usePhosphor } from "../usePhosphor.ts";
import { TEXT, V } from "../colors.ts";
import { beamPts, label, seg, type Pt } from "../render/vector.ts";
import { noteOf } from "../../mic/pitch.ts";
import { CLOSURE_MIN_RATE, CLOSURE_NOTES, type Break, type Glide } from "../../mic/register.ts";

/** a glide being recorded (its notes so far), or what one read */
export type GlideState =
  | { recording: true; lo: number | null; hi: number | null }
  | { recording: false; glide: Glide | null; span: number; fps: number; sampleRate: number; voice: "female" | "male" };

const name = (midi: number) => noteOf(Math.round(midi));

/** One break in words. */
function breakWords(b: Break): string {
  const parts: string[] = [];
  if (b.jump !== null) parts.push(`音高突然往${b.jump > 0 ? "上" : "下"}跳了 ${Math.abs(b.jump).toFixed(1)} 个半音（破音或翻${b.jump > 0 ? "上去" : "下来"}了）`);
  if (b.closed && Math.abs(b.closed[1] - b.closed[0]) >= 3) {
    const [a, c] = b.closed.map(Math.round);
    parts.push(`声带闭合从 ${a}% ${b.jump === null ? "突然" : ""}${c < a ? "降" : "升"}到 ${c}%${b.jump === null ? (c < a ? "（换到了更轻、更薄的唱法）" : "（换到了更厚、更实的唱法）") : ""}`);
  }
  if (b.db !== null) parts.push(`音量${b.db < 0 ? "小" : "大"}了 ${Math.abs(Math.round(b.db))} dB`);
  return `${name(b.midi)} 附近：${parts.join("；")}。`;
}

/** The glide along the pitch: the closure above, the level below, the breaks marked. */
function GlideChart(props: { glide: Glide }) {
  const gRef = useRef(props.glide);
  gRef.current = props.glide;
  const ref = usePhosphor(({ ctx, w, h }) => {
    const g = gRef.current;
    const x0 = 34, x1 = w - 10, top = 16, bot = h - 20, mid = (top + bot) / 2;
    const a = Math.floor(g.lo) - 0.5, b = Math.ceil(g.hi) + 0.5;
    const x = (midi: number) => x0 + ((midi - a) / (b - a)) * (x1 - x0);
    // the axis: every C, E and G named
    seg(ctx, x0, bot, x1, bot, V.blueDim, 0.8);
    for (let n = Math.ceil(a); n <= b; n++) {
      if (![0, 4, 7].includes(((n % 12) + 12) % 12)) continue;
      seg(ctx, x(n), bot, x(n), bot + 3, V.blueDim, 0.8);
      label(ctx, noteOf(n), x(n), h - 5, { size: 9, color: TEXT.secondary, align: "center", ls: 0 });
    }
    seg(ctx, x0, mid, x1, mid, V.blueDim, 0.5, { dash: [2, 4], alpha: 0.6 });
    label(ctx, "闭合", 2, top + 8, { size: 10, color: V.green, ls: 0 });
    label(ctx, "音量", 2, mid + 12, { size: 10, color: V.blue, ls: 0 });
    // the closure, 10–60 %, in the upper half
    const cy = (c: number) => mid - 6 - (Math.max(0, Math.min(50, c - 10)) / 50) * (mid - 6 - top);
    // the level, 30 dB under its loudest, in the lower half
    const loud = Math.max(...g.trace.map((p) => p.db));
    const dy = (db: number) => bot - 4 - (Math.max(0, Math.min(30, db - loud + 30)) / 30) * (bot - 4 - mid - 6);
    // a line per stretch with readings, in time order (a glide that turns back draws back),
    // broken where the pitch leaps or the voice paused: a leap shows as a gap, not a line
    const draw = (pts: (Pt | null)[], color: string) => {
      let run: Pt[] = [];
      const flush = () => {
        if (run.length > 1) beamPts(ctx, run, color, 1.4, { hot: true });
        run = [];
      };
      pts.forEach((p, k) => {
        const q = g.trace[k], prev = g.trace[k - 1];
        if (prev && (Math.abs(q.midi - prev.midi) > 1 || q.t - prev.t > 0.2)) flush();
        if (p) run.push(p);
        else flush();
      });
      flush();
    };
    draw(g.trace.map((p) => (p.closed === null ? null : [x(p.midi), cy(p.closed)])), V.green);
    draw(g.trace.map((p) => [x(p.midi), dy(p.db)]), V.blue);
    for (const k of g.breaks) {
      seg(ctx, x(k.midi), top - 4, x(k.midi), bot, V.amber, 1.2, { dash: [4, 3] });
      label(ctx, name(k.midi), x(k.midi), top - 6, { size: 10, color: V.amber, align: "center", ls: 0 });
    }
  });
  return <canvas ref={ref} className="instrument-canvas" aria-label="滑音里声带闭合和音量随音高的变化" role="img" />;
}

export function RegisterCard(props: { state: GlideState | null; on: boolean; onRecord: () => void }) {
  const { state: s, on } = props;
  const lines: string[] = [];
  const caveats: string[] = [];
  let g: Glide | null = null;
  if (!s) lines.push(`用“啊”从舒服的低音慢慢滑到高音（3–6 秒，中间不换气），这里找声音突然变的地方：音高突然一跳（破音、翻上去），或者声带闭合突然变松。${on ? "" : "点下面的按钮会先开始听。"}`);
  else if (s.recording) lines.push(s.lo !== null && s.hi !== null && s.hi - s.lo >= 1 ? `正在录：已经从 ${name(s.lo)} 滑到 ${name(s.hi)}，继续往上……唱完停下 1 秒会自动结束。` : "正在听：用“啊”从低音慢慢往上滑……唱完停下 1 秒会自动结束，也可以点“完成”。");
  else if (!s.glide || s.span < 1.5) lines.push("没录到完整的滑音：要连续唱 1.5 秒以上。再录一次，从低音一口气滑上去。");
  else if (s.glide.hi - s.glide.lo < 5) lines.push(`这次只滑了 ${Math.round(s.glide.hi - s.glide.lo)} 个半音（${name(s.glide.lo)}–${name(s.glide.hi)}），范围太小。从更低滑到更高再录一次。`);
  else {
    g = s.glide;
    lines.push(`从 ${name(g.lo)} 滑到 ${name(g.hi)}${g.speed > 0 ? `，每秒约 ${Math.round(g.speed)} 个半音` : ""}。`);
    if (!g.breaks.length) lines.push("没有找到突然的变化，一路是连着变过去的。没找到不一定就没有换声点：可能是你过渡得好，也可能变化小到量不出来。");
    else for (const b of g.breaks) lines.push(breakWords(b));
    if (g.speed > 12) caveats.push(`滑得比较快（每秒约 ${Math.round(g.speed)} 个半音），慢一点（3–6 秒滑完）结果更准。`);
    if (s.fps < 25) caveats.push(`这次手机每秒只处理了约 ${Math.round(s.fps)} 帧，结果可能不准：关掉别的应用再录一次。`);
    if (s.sampleRate < CLOSURE_MIN_RATE) caveats.push("现在用的是蓝牙耳机的麦克风：只能看音高有没有突然跳，闭合的变化看不出来。用手机自带的麦克风更好。");
    else {
      const [cLo, cHi] = CLOSURE_NOTES[s.voice];
      if (g.hi > cHi + 0.5 || g.lo < cLo - 0.5) caveats.push(`闭合只在 ${noteOf(cLo)}–${noteOf(cHi)} 之间看（检验过的范围），这之外只看音高有没有突然跳。`);
    }
  }
  return (
    <>
      <section className="mic-card mic-line mic-register" aria-label="换声区">
        <header>
          <h2>换声区</h2>
          <span className="mic-tag">实验性</span>
        </header>
        {lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
        {caveats.map((c) => (
          <p className="mic-caveat" key={c}>
            {c}
          </p>
        ))}
        <div className="mic-actions">
          <button type="button" className={`chip${s?.recording ? " on" : ""}`} onClick={props.onRecord}>
            {s?.recording ? "完成" : s ? "再录一次" : "录一次滑音"}
          </button>
        </div>
      </section>
      {g && (
        <Screen className="mic-glide" title="滑音" sub="横轴是音高 · 虚线是突变的地方">
          <GlideChart glide={g} />
        </Screen>
      )}
    </>
  );
}
