/**
 * Calibration to one singer: the formants she gives three reference vowels (啊 /a/, 衣 /i/,
 * 乌 /u/, the corners of the vowel space) against the model body's formants for the same three.
 * The map is affine in log-frequency: exact at the three corners, proportional between them. So a
 * voice whose tract is longer or shorter than the model's, or whose vowels sit elsewhere, lands
 * where the model has that vowel. Pure, for tests.
 */
export interface FPoint {
  F1: number;
  F2: number;
}

/** the reference vowels, in the order they are asked for */
export const REFS = [
  { ipa: "ɑ", char: "啊", hint: "嘴张大，舌头放平" },
  { ipa: "i", char: "衣", hint: "嘴角咧开，舌头靠前" },
  { ipa: "u", char: "乌", hint: "嘴唇撮圆，舌头靠后" },
] as const;

export type Calibration = [FPoint, FPoint, FPoint];

/** x' = a·x + b·y + c, y' = d·x + e·y + f, on (ln F1, ln F2) */
export type Affine = [number, number, number, number, number, number];

const L = (p: FPoint): [number, number] => [Math.log(p.F1), Math.log(p.F2)];

/** Why these three can't be used, or null: they must be three different vowels, the right way round. */
export function calibrationProblem(c: Calibration): string | null {
  const [a, i, u] = c;
  if (!(a.F1 > i.F1 * 1.25 && a.F1 > u.F1 * 1.15)) return "“啊”听起来不比“衣”“乌”更开，请把嘴张大重录。";
  if (!(i.F2 > u.F2 * 1.5)) return "“衣”和“乌”听起来太接近，请把“衣”咧开、“乌”撮圆重录。";
  if (!(i.F2 > a.F2 * 1.15)) return "“衣”听起来不比“啊”更靠前，请重录。";
  return null;
}

/** The map taking the singer's three vowels onto the model's (null if they don't span a triangle). */
export function fitAffine(from: Calibration, to: Calibration): Affine | null {
  const [p0, p1, p2] = from.map(L), [q0, q1, q2] = to.map(L);
  const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
  if (Math.abs(det) < 0.02) return null;
  const row = (k: 0 | 1): [number, number, number] => {
    const d1 = q1[k] - q0[k], d2 = q2[k] - q0[k];
    const a = (d1 * (p2[1] - p0[1]) - d2 * (p1[1] - p0[1])) / det;
    const b = (d2 * (p1[0] - p0[0]) - d1 * (p2[0] - p0[0])) / det;
    return [a, b, q0[k] - a * p0[0] - b * p0[1]];
  };
  return [...row(0), ...row(1)];
}

export function applyAffine(m: Affine, p: FPoint): FPoint {
  const [x, y] = L(p);
  return { F1: Math.exp(m[0] * x + m[1] * y + m[2]), F2: Math.exp(m[3] * x + m[4] * y + m[5]) };
}

const KEY = "chimera.mic.calibration";

export function loadCalibration(): Calibration | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null") as Calibration | null;
    return Array.isArray(c) && c.length === 3 && c.every((p) => p && p.F1 > 0 && p.F2 > 0) ? c : null;
  } catch {
    return null;
  }
}

export function saveCalibration(c: Calibration | null): void {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    // private browsing: the calibration lasts until the page closes
  }
}

/** how long each reference vowel is listened to, s */
export const CAL_SECONDS = 1.5;

const median = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];

/**
 * One calibration being recorded: each reference vowel in turn, held for CAL_SECONDS in all,
 * with a pause before the next (so the end of one vowel is never taken for the start of another).
 */
export class CalibrationRun {
  step = 0;
  private got: FPoint[] = [];
  private F1: number[] = [];
  private F2: number[] = [];
  private time = 0;
  private armed = true;

  /** share of the current vowel heard so far, 0…1 */
  get progress(): number {
    return Math.min(1, this.time / CAL_SECONDS);
  }

  /**
   * One frame: `vowel` is this frame's own formants when it is a readable vowel, else null;
   * `silent` when nothing sounds. Returns the three vowels once the last is done, else null.
   */
  feed(vowel: FPoint | null, silent: boolean, dt: number): Calibration | null {
    if (silent) this.armed = true;
    if (!this.armed || !vowel) return null;
    this.F1.push(vowel.F1);
    this.F2.push(vowel.F2);
    this.time += dt;
    if (this.time < CAL_SECONDS) return null;
    this.got.push({ F1: median(this.F1), F2: median(this.F2) });
    this.F1 = [];
    this.F2 = [];
    this.time = 0;
    this.armed = false;
    this.step++;
    return this.step >= REFS.length ? (this.got as Calibration) : null;
  }
}
