// Features of every clip of one sweep directory, each clip heard through a random but repeatable
// "room and phone": sample rate, reverberation, a tilt in the microphone's response, noise.
import { readFileSync, writeFileSync } from "node:fs";
import { analyse } from "/Users/tr/Desktop/视唱/chimera/src/mic/formants.ts";
import { glottalFeatures } from "/Users/tr/Desktop/视唱/chimera/src/mic/glottis.ts";
const dir = process.argv[2];
const recs = JSON.parse(readFileSync(dir + "/sweep.json", "utf8"));
const buf = readFileSync(dir + "/sweep.f32"); const all = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
let seed = 0; for (const ch of dir) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => rnd() + rnd() + rnd() - 1.5;
function fft(re: Float64Array, im: Float64Array, inv = false) { const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len *= 2) { const ang = (inv ? 2 : -2) * Math.PI / len, sr = Math.cos(ang), si = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let wr = 1, wi = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2; const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nw = wr * sr - wi * si; wi = wr * si + wi * sr; wr = nw; } } }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; } }
const M = 65536;
function reverb(x: Float32Array, rt60: number, drr: number): Float32Array {
  // direct sound, then decaying noise from 4 ms on; drr: direct over reverberant energy, dB
  const L = Math.min(M - x.length - 1, Math.round(rt60 * 48000)); const h = new Float64Array(M); let e = 0;
  for (let i = 192; i < L; i++) { h[i] = gauss() * Math.exp(-6.908 * i / (rt60 * 48000)); e += h[i] * h[i]; }
  const g = Math.sqrt(10 ** (-drr / 10) / e); for (let i = 192; i < L; i++) h[i] *= g; h[0] = 1;
  const xr = new Float64Array(M), xi = new Float64Array(M), hi = new Float64Array(M); xr.set(x); fft(xr, xi); fft(h, hi);
  for (let k = 0; k < M; k++) { const a = xr[k] * h[k] - xi[k] * hi[k], b = xr[k] * hi[k] + xi[k] * h[k]; xr[k] = a; xi[k] = b; }
  fft(xr, xi, true); return Float32Array.from(xr.subarray(0, x.length)); }
function resample(x: Float32Array, from: number, to: number): Float32Array { if (from === to) return x; const n = Math.floor(x.length * to / from), y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = i * from / to, k = Math.floor(p), f = p - k; const a = x[Math.max(0, k - 1)], b = x[k], c = x[Math.min(x.length - 1, k + 1)], d = x[Math.min(x.length - 1, k + 2)];
    y[i] = b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a))); } return y; }
const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
const rows: any[] = []; let bad = 0;
for (const r of recs) {
  let x = Float32Array.from(all.subarray(r.offset, r.offset + r.len));
  const rt60 = [0, 0, 0.25, 0.25, 0.5][Math.floor(rnd() * 5)], drr = 6 + 10 * rnd();
  const snr = [60, 60, 40, 32, 25][Math.floor(rnd() * 5)], tilt = (rnd() - 0.5) * 1.2, rate = rnd() < 0.5 ? 48000 : 44100;
  if (rt60) x = reverb(x, rt60, drr);
  // the microphone: a tilt (first difference mixed in), and a 150 Hz high-pass
  let px = 0; for (let i = 0; i < x.length; i++) { const v = x[i]; x[i] = v + tilt * (v - px); px = v; }
  let qx = 0, qy = 0; const a = Math.exp(-2 * Math.PI * 150 / 48000); for (let i = 0; i < x.length; i++) { const v = x[i]; qy = a * (qy + v - qx); qx = v; x[i] = qy; }
  let e = 0; for (let i = 14400; i < x.length; i++) e += x[i] * x[i]; const sig = Math.sqrt(e / (x.length - 14400));
  const sd = sig * 10 ** (-snr / 20); let lp = 0; for (let i = 0; i < x.length; i++) { const wn = gauss() * 2; lp += 0.02 * (wn - lp); x[i] += sd * (0.6 * wn + 6 * lp) / 1.4; }
  x = resample(x, 48000, rate);
  const acc: Record<string, number[]> = { h1h2: [], h1h2c: [], tilt: [], cpp: [], hnr: [], hnrHi: [], f0: [], lv: [] };
  const start = Math.round(0.3 * rate);
  for (let s = start; s + 2048 <= x.length; s += 1024) {
    const fr = analyse(x.subarray(s, s + 2048), rate);
    if (!fr.voiced || Math.abs(1200 * Math.log2(fr.f0 / r.f0)) > 150) continue;
    const g = glottalFeatures(x.subarray(s, s + 2048), rate, fr.f0, fr.formants); if (!g) continue;
    for (const k of ["h1h2", "h1h2c", "tilt", "cpp", "hnr", "hnrHi"]) acc[k].push((g as any)[k]); acc.f0.push(fr.f0); acc.lv.push(fr.level);
  }
  if (acc.cpp.length < 3) { bad++; continue; }
  const noiseDb = 20 * Math.log10(sd * 1.05 + 1e-9);
  const row: any = { vowel: r.vowel, f0: r.f0, breath: r.breath, tension: r.tension, pressure: r.pressure, rough: r.rough, vib: r.vib, oq: r.oq, leak: r.leak, rt60, drr: rt60 ? drr : 99, snr, micTilt: tilt, rate, mf0: med(acc.f0), msnr: Math.min(50, med(acc.lv) - noiseDb) };
  for (const k of ["h1h2", "h1h2c", "tilt", "cpp", "hnr", "hnrHi"]) row[k] = med(acc[k]);
  rows.push(row);
}
writeFileSync(dir + "/features.json", JSON.stringify(rows));
console.log(dir.split("/").pop(), "clips", rows.length, "unusable", bad);
