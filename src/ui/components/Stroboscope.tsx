import { useRef } from "react";
import { usePhosphor } from "../usePhosphor.ts";
import { engine } from "../../audio/AudioEngine.ts";
import { sameBody } from "../body.ts";
import { useStore } from "../store.ts";
import { TEXT, V } from "../colors.ts";
import { beam, beamPts, label, labelBlock, ring, seg, type Pt } from "../render/vector.ts";

/**
 * The vocal folds from above, as through an endoscope, replayed slowly from the phase-locked
 * glottal area trace (two cycles), with the area (white) and flow (amber) waveforms and a playhead.
 */
/**
 * Two cycles of a glottal pulse with the folds apart for `oq` of each: the area a raised cosine
 * over the open phase, the flow the same pulse leaning late (air has inertia: flow peaks after
 * the area does and stops sharply as the folds meet). A drawing of an open quotient, not a
 * simulation.
 */
function drawnPulse(oq: number): { area: Float32Array; flow: Float32Array } {
  const n = 256, area = new Float32Array(n), flow = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ph = ((i / n) * 2) % 1;
    if (ph < oq) {
      const u = ph / oq;
      area[i] = 0.1 * Math.sin(Math.PI * u) ** 2;
      flow[i] = Math.sin(Math.PI * u ** 1.8) ** 2;
    }
  }
  return { area, flow };
}

export function Stroboscope(props: { caption?: () => string | null; opening?: () => number | null; stretch?: () => number | null; pulse?: () => number | null } = {}) {
  const phase = useRef(0);
  // a caption of the caller's (the mic page writes the closure it heard) in place of "OPEN n%"
  const captionRef = useRef(props.caption);
  captionRef.current = props.caption;
  // how wide the folds are drawn at their widest, 0…1 (the mic page: wider the looser the closure it heard)
  const openingRef = useRef(props.opening);
  openingRef.current = props.opening;
  // how far the folds are drawn stretched, 0 (shortest, thick) … 1 (longest, thin); the mic page: by the pitch
  const stretchRef = useRef(props.stretch);
  stretchRef.current = props.stretch;
  const stretchSm = useRef<number | null>(null);
  // an open quotient to draw the pulse from, in place of the engine's own folds (the mic page: the
  // one it heard). While it gives null nothing vibrates.
  const pulseRef = useRef(props.pulse);
  pulseRef.current = props.pulse;
  const drawn = useRef<{ oq: number; p: { area: Float32Array; flow: Float32Array } } | null>(null);
  const oqSm = useRef<number | null>(null);
  const openingSm = useRef<number | null>(null);
  const ref = usePhosphor(({ ctx, w, h, dt }) => {
    const st = useStore.getState();
    const tele = engine.latest && sameBody(engine.latest.body, st.body) ? engine.latest : null;
    let area: ArrayLike<number> | undefined = tele?.t.glottalArea;
    let flow: ArrayLike<number> | undefined = tele?.t.glottalFlow;
    if (pulseRef.current) {
      const oq = pulseRef.current();
      if (oq === null) {
        area = flow = undefined;
        oqSm.current = null;
      } else {
        // eased toward the reading (which steps): the pulse changes shape smoothly
        oqSm.current = oqSm.current === null ? oq : oqSm.current + (oq - oqSm.current) * Math.min(1, dt / 0.25);
        const q = oqSm.current;
        if (!drawn.current || Math.abs(drawn.current.oq - q) > 0.002) drawn.current = { oq: q, p: drawnPulse(q) };
        area = drawn.current.p.area;
        flow = drawn.current.p.flow;
      }
    }
    const n = area?.length ?? 0;
    // apparent strobe rate: one simulated cycle per ~0.9 s
    phase.current = (phase.current + dt / 1.8) % 1;
    const idx = n ? Math.floor(phase.current * n) % n : 0;
    let maxA = 0.02, minA = Infinity;
    if (area) for (let i = 0; i < n; i++) {
      maxA = Math.max(maxA, area[i]);
      minA = Math.min(minA, area[i]);
    }
    // between two points of the trace, so the edges glide rather than step
    const at = n ? phase.current * n : 0, i0 = Math.floor(at) % Math.max(1, n), i1 = (i0 + 1) % Math.max(1, n), fr = at - Math.floor(at);
    const a = area ? area[i0] * (1 - fr) + area[i1] * fr : 0;

    // endoscope view: anterior at the top
    const R = Math.max(20, Math.min(h * 0.4, w * 0.2));
    const cx = R + 14, cy = h / 2 + 4;
    ring(ctx, cx, cy, R, V.blue, 1.3);
    ring(ctx, cx, cy, R + 5, V.blueDim, 0.8, { alpha: 0.8 });
    // stretched folds are up to half as long again, and thinner (eased: a pitch doesn't jump)
    const want = stretchRef.current?.() ?? null;
    if (want === null) stretchSm.current = null;
    else stretchSm.current = stretchSm.current === null ? want : stretchSm.current + (want - stretchSm.current) * Math.min(1, dt / 0.12);
    const st01 = stretchSm.current;
    const len = st01 === null ? R * 1.22 : R * (0.98 + 0.49 * st01);
    const thick = st01 === null ? 1 : 1.14 - 0.34 * st01;
    // how wide they open is eased too
    const wantOpen = openingRef.current?.() ?? null;
    if (wantOpen === null) openingSm.current = null;
    else openingSm.current = openingSm.current === null ? wantOpen : openingSm.current + (wantOpen - openingSm.current) * Math.min(1, dt / 0.25);
    const open = Math.min(1, a / Math.max(0.12, maxA)) * R * 0.42 * (openingSm.current ?? 1);
    const chink = area ? Math.min(R * 0.06, (minA / 0.05) * R * 0.08) : 0;
    for (const sg of [-1, 1]) {
      const edge = new Path2D();
      edge.moveTo(cx, cy - len / 2);
      edge.quadraticCurveTo(cx + sg * (open + chink), cy + len * 0.05, cx + sg * chink * 0.8, cy + len / 2);
      beam(ctx, edge, V.white, 1.6, { hot: true });
      const fold = new Path2D();
      fold.moveTo(cx + sg * 3, cy - len / 2 - 2);
      fold.quadraticCurveTo(cx + sg * R * 0.62 * thick, cy, cx + sg * R * 0.22, cy + len / 2 + 4);
      beam(ctx, fold, V.blueMid, 1.1);
      const falseFold = new Path2D();
      falseFold.moveTo(cx + sg * 8, cy - len / 2 - 8);
      falseFold.quadraticCurveTo(cx + sg * R * 0.92, cy - 2, cx + sg * R * 0.42, cy + len / 2 + 6);
      beam(ctx, falseFold, V.blueDim, 1);
      const ary = new Path2D();
      ary.ellipse(cx + sg * R * 0.2, cy + len / 2 + R * 0.14, R * 0.13, R * 0.09, 0, 0, Math.PI * 2);
      beam(ctx, ary, V.blueMid, 1.1);
    }
    const epi = new Path2D();
    epi.moveTo(cx - R * 0.42, cy - R * 0.62);
    epi.quadraticCurveTo(cx, cy - R * 0.98, cx + R * 0.42, cy - R * 0.62);
    beam(ctx, epi, V.blueMid, 1.2);
    label(ctx, "FRONT", cx, cy - R - 8, { size: 8, color: TEXT.secondary, align: "center", ls: 0.18 });

    // waveforms
    const tx0 = cx + R + 22, tx1 = w - 12;
    if (tx1 - tx0 < 40) return;
    const bandH = Math.max(12, (h - 52) / 2);
    const yA0 = 16, yA1 = yA0 + bandH, yF0 = yA1 + 18, yF1 = yF0 + bandH;
    label(ctx, "AREA", tx1, yA0 - 4, { size: 9, color: TEXT.secondary, align: "right", ls: 0.18 });
    label(ctx, "FLOW", tx1, yF0 - 4, { size: 9, color: TEXT.secondary, align: "right", ls: 0.18 });
    seg(ctx, tx0, yA1, tx1, yA1, V.frame, 1);
    seg(ctx, tx0, yF1, tx1, yF1, V.frame, 1);
    if (area && flow && n > 1) {
      const band = (arr: ArrayLike<number>, y0: number, y1: number): Pt[] => {
        let mx = -Infinity, mn = Infinity;
        for (let i = 0; i < n; i++) {
          mx = Math.max(mx, arr[i]);
          mn = Math.min(mn, arr[i]);
        }
        const o: Pt[] = [];
        for (let i = 0; i < n; i++) o.push([tx0 + ((tx1 - tx0) * i) / (n - 1), y1 - ((arr[i] - mn) / Math.max(1e-9, mx - mn)) * (y1 - y0 - 4)]);
        return o;
      };
      beamPts(ctx, band(area, yA0, yA1), V.white, 1.3, { hot: true });
      beamPts(ctx, band(flow, yF0, yF1), V.amber, 1.3, { hot: true });
      const px = tx0 + ((tx1 - tx0) * Math.min(n - 1, at)) / (n - 1);
      seg(ctx, px, yA0, px, yF1, V.white, 1, { alpha: 0.55, dash: [2, 3] });
      let opened = 0;
      for (let i = 0; i < n; i++) if (area[i] > minA + 0.002) opened++;
      label(ctx, captionRef.current?.() ?? `OPEN ${Math.round((opened / n) * 100)}%`, tx0, h - 4, { size: 9, color: TEXT.secondary, ls: 0.16 });
      label(ctx, `${(a * 100).toFixed(1)} MM²`, tx1, h - 4, { size: 9, color: TEXT.secondary, align: "right", ls: 0.12 });
    } else {
      // in the area band, clear of the FLOW label below it
      labelBlock(ctx, "MAKE A SOUND TO SEE THEM VIBRATE", tx0, (yA0 + yA1) / 2, tx1 - tx0, { size: 9, color: TEXT.secondary, ls: 0.16 });
    }
  });
  return <canvas ref={ref} className="instrument-canvas" aria-label="Vocal folds seen from above, replayed slowly, with the glottal area and flow" role="img" />;
}
