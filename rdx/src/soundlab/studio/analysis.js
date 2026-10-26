/* Objective measurements of a rendered or recorded sound. These are facts
 * for the person and the controlling agent to judge fit with; the app does
 * not score taste. Pure module (node --test friendly). */

const EPS = 1e-9;
const toDb = x => 20 * Math.log10(Math.max(EPS, x));
const round = (n, p = 1) => Math.round(n * 10 ** p) / 10 ** p;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function monoOf(buf) {
  if (!buf.right || buf.right === buf.left) return buf.left;
  const m = new Float32Array(buf.left.length);
  for (let i = 0; i < m.length; i++) m[i] = (buf.left[i] + buf.right[i]) / 2;
  return m;
}

export const BANDS = Object.freeze([[20, 150, 'sub/low'], [150, 500, 'low-mid'], [500, 2000, 'mid'], [2000, 6000, 'presence'], [6000, 20000, 'air']]);
const SPEC_BINS = 48;
/* Fixed log-spaced bin edges, 20 Hz - 20 kHz, so spectra at different
 * sample rates line up bin for bin (bins above Nyquist stay empty). */
export const SPEC_EDGES = Object.freeze(Array.from({ length: SPEC_BINS + 1 }, (_, b) => 20 * Math.pow(1000, b / SPEC_BINS)));

/* Spectral frames: magnitude in SPEC_BINS log-spaced bins (SPEC_EDGES). */
export function spectrogram(mono, sampleRate, { size = 1024, hop = 512 } = {}) {
  const frames = [];
  const win = new Float32Array(size).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
  const nyq = sampleRate / 2, edges = SPEC_EDGES;
  for (let off = 0; off + size <= Math.max(size, mono.length); off += hop) {
    const re = new Float32Array(size), im = new Float32Array(size);
    for (let i = 0; i < size; i++) re[i] = (mono[off + i] || 0) * win[i];
    fft(re, im);
    const mags = new Float32Array(size / 2);
    for (let k = 0; k < size / 2; k++) mags[k] = Math.hypot(re[k], im[k]) / size;
    const bins = new Float32Array(SPEC_BINS);
    for (let b = 0; b < SPEC_BINS; b++) {
      if (edges[b] >= nyq) break;
      const k0 = Math.max(1, Math.floor(edges[b] / nyq * size / 2)), k1 = Math.max(k0 + 1, Math.ceil(edges[b + 1] / nyq * size / 2));
      let s = 0; for (let k = k0; k < k1 && k < mags.length; k++) s = Math.max(s, mags[k]);
      bins[b] = s;
    }
    frames.push({ timeMs: off / sampleRate * 1000, mags, bins });
    if (mono.length < size) break;
  }
  return { frames, edges, size, hop };
}

/* Peak/RMS/duration/onset/centroid/band balance of a stereo or mono buffer. */
export function analyze(buf, { waveformPoints = 240 } = {}) {
  const sr = buf.sampleRate, mono = monoOf(buf), n = mono.length;
  let peak = 0, peakAt = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(mono[i]); if (a > peak) { peak = a; peakAt = i; } }
  if (!n || peak < 1e-6) return { silent: true, durationMs: round(n / sr * 1000), peakDb: -Infinity, rmsDb: -Infinity };
  const onsetThresh = peak * 0.1, tailThresh = peak * 0.001;
  let onset = 0; while (onset < n && Math.abs(mono[onset]) < onsetThresh) onset++;
  let end = n - 1; while (end > onset && Math.abs(mono[end]) < tailThresh) end--;
  let sum = 0, maxWin = 0, winSum = 0;
  const w = Math.max(1, Math.round(sr * 0.05));
  for (let i = onset; i <= end; i++) {
    sum += mono[i] * mono[i]; winSum += mono[i] * mono[i];
    if (i - onset >= w) winSum -= mono[i - w] * mono[i - w];
    maxWin = Math.max(maxWin, winSum / w);
  }
  const spec = spectrogram(mono.subarray(onset, end + 1), sr);
  const band = BANDS.map(() => 0);
  const avg = new Float64Array(SPEC_BINS);
  for (const f of spec.frames) for (let k = 0; k < SPEC_BINS; k++) avg[k] += f.bins[k] * f.bins[k];
  let num = 0, den = 0;
  const binHz = sr / spec.size;
  for (const f of spec.frames) for (let k = 1; k < f.mags.length; k++) {
    const hz = k * binHz, e = f.mags[k] * f.mags[k];
    num += hz * e; den += e;
    const bi = BANDS.findIndex(([lo, hi]) => hz >= lo && hz < hi);
    if (bi >= 0) band[bi] += e;
  }
  const bandTotal = band.reduce((a, b) => a + b, 0) || 1;
  /* decay: time from peak until the 50 ms RMS falls 20 dB below its max */
  let decayEnd = peakAt, ws = 0;
  for (let i = peakAt; i <= end; i++) {
    ws += mono[i] * mono[i]; if (i - peakAt >= w) ws -= mono[i - w] * mono[i - w];
    if (i - peakAt >= w && ws / w > maxWin * 0.01) decayEnd = i;
  }
  const points = [];
  const step = Math.max(1, Math.ceil(n / waveformPoints));
  for (let i = 0; i < n; i += step) {
    let lo = 0, hi = 0; for (let j = i; j < Math.min(n, i + step); j++) { lo = Math.min(lo, mono[j]); hi = Math.max(hi, mono[j]); }
    points.push([round(lo, 3), round(hi, 3)]);
  }
  let stereoWidth = 0;
  if (buf.right && buf.right !== buf.left) {
    let l = 0, r = 0; for (let i = 0; i < n; i++) { l += buf.left[i] ** 2; r += buf.right[i] ** 2; }
    stereoWidth = round((r - l) / (r + l + EPS), 2);
  }
  return {
    silent: false,
    durationMs: round((end - onset + 1) / sr * 1000),
    totalMs: round(n / sr * 1000),
    onsetMs: round(onset / sr * 1000),
    attackMs: round((peakAt - onset) / sr * 1000),
    decayMs: round((decayEnd - peakAt) / sr * 1000),
    peakDb: round(toDb(peak)),
    rmsDb: round(toDb(Math.sqrt(sum / Math.max(1, end - onset + 1)))),
    loudestDb: round(toDb(Math.sqrt(maxWin))),
    crestDb: round(toDb(peak) - toDb(Math.sqrt(sum / Math.max(1, end - onset + 1)))),
    centroidHz: Math.round(num / (den || 1)),
    bands: Object.fromEntries(BANDS.map(([, , name], i) => [name, round(band[i] / bandTotal, 3)])),
    balance: round(stereoWidth, 2),
    spectrum: Array.from(avg, v => round(toDb(Math.sqrt(v / Math.max(1, spec.frames.length))), 1)),
    waveform: points,
    spectrogram: spectrogram(mono, sr, { size: 512, hop: Math.max(256, Math.ceil(n / 160)) }).frames.map(f => Array.from(f.bins, v => round(toDb(v), 0)))
  };
}

/* Side-by-side numbers for candidate vs reference (the original sound). */
export function compare(candidate, reference) {
  if (!candidate || !reference || candidate.silent || reference.silent) return null;
  /* Shape distance: mean absolute dB difference of the level-normalised
   * average spectra over bins either sound actually uses. */
  const A = candidate.spectrum, B = reference.spectrum;
  const peakA = Math.max(...A), peakB = Math.max(...B);
  let diff = 0, used = 0;
  for (let i = 0; i < A.length; i++) {
    const a = Math.max(A[i] - peakA, -60), b = Math.max(B[i] - peakB, -60);
    if (a <= -60 && b <= -60) continue;
    diff += Math.abs(a - b); used += 1;
  }
  const distance = used ? diff / used : 0;
  return {
    durationRatio: round(candidate.durationMs / (reference.durationMs || 1), 2),
    loudnessDiffDb: round(candidate.loudestDb - reference.loudestDb),
    peakDiffDb: round(candidate.peakDb - reference.peakDb),
    centroidRatio: round(candidate.centroidHz / (reference.centroidHz || 1), 2),
    attackDiffMs: round(candidate.attackMs - reference.attackMs),
    spectralDistanceDb: round(distance),
    spectralSimilarity: round(Math.max(0, 1 - distance / 30), 2)
  };
}

/* Drop the bulky arrays for agent responses unless asked. */
export function summarize(a) {
  if (!a) return a;
  const { waveform, spectrogram: spec, spectrum, ...rest } = a;
  return rest;
}
