/**
 * How the vocal folds close, read from the sound: the measures voice science uses for it.
 *
 *  - H1*−H2*: the first harmonic against the second, with the vowel's formants taken out
 *    (Iseli & Alwan's correction). Folds that stay open longer in each cycle give a stronger
 *    fundamental, so this follows the open quotient.
 *  - CPP, the cepstral peak prominence: how far the voice's periodicity stands above its noise.
 *    Air leaking through folds that never quite meet lowers it.
 *  - tilt: the fundamental against the strongest harmonic at 2–4 kHz. An abrupt, firm closure
 *    lifts the high harmonics.
 *
 * `glottalFeatures` is pure; the fit that turns the features into an open quotient and a leak
 * is in glottisFit.generated.json (tools: crates/chimera/examples/glottis_sweep.rs renders voices
 * whose folds are known, and the fit is checked against them).
 */
export interface GlottalFeatures {
  /** dB */
  h1h2: number;
  /** dB, formant-corrected */
  h1h2c: number;
  /** dB, formant-corrected: fundamental over the strongest 2–4 kHz harmonic */
  tilt: number;
  /** dB */
  cpp: number;
  /** harmonics-to-noise in 0.5–4 kHz, dB */
  hnr: number;
  /** harmonics-to-noise in 2.5–5 kHz, dB */
  hnrHi: number;
}

const N = 4096;
const re = new Float64Array(N), im = new Float64Array(N), db = new Float64Array(N / 2);
const win: Float64Array[] = [];

export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len *= 2) {
    const ang = (-2 * Math.PI) / len, sr = Math.cos(ang), si = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nw = wr * sr - wi * si;
        wi = wr * si + wi * sr;
        wr = nw;
      }
    }
  }
}

/** What a formant at F (bandwidth B) adds at frequency f, dB (an all-pole resonance, unity at DC). */
function formantGain(f: number, F: number, B: number, fs: number): number {
  const r = Math.exp((-Math.PI * B) / fs), th = (2 * Math.PI * F) / fs, w = (2 * Math.PI * f) / fs;
  const num = (1 - 2 * r * Math.cos(th) + r * r) ** 2;
  const den = (1 - 2 * r * Math.cos(th + w) + r * r) * (1 - 2 * r * Math.cos(th - w) + r * r);
  return 10 * Math.log10(num / den);
}

/** Features of one frame (≥ 3 pitch periods) of a voiced sound; null when f0 can't be worked with. */
export function glottalFeatures(x: Float32Array, sampleRate: number, f0: number, formants: number[]): GlottalFeatures | null {
  if (!(f0 > 60) || f0 > 1000 || x.length < (3 * sampleRate) / f0) return null;
  const n = Math.min(x.length, N);
  let w = win[n];
  if (!w) {
    w = win[n] = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  re.fill(0);
  im.fill(0);
  for (let i = 0; i < n; i++) re[i] = x[x.length - n + i] * w[i];
  fft(re, im);
  const half = N / 2, hz = sampleRate / N;
  for (let k = 0; k < half; k++) db[k] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-20);

  // a harmonic: the peak within a tenth of f0 of where it should be
  const peak = (f: number): { f: number; a: number } => {
    const lo = Math.max(1, Math.round((f - 0.1 * f0) / hz)), hi = Math.min(half - 2, Math.round((f + 0.1 * f0) / hz));
    let b = lo;
    for (let k = lo; k <= hi; k++) if (db[k] > db[b]) b = k;
    return { f: b * hz, a: db[b] };
  };
  const fm = formants.filter((f) => f > 150 && f < 5000).slice(0, 4);
  const corr = (f: number) => fm.reduce((s, F) => s + formantGain(f, F, 80 + (120 * F) / 5000, sampleRate), 0);
  const h1 = peak(f0), h2 = peak(2 * f0);
  let top = { f: 0, a: -Infinity };
  for (let k = Math.ceil(2000 / f0); k * f0 <= 4000; k++) {
    const p = peak(k * f0);
    if (p.a > top.a) top = p;
  }
  if (!Number.isFinite(top.a)) top = peak(Math.round(3000 / f0) * f0);

  // harmonics against what lies between them, 0.5–4 kHz
  let harm = 0, noise = 0, nh = 0;
  for (let k = Math.max(1, Math.ceil(500 / f0)); k * f0 <= 4000; k++) {
    const p = peak(k * f0);
    const mid = Math.round(((k + 0.5) * f0) / hz);
    if (mid >= half - 2) break;
    harm += 10 ** (p.a / 10);
    noise += 10 ** ((db[mid - 1] + db[mid] + db[mid + 1]) / 30);
    nh++;
  }
  const hnr = nh ? 10 * Math.log10(harm / (noise + 1e-20)) : 0;
  // the same at 2.5–5 kHz, where the breath's hiss is and the harmonics are weak
  let harmHi = 0, noiseHi = 0, nHi = 0;
  for (let k = Math.max(1, Math.ceil(2500 / f0)); k * f0 <= 5000; k++) {
    const p = peak(k * f0);
    const mid = Math.round(((k + 0.5) * f0) / hz);
    if (mid >= half - 2) break;
    harmHi += 10 ** (p.a / 10);
    noiseHi += 10 ** ((db[mid - 1] + db[mid] + db[mid + 1]) / 30);
    nHi++;
  }
  const hnrHi = nHi ? 10 * Math.log10(harmHi / (noiseHi + 1e-20)) : 0;

  // cepstral peak prominence: the cepstrum's peak at the pitch period over its trend line
  for (let k = 0; k < half; k++) {
    re[k] = db[k];
    im[k] = 0;
  }
  for (let k = half; k < N; k++) {
    re[k] = db[N - k === half ? half - 1 : N - k];
    im[k] = 0;
  }
  fft(re, im);
  const q0 = Math.floor(sampleRate / 1000), q1 = Math.min(half - 1, Math.ceil(sampleRate / 60));
  let sx = 0, sy = 0, sxx = 0, sxy = 0, cnt = 0;
  const cep = (q: number) => 20 * Math.log10(Math.hypot(re[q], im[q]) / N + 1e-12);
  let best = -Infinity, bq = q0;
  const want = sampleRate / f0;
  for (let q = q0; q <= q1; q++) {
    const c = cep(q);
    sx += q;
    sy += c;
    sxx += q * q;
    sxy += q * c;
    cnt++;
    if (Math.abs(q - want) <= 0.15 * want && c > best) {
      best = c;
      bq = q;
    }
  }
  const slope = (cnt * sxy - sx * sy) / (cnt * sxx - sx * sx), icpt = (sy - slope * sx) / cnt;
  const cpp = Number.isFinite(best) ? best - (icpt + slope * bq) : 0;

  return {
    h1h2: h1.a - h2.a,
    h1h2c: h1.a - corr(h1.f) - (h2.a - corr(h2.f)),
    tilt: h1.a - corr(h1.f) - (top.a - corr(top.f)),
    cpp,
    hnr,
    hnrHi,
  };
}

/**
 * Fits of the open quotient to the features, one per kind of voice, from the engine's own voices
 * (crates/chimera/examples/glottis_sweep.rs: five vowels × pitches × breathiness × tension, clean
 * and with roughness, vibrato, room noise and a small microphone's high-pass).
 *
 * How good it is, on the engine's voices and vowels a fit never saw, each clip heard through a
 * random room (reverberation up to RT60 0.5 s), microphone tilt, noise down to 25 dB SNR and
 * either 44.1 or 48 kHz: the mean error is about 0.04 of an open quotient that spans 0.35–0.88,
 * and none of those listening conditions moves it by more than 0.005. What does move it is how
 * loud the singer sings, which the features don't carry: at a soft lung pressure (4 cmH₂O) it
 * reads about 0.04 too closed, at a loud one (11) about 0.035 too open. Of two takes of one vowel
 * at one pitch that differ by 0.06 or more, it ranks 97–98 % the right way round at the same
 * loudness and 94–96 % across loudness. So: compare takes sung about as loud (the page says when
 * they aren't), and read the number itself as good to a few points. A real voice through a real
 * phone has not been measured.
 * Terms: 1, cpp, h1h2c, tilt, l, cpp·l, h1h2c·l, tilt·l, n, n², cpp·n, h1h2c·n, tilt·n, l·n with
 * l = log2(f0 / 220) and n = (50 − SNR dB) / 25.
 */
const FIT = {
  female: [0.953243, -0.0127249, 0.00252955, 0.0011595, 0.190104, -0.0041628, -0.00163035, -0.00151643, -0.0397413, -0.0319615, 0.000575912, 0.000638268, 0.00109994, -0.0365535],
  male: [0.895198, -0.0128682, 0.00157918, 0.000966234, 0.199554, -0.00526218, -0.00851182, 0.000271294, -0.00354081, -0.0500296, 0.000123082, 0.00177522, 0.000699995, -0.0534509],
};

/**
 * The share of each cycle the folds are apart (0.4 pressed … 0.85 loose), estimated from one
 * frame's features. `snrDb`: the voice's level over the room's. An estimate, not a measurement.
 */
export function openQuotient(g: GlottalFeatures, f0: number, snrDb: number, voice: "female" | "male"): number {
  const w = FIT[voice];
  const l = Math.log2(f0 / 220), n = (50 - Math.max(20, Math.min(50, snrDb))) / 25;
  const x = [1, g.cpp, g.h1h2c, g.tilt, l, g.cpp * l, g.h1h2c * l, g.tilt * l, n, n * n, g.cpp * n, g.h1h2c * n, g.tilt * n, l * n];
  let y = 0;
  for (let i = 0; i < x.length; i++) y += w[i] * x[i];
  return Math.max(0.35, Math.min(0.92, y));
}
