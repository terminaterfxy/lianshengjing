/**
 * The singer's long breaths over the days: each one's length and how steady its level was, kept on
 * the phone so progress shows. A breath is the session's (breath.ts): from the first sound of a
 * phrase until a second of quiet. Pure, for tests; the page stores the list.
 */
import type { Steadiness } from "./breath.ts";

export interface BreathRecord {
  /** when it ended, ms since 1970 */
  at: number;
  /** how long it lasted, s */
  seconds: number;
  /** how much its level wandered around its trend, dB */
  sd: number;
  /** where its level was heading, dB/s */
  slope: number;
}

/** a breath this long or longer is kept, s (a short one says nothing about the breath) */
export const LONG_BREATH = 2;
/** the newest this many are kept (a few years of practice; a few tens of kB) */
export const MAX_RECORDS = 2000;

const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;

/** The record of a breath that has just ended at `at`, or null when it is too short to keep. */
export function recordOf(s: Steadiness | null, at: number): BreathRecord | null {
  if (!s || s.sd === null || !(s.seconds >= LONG_BREATH)) return null;
  return { at, seconds: round(s.seconds, 1), sd: round(s.sd, 2), slope: round(s.slope, 2) };
}

export function addRecord(list: readonly BreathRecord[], r: BreathRecord): BreathRecord[] {
  const out = [...list, r];
  return out.length > MAX_RECORDS ? out.slice(out.length - MAX_RECORDS) : out;
}

/** The stored list, or empty when there is none or it is unreadable. */
export function parseRecords(json: string | null): BreathRecord[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.filter((r): r is BreathRecord => !!r && typeof r === "object" && [r.at, r.seconds, r.sd, r.slope].every((x) => typeof x === "number" && Number.isFinite(x)));
  } catch {
    return [];
  }
}

export interface DaySummary {
  /** the local date, YYYY-MM-DD */
  key: string;
  month: number;
  day: number;
  count: number;
  longest: BreathRecord;
  steadiest: BreathRecord;
  /** the day's typical wander (the median), dB */
  sd: number;
}

const dayKey = (at: number) => {
  const d = new Date(at);
  return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, month: d.getMonth() + 1, day: d.getDate() };
};

/** One summary per day with breaths, oldest first, by the phone's own calendar. */
export function byDay(list: readonly BreathRecord[]): DaySummary[] {
  const days = new Map<string, { month: number; day: number; rs: BreathRecord[] }>();
  for (const r of list) {
    const k = dayKey(r.at);
    const d = days.get(k.key);
    if (d) d.rs.push(r);
    else days.set(k.key, { month: k.month, day: k.day, rs: [r] });
  }
  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, { month, day, rs }]) => {
      const sds = rs.map((r) => r.sd).sort((a, b) => a - b);
      const mid = sds.length >> 1;
      return {
        key,
        month,
        day,
        count: rs.length,
        longest: rs.reduce((a, b) => (b.seconds > a.seconds ? b : a)),
        steadiest: rs.reduce((a, b) => (b.sd < a.sd ? b : a)),
        sd: sds.length % 2 ? sds[mid] : (sds[mid - 1] + sds[mid]) / 2,
      };
    });
}

/** Today's key, for picking today out of `byDay`. */
export const todayKey = (now = Date.now()): string => dayKey(now).key;
