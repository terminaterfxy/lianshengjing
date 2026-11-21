import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { openQuotient } from "/Users/tr/Desktop/视唱/chimera/src/mic/glottis.ts";
const D = process.argv[2], B = process.argv[3];
const rows: any[] = []; for (const d of readdirSync(D + "/d").filter((d) => d.startsWith(B + "_"))) { const f = `${D}/d/${d}/features.json`; if (existsSync(f)) rows.push(...JSON.parse(readFileSync(f, "utf8"))); }
function solve(A: number[][], b: number[]) { const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; } }
  return M.map((r, i) => r[n] / r[i]); }
function ols(X: number[][], y: number[]) { const k = X[0].length; const A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
  X.forEach((x, i) => { for (let a = 0; a < k; a++) { b[a] += x[a] * y[i]; for (let c = 0; c < k; c++) A[a][c] += x[a] * x[c]; } }); for (let a = 0; a < k; a++) A[a][a] += 1e-6; return solve(A, b); }
const dot = (w: number[], x: number[]) => w.reduce((s, v, i) => s + v * x[i], 0);
const X = (r: any) => { const l = Math.log2(r.mf0 / 220), n = (50 - Math.max(20, Math.min(50, r.msnr))) / 25; return [1, r.cpp, r.h1h2c, r.tilt, l, r.cpp * l, r.h1h2c * l, r.tilt * l, n, n * n, r.cpp * n, r.h1h2c * n, r.tilt * n, l * n]; };
const vowels = ["ɑ", "i", "u", "ɛ", "o"];
// predictions for every clip from a fit that never saw its vowel
const pred = new Map<any, number>();
for (const v of vowels) { const tr = rows.filter((r) => r.vowel !== v); const w = ols(tr.map(X), tr.map((r) => r.oq)); for (const r of rows.filter((r) => r.vowel === v)) pred.set(r, dot(w, X(r))); }
const old = (r: any) => openQuotient({ cpp: r.cpp, h1h2c: r.h1h2c, tilt: r.tilt, h1h2: r.h1h2, hnr: r.hnr, hnrHi: r.hnrHi }, r.mf0, r.msnr, B as any);
const stat = (sel: any[], f: (r: any) => number) => { let ae = 0, se = 0, bias = 0; const ys = sel.map((r) => r.oq), my = ys.reduce((s, v) => s + v, 0) / ys.length; for (const r of sel) { const e = f(r) - r.oq; ae += Math.abs(e); se += e * e; bias += e; } return `${(ae / sel.length).toFixed(3)} (R² ${(1 - se / ys.reduce((s, v) => s + (v - my) ** 2, 0)).toFixed(2)}, bias ${(bias / sel.length >= 0 ? "+" : "") + (bias / sel.length).toFixed(3)})`; };
console.log(`${B}: ${rows.length} clips; true open quotient ${Math.min(...rows.map((r) => r.oq)).toFixed(2)}–${Math.max(...rows.map((r) => r.oq)).toFixed(2)}`);
console.log("mean abs error".padEnd(26), "current page fit".padEnd(34), "refit on all of this (unseen vowel)");
const line = (name: string, sel: any[]) => sel.length && console.log(name.padEnd(26), stat(sel, old).padEnd(34), stat(sel, (r) => pred.get(r)!));
line("all", rows);
for (const p of [4, 7.2, 11]) line(`lung pressure ${p}`, rows.filter((r) => r.pressure === p));
for (const t of [0, 0.25, 0.5]) line(`reverb RT60 ${t}s`, rows.filter((r) => r.rt60 === t));
for (const s of [60, 40, 32, 25]) line(`noise SNR ${s} dB`, rows.filter((r) => r.snr === s));
for (const s of [48000, 44100]) line(`sample rate ${s}`, rows.filter((r) => r.rate === s));
line("mic tilt bright", rows.filter((r) => r.micTilt > 0.3)); line("mic tilt dull", rows.filter((r) => r.micTilt < -0.3));
for (const f0 of [...new Set(rows.map((r) => r.f0))].sort((a, b) => a - b)) line(`pitch ${f0} Hz`, rows.filter((r) => r.f0 === f0));
for (const rg of [0, 0.1, 0.3]) line(`roughness ${rg}`, rows.filter((r) => r.rough === rg));
// pairs: same vowel, pitch, pressure and listening conditions class; true difference ≥ 0.06
for (const [nm, f] of [["current", old], ["refit", (r: any) => pred.get(r)!]] as [string, (r: any) => number][]) { let right = 0, tot = 0; const by: Record<string, any[]> = {};
  for (const r of rows) (by[`${r.vowel}|${r.f0}|${r.pressure}|${r.rough}|${r.vib}`] ??= []).push(r);
  for (const g of Object.values(by)) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) { if (Math.abs(g[i].oq - g[j].oq) < 0.06) continue; tot++; if ((f(g[i]) - f(g[j])) * (g[i].oq - g[j].oq) > 0) right++; }
  console.log(`two takes (same vowel, pitch, loudness; different rooms and noise), true difference ≥ 0.06 — ${nm}: right ${(100 * right / tot).toFixed(1)}% of ${tot}`); }
const w = ols(rows.map(X), rows.map((r) => r.oq)); writeFileSync(`${D}/fit3_${B}.json`, JSON.stringify(w.map((v) => +v.toPrecision(6))));
