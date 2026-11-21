/**
 * The breath tab's history: every long breath she has sung (src/mic/history.ts), by day, so
 * progress shows: today's longest and steadiest, her best, a bar per day, and the last few.
 */
import { useEffect, useRef, useState } from "react";
import { Screen } from "./Screen.tsx";
import { usePhosphor } from "../usePhosphor.ts";
import { TEXT, V } from "../colors.ts";
import { label, labelBlock, seg } from "../render/vector.ts";
import { byDay, LONG_BREATH, todayKey, type BreathRecord, type DaySummary } from "../../mic/history.ts";

/** how much a level wandering this much (dB) says about the breath; the bands are rules of thumb */
export const sdWord = (sd: number) => (sd <= 1 ? "很稳" : sd <= 2 ? "较稳" : "起伏大");
export const slopeWord = (slope: number) => (slope < -0.5 ? "后段变弱" : slope > 0.5 ? "在变强" : "平稳");

const two = (n: number) => String(n).padStart(2, "0");
const dateText = (at: number) => {
  const d = new Date(at);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};
const timeText = (at: number) => {
  const d = new Date(at);
  return `${todayKey(at) === todayKey() ? "" : `${d.getMonth() + 1}月${d.getDate()}日 `}${two(d.getHours())}:${two(d.getMinutes())}`;
};

/** A bar per day: the longest breath, with the day's typical wander under it. */
function DayBars(props: { days: DaySummary[]; today: string }) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const ref = usePhosphor(({ ctx, w, h }) => {
    const { days, today } = propsRef.current;
    const x0 = 30, x1 = w - 8, top = 20, bot = h - 34;
    if (!days.length) {
      labelBlock(ctx, `唱满 ${LONG_BREATH} 秒以上的一口气，这里每天画一根柱子：当天最长的那一口气`, x0, (top + bot) / 2 - 8, x1 - x0, { size: 11, color: TEXT.secondary, ls: 0.05 });
      return;
    }
    // as many days as fit, the newest at the right
    const shown = days.slice(-Math.max(1, Math.min(14, Math.floor((x1 - x0) / 34))));
    const most = Math.max(...shown.map((d) => d.longest.seconds));
    const yMax = Math.max(10, Math.ceil(most / 5) * 5);
    const y = (s: number) => bot - (s / yMax) * (bot - top);
    for (const s of [0, yMax / 2, yMax]) {
      seg(ctx, x0, y(s), x1, y(s), V.blueDim, 0.8, s ? { dash: [2, 5], alpha: 0.7 } : {});
      label(ctx, `${s}`, x0 - 4, y(s) + 3, { size: 9, color: TEXT.secondary, align: "right", ls: 0 });
    }
    label(ctx, "秒", x0 - 4, top - 8, { size: 9, color: TEXT.secondary, align: "right", ls: 0 });
    const slot = (x1 - x0) / shown.length, bw = Math.min(16, slot * 0.5);
    shown.forEach((d, i) => {
      const cx = x0 + slot * (i + 0.5), yy = y(d.longest.seconds), now = d.key === today;
      // the line's round caps reach the axis and the value, not past them
      seg(ctx, cx, bot - bw / 2, cx, Math.min(bot - bw / 2, yy + bw / 2), now ? V.amber : V.green, bw, { alpha: 0.5 });
      label(ctx, d.longest.seconds.toFixed(1), cx, yy - 5, { size: 9, color: now ? V.amber : TEXT.secondary, align: "center", ls: 0 });
      label(ctx, now ? "今天" : `${d.month}/${d.day}`, cx, bot + 13, { size: 9, color: now ? V.amber : TEXT.secondary, align: "center", ls: 0 });
      label(ctx, `±${d.sd.toFixed(1)}`, cx, bot + 27, { size: 8, color: V.blue, align: "center", ls: 0 });
    });
  });
  return <canvas ref={ref} className="instrument-canvas" aria-label="每天最长的一口气" role="img" />;
}

export function BreathHistory(props: { list: BreathRecord[]; onClear: () => void }) {
  const { list, onClear } = props;
  const days = byDay(list);
  const today = todayKey();
  const now = days.length && days[days.length - 1].key === today ? days[days.length - 1] : null;
  const longest = list.length ? list.reduce((a, b) => (b.seconds > a.seconds ? b : a)) : null;
  const steadiest = list.length ? list.reduce((a, b) => (b.sd < a.sd ? b : a)) : null;
  // clearing everything takes a second tap
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirming]);
  return (
    <>
      <section className="mic-card mic-breath" aria-label="气息历史">
        <header>
          <h2>历史记录</h2>
          {list.length > 0 && <span className="mic-history-count">共 {list.length} 次</span>}
        </header>
        {!longest || !steadiest ? (
          <p>唱满 {LONG_BREATH} 秒以上的一口气会自动记在这里（只存在这台手机上）。每天看看最长和最稳的一次，就能看出进步。</p>
        ) : (
          <dl>
            <dt>今天</dt>
            <dd>{now ? `最长 ${now.longest.seconds.toFixed(1)} 秒 · 最稳 ±${now.steadiest.sd.toFixed(1)} dB（${now.count} 次）` : "今天还没有"}</dd>
            <dt>最好</dt>
            <dd>
              最长 {longest.seconds.toFixed(1)} 秒（{dateText(longest.at)}）
              <em>
                最稳 ±{steadiest.sd.toFixed(1)} dB（{dateText(steadiest.at)}，那口气 {steadiest.seconds.toFixed(1)} 秒）
              </em>
            </dd>
          </dl>
        )}
      </section>
      <Screen className="mic-breath-history" title="每天最长的一口气" sub="柱上是秒数 · 下面是当天典型的音量起伏">
        <DayBars days={days} today={today} />
      </Screen>
      {list.length > 0 && (
        <section className="mic-card mic-breath" aria-label="最近几次">
          <header>
            <h2>最近几次</h2>
          </header>
          <dl>
            {list
              .slice(-5)
              .reverse()
              .map((r) => (
                <div className="mic-history-row" key={r.at}>
                  <dt>{timeText(r.at)}</dt>
                  <dd>
                    {r.seconds.toFixed(1)} 秒 · ±{r.sd.toFixed(1)} dB {sdWord(r.sd)} · {slopeWord(r.slope)}
                  </dd>
                </div>
              ))}
          </dl>
          <div className="mic-actions">
            <button
              type="button"
              className="mic-link"
              onClick={() => {
                if (!confirming) return setConfirming(true);
                setConfirming(false);
                onClear();
              }}
            >
              {confirming ? `再点一次，清除全部 ${list.length} 次记录` : "清除历史记录"}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
