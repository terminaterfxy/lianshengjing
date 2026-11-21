/**
 * The tone tab: how bright the held sound is (src/mic/tone.ts), the spectrum it is read from, and
 * how it compares with the remembered take. The reading moves with the vowel, the note, how loud
 * and where the phone is, so the page says when those differ from the reference's.
 */
import { useRef } from "react";
import { Screen } from "./Screen.tsx";
import { usePhosphor } from "../usePhosphor.ts";
import { TEXT, V } from "../colors.ts";
import { beamPts, label, labelBlock, seg, type Pt } from "../render/vector.ts";
import { BAND_HZ, N_BANDS } from "../../mic/tone.ts";
import { noteOf } from "../../mic/pitch.ts";

/** a brightness reading: dB, the vowel it was read on, how loud (dB) and the note (MIDI), when known */
export interface ToneTake {
  at: number;
  bright: number;
  vowel: string | null;
  /** the vowel's first two formants (Hz, medians over the second), when read */
  formants: { F1: number; F2: number } | null;
  level: number;
  midi: number | null;
}

/** the vowels a Chinese singer would name, by the IPA the vowel map gives */
const VOWEL_ZH: Record<string, string> = { ɑ: "啊", a: "啊", æ: "啊", ɐ: "啊", ʌ: "啊", i: "衣", ɪ: "衣", u: "乌", ʊ: "乌", ɛ: "诶", e: "诶", o: "哦", ɔ: "哦", ə: "呃", ɤ: "鹅", y: "鱼" };
export const vowelName = (v: string) => (VOWEL_ZH[v] ? `${v}（${VOWEL_ZH[v]}）` : v);
/**
 * Two takes are on different vowels when their formants are far apart, by the vowel map's own
 * distance (src/ui/components/AnatomyView.tsx, nearestVowel): neighbouring vowels are 0.8–0.9 apart,
 * and a voice made brighter moves its formants about 0.1 (its name may flip between neighbours).
 */
const vowelGap = (a: { F1: number; F2: number }, b: { F1: number; F2: number }) => Math.hypot(Math.log(a.F1 / b.F1) * 2.2, Math.log(a.F2 / b.F2));

/** the scale of the meter, dB */
const LO = -40, HI = 0;
const pos = (db: number) => Math.max(0, Math.min(100, ((db - LO) / (HI - LO)) * 100));
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`;

/** The held sound's spectrum, 0–5 kHz, 50 dB down from its loudest band; 2–4 kHz marked. */
function Spectrum(props: { get: () => Float64Array | null }) {
  const getRef = useRef(props.get);
  getRef.current = props.get;
  const ref = usePhosphor(({ ctx, w, h }) => {
    const x0 = 30, x1 = w - 8, top = 12, bot = h - 20, range = 50;
    const x = (hz: number) => x0 + (hz / (N_BANDS * BAND_HZ)) * (x1 - x0);
    // the bright part
    for (const hz of [2000, 4000]) seg(ctx, x(hz), top, x(hz), bot, V.amber, 1, { dash: [3, 4], alpha: 0.7 });
    label(ctx, "亮的部分", (x(2000) + x(4000)) / 2, top + 10, { size: 10, color: V.amber, align: "center", ls: 0.05 });
    seg(ctx, x0, bot, x1, bot, V.blueDim, 0.8);
    for (let k = 0; k <= 5; k++) label(ctx, k ? `${k}k` : "0", x(k * 1000), h - 5, { size: 9, color: TEXT.secondary, align: "center", ls: 0 });
    const sp = getRef.current();
    if (!sp) {
      labelBlock(ctx, "唱一个元音保持 1 秒，这里画出声音里低频和高频各有多少", x0 + 8, (top + bot) / 2, x1 - x0 - 16, { size: 11, color: TEXT.secondary, ls: 0.05 });
      return;
    }
    // the envelope over the harmonics (a 100 Hz band between two harmonics is nearly empty): the
    // loudest band within 300 Hz either side
    const top3 = new Float64Array(N_BANDS), env = new Float64Array(N_BANDS);
    for (let i = 1; i < N_BANDS; i++) {
      top3[i] = -Infinity;
      for (let k = Math.max(1, i - 3); k <= Math.min(N_BANDS - 1, i + 3); k++) top3[i] = Math.max(top3[i], sp[k]);
    }
    // then smoothed over 500 Hz, so its steps don't read as resonances
    let peak = -Infinity;
    for (let i = 1; i < N_BANDS; i++) {
      let sum = 0, n = 0;
      for (let k = Math.max(1, i - 2); k <= Math.min(N_BANDS - 1, i + 2); k++, n++) sum += top3[k];
      env[i] = sum / n;
      peak = Math.max(peak, env[i]);
    }
    const pts: Pt[] = [];
    for (let i = 1; i < N_BANDS; i++) pts.push([x((i + 0.5) * BAND_HZ), bot - (Math.max(0, env[i] - peak + range) / range) * (bot - top)]);
    beamPts(ctx, pts, V.green, 1.5, { hot: true });
    label(ctx, "0 dB", 4, top + 4, { size: 8, color: TEXT.secondary, ls: 0 });
    label(ctx, `−${range}`, 4, bot, { size: 8, color: TEXT.secondary, ls: 0 });
  });
  return <canvas ref={ref} className="instrument-canvas" aria-label="最近 1 秒的频谱" role="img" />;
}

export function ToneTab(props: { tone: ToneTake | null; live: boolean; on: boolean; mark: { bright: number; vowel: string | null; formants: { F1: number; F2: number } | null; level: number | null; midi: number | null } | null; spectrum: () => Float64Array | null }) {
  const { tone, live, on, mark } = props;
  const diff = tone && mark ? tone.bright - mark.bright : null;
  // what makes the comparison unfair, if anything
  const caveats: string[] = [];
  if (tone && mark) {
    if (tone.formants && mark.formants && tone.vowel && mark.vowel && vowelGap(tone.formants, mark.formants) > 0.4) caveats.push(`参考那次是 ${vowelName(mark.vowel)}，现在是 ${vowelName(tone.vowel)}：元音不同，亮度没法比，换成同一个元音再看。`);
    if (tone.midi !== null && mark.midi !== null && Math.abs(tone.midi - mark.midi) >= 2) caveats.push(`音高和参考差 ${Math.round(Math.abs(tone.midi - mark.midi))} 个半音：音越高读数越亮，回到参考的音（${noteOf(Math.round(mark.midi))}）再比。`);
    if (mark.level !== null && Math.abs(tone.level - mark.level) >= 4) caveats.push(`比参考${tone.level > mark.level ? "响" : "轻"}约 ${Math.round(Math.abs(tone.level - mark.level))} dB：越响读数越亮，用参考差不多的音量再比。`);
  }
  const verdict = diff === null ? null : Math.abs(diff) <= 1.5 ? `和参考差不多（相差 ${Math.abs(diff).toFixed(1)} dB）` : `比参考${diff > 0 ? "亮" : "暗"} ${Math.abs(diff).toFixed(1)} dB${Math.abs(diff) >= 3 ? "，差别明显" : ""}`;
  return (
    <>
      <section className="mic-card mic-tone" aria-label="明亮度">
        <header>
          <h2>{tone && !live ? "刚才的明亮度" : "明亮度"}</h2>
          <span className="mic-closure-num">{tone ? `${signed(tone.bright)}` : "—"}</span>
        </header>
        <div className="mic-closure-bar" aria-hidden="true">
          {mark && <i className="mark" style={{ left: `${pos(mark.bright)}%` }} />}
          {tone && <i className="now" style={{ left: `${pos(tone.bright)}%` }} />}
        </div>
        <div className="mic-closure-scale" aria-hidden="true">
          <span>暗</span>
          <span>dB</span>
          <span>亮</span>
        </div>
        <p>{tone ? (verdict ?? "数字越大（越接近 0）声音越亮。唱到满意的一次，点“记为参考”，以后和它比。") : on ? "唱一个元音（啊、衣…），保持 1 秒以上。" : "点下面的“开始听”，唱一个元音保持 1 秒以上。"}</p>
        {caveats.map((c) => (
          <p className="mic-caveat" key={c}>
            {c}
          </p>
        ))}
      </section>
      <Screen className="mic-tone-spectrum" title="频谱" sub="最近 1 秒 · 越往右频率越高">
        <Spectrum get={props.spectrum} />
      </Screen>
      <section className="mic-card mic-breath" aria-label="这次读的是">
        <header>
          <h2>这次读的是</h2>
        </header>
        <dl>
          <dt>元音</dt>
          <dd>
            {tone?.vowel ? vowelName(tone.vowel) : tone ? "认不出（鼻音、太高的音）" : "—"}
            {mark?.vowel && <em>参考 {vowelName(mark.vowel)}</em>}
          </dd>
          <dt>音高</dt>
          <dd>
            {tone?.midi != null ? noteOf(Math.round(tone.midi)) : "—"}
            {mark?.midi != null && <em>参考 {noteOf(Math.round(mark.midi))}</em>}
          </dd>
          {mark?.level != null && (
            <>
              <dt>音量</dt>
              <dd>{tone ? (Math.abs(tone.level - mark.level) < 2 ? "和参考差不多" : `比参考${tone.level > mark.level ? "响" : "轻"} ${Math.round(Math.abs(tone.level - mark.level))} dB`) : "—"}</dd>
            </>
          )}
        </dl>
      </section>
      <details className="mic-help">
        <summary>怎么看</summary>
        <ul>
          <li>
            <b>明亮度</b>：声音里 2000–4000 Hz 这一段（训练有素的嗓音常在这里有一个“金属感”的共鸣峰）比 2000 Hz 以下少多少，单位 dB。所以它通常是负数，越接近 0 越亮、越“有穿透力”；越负越暗、越闷。
          </li>
          <li>
            <b>频谱</b>：最近 1 秒里各个频率有多强。左边的高峰是音高和第一、第二共振峰，虚线之间是“亮”的部分，那里抬起来，声音就亮。
          </li>
          <li>
            <b>什么会让它变</b>：喉咙上方收窄（像“哼着笑”“小鸭子叫”那种感觉）、声带闭合更干脆，都会让它变亮。但元音影响最大（“衣”比“乌”亮很多），音越高、唱得越响也越亮，离手机的远近和朝向也会让它差 1–2 dB。所以只和自己比：同一个元音、同一个音、差不多的音量、同样的位置。
          </li>
          <li>
            <b>差多少算数</b>：相差 1.5 dB 以内算差不多；3 dB 以上是明显的差别。这是用已知答案的合成声音检验出来的：同一个位置唱两次，读数几乎一样；换个位置会差约 1.5 dB。
          </li>
          <li>
            <b>量不出的</b>：“头腔共鸣”“胸腔共鸣”“面罩”这些是唱的人自己的感觉，声音里没有直接对应的量，这一页不判断。亮也不一定就好，要看歌曲需要。
          </li>
        </ul>
      </details>
    </>
  );
}
