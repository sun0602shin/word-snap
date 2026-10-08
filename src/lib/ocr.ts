// Browser-only OCR pipeline for printed vocabulary tables: "English word | Korean meaning" rows
// arranged in one or more sections (e.g. 4 sections x 10 rows).
//
// 1. Preprocess the photo once (EXIF-aware load, size cap, grayscale + contrast stretch).
// 2. Layout pass: sparse English OCR on a downscaled page → left-aligned English anchors →
//    columns → sections → evenly pitched rows (missing rows interpolated).
// 3. Row pass: each row is cut into an English cell and a Korean cell, upscaled 2–3x and read
//    with a dedicated eng / kor worker (single-line mode) on several preprocessing variants;
//    the highest-confidence valid reading wins.
// 4. Second pass on empty / low-confidence rows when fewer words than expected were found.
import { uid, withSenses, type Word } from "./wordkok";
import { parseMeaning, joinSenses } from "./pos";
import { verifyAll } from "./dict";

export type OcrStage = { label: string; progress: number };
export type OcrResult = { words: Word[]; expected: number; recognized: number; low: number };
type Lang = "eng" | "kor";
type TW = import("tesseract.js").Worker;
type Box = { x0: number; y0: number; x1: number; y1: number };
type RawWord = { text: string; confidence: number; bbox: Box };

/* ---------------- workers (reused, lazily created, recreated after failure) ---------------- */
const workers: Partial<Record<Lang, Promise<TW>>> = {};
const modes = new WeakMap<TW, string>();
let stageCb: ((s: OcrStage) => void) | null = null;
let phase: "load" | "layout" | "rows" = "load";

const LOAD_LABEL: Record<string, string> = {
  "loading tesseract core": "인식 엔진 불러오는 중",
  "initializing tesseract": "인식 엔진 준비 중",
  "loading language traineddata": "데이터 내려받는 중",
  "initializing api": "인식 준비 중",
};

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(msg)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

export function getWorker(lang: Lang): Promise<TW> {
  if (!workers[lang]) {
    const name = lang === "eng" ? "영어" : "한국어";
    const p = withTimeout(
      (async () => {
        const T = await import("tesseract.js");
        const w = await T.createWorker(lang, T.OEM.LSTM_ONLY, {
          logger: (m: { status: string; progress: number }) => {
            if (m.status === "recognizing text") {
              if (phase === "layout") stageCb?.({ label: "구역과 줄 찾는 중", progress: 0.06 + 0.12 * (m.progress || 0) });
              return;
            }
            const l = LOAD_LABEL[m.status];
            if (l) stageCb?.({ label: `${name} ${l}`, progress: 0.02 + 0.04 * (m.progress || 0) });
          },
        });
        await w.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300" });
        return w;
      })(),
      120_000,
      "LOAD_TIMEOUT",
    );
    workers[lang] = p.catch((e) => { delete workers[lang]; throw e; });
  }
  return workers[lang]!;
}

/** Load English first, then Korean, to avoid a double memory spike on iPhone. */
export function warmUp() {
  getWorker("eng").then(() => getWorker("kor")).catch(() => {});
}

export async function resetWorkers() {
  for (const lang of ["eng", "kor"] as Lang[]) {
    const p = workers[lang];
    delete workers[lang];
    if (p) (await p.catch(() => null))?.terminate();
  }
}

async function setMode(w: TW, mode: "sparse" | "enLine" | "koLine" | "pos") {
  if (modes.get(w) === mode) return;
  const T = await import("tesseract.js");
  if (mode === "sparse") await w.setParameters({ tessedit_pageseg_mode: T.PSM.SPARSE_TEXT, tessedit_char_whitelist: "", tessedit_char_blacklist: "" });
  if (mode === "enLine") await w.setParameters({ tessedit_pageseg_mode: T.PSM.SINGLE_LINE, tessedit_char_whitelist: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-' ", tessedit_char_blacklist: "" });
  if (mode === "koLine") await w.setParameters({ tessedit_pageseg_mode: T.PSM.SINGLE_LINE, tessedit_char_whitelist: "", tessedit_char_blacklist: "0123456789|_@#$%^&*=+<>{}[]" });
  if (mode === "pos") await w.setParameters({ tessedit_pageseg_mode: T.PSM.SINGLE_WORD, tessedit_char_whitelist: "명동형부전접대감.", tessedit_char_blacklist: "" });
  modes.set(w, mode);
}

/** Rotate a canvas by a small angle (deskew), white background, same size. */
function rotated(src: HTMLCanvasElement, deg: number) {
  const c = newCanvas(src.width, src.height);
  const x = ctx2d(c);
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  x.translate(c.width / 2, c.height / 2);
  x.rotate((deg * Math.PI) / 180);
  x.imageSmoothingQuality = "high";
  x.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** Page skew from text-line baselines (degrees, positive = clockwise text). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function skewOf(blocks: any[]): number {
  const a: number[] = [];
  for (const b of blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) {
    const bl = l.baseline;
    if (!bl || bl.x1 - bl.x0 < 60) continue;
    a.push((Math.atan2(bl.y1 - bl.y0, bl.x1 - bl.x0) * 180) / Math.PI);
  }
  return a.length >= 3 ? median(a) : 0;
}

/* ---------------- image helpers ---------------- */
const newCanvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};
const ctx2d = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!;
const free = (c: HTMLCanvasElement) => { c.width = 0; c.height = 0; };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("IMAGE")); };
    img.src = url; // <img> honours EXIF orientation on iOS Safari
  });
}

/** Grayscale + percentile contrast stretch, long side capped (iOS canvas memory). */
export async function preprocess(file: Blob, rotation = 0, maxSide = 2400): Promise<HTMLCanvasElement> {
  const img = await loadImage(file);
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const scale = Math.min(maxSide / Math.max(w0, h0), 2);
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const rot = ((rotation % 360) + 360) % 360;
  const c = newCanvas(rot % 180 ? h : w, rot % 180 ? w : h);
  const ctx = ctx2d(c);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i]! * 0.299 + px[i + 1]! * 0.587 + px[i + 2]! * 0.114) | 0;
    px[i] = g;
    hist[g]!++;
  }
  const n = px.length / 4;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]!; if (acc > n * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]!; if (acc > n * 0.1) { hi = v; break; } }
  const range = Math.max(40, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    let v = ((px[i]! - lo) / range) * 255;
    if (v > 230) v = 255;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

function scaled(src: HTMLCanvasElement, f: number) {
  const c = newCanvas(src.width * f, src.height * f);
  const x = ctx2d(c);
  x.imageSmoothingQuality = "high";
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function cropScaled(src: HTMLCanvasElement, b: Box, scale: number, pad = 14) {
  const x0 = clamp(Math.round(b.x0), 0, src.width - 1), y0 = clamp(Math.round(b.y0), 0, src.height - 1);
  const w = clamp(Math.round(b.x1), x0 + 1, src.width) - x0, h = clamp(Math.round(b.y1), y0 + 1, src.height) - y0;
  const c = newCanvas(w * scale + pad * 2, h * scale + pad * 2);
  const x = ctx2d(c);
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingQuality = "high";
  x.drawImage(src, x0, y0, w, h, pad, pad, w * scale, h * scale);
  return c;
}

/** Sharpen (3x3) + Otsu binarisation. */
function thresholdVariant(src: HTMLCanvasElement) {
  const w = src.width, h = src.height;
  const c = newCanvas(w, h);
  const x = ctx2d(c);
  x.drawImage(src, 0, 0);
  const d = x.getImageData(0, 0, w, h);
  const p = d.data;
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0; i < g.length; i++) g[i] = p[i * 4]!;
  const s = new Uint8ClampedArray(g);
  for (let yy = 1; yy < h - 1; yy++)
    for (let xx = 1; xx < w - 1; xx++) {
      const i = yy * w + xx;
      s[i] = 5 * g[i]! - g[i - 1]! - g[i + 1]! - g[i - w]! - g[i + w]!;
    }
  const hist = new Array(256).fill(0) as number[];
  for (const v of s) hist[v]!++;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t]!;
  let sumB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = s.length - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; th = t; }
  }
  for (let i = 0; i < s.length; i++) { const v = s[i]! > th ? 255 : 0; p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v; }
  x.putImageData(d, 0, 0);
  return c;
}

function inkRatio(src: HTMLCanvasElement, b: Box) {
  const x0 = clamp(Math.round(b.x0), 0, src.width - 1), y0 = clamp(Math.round(b.y0), 0, src.height - 1);
  const w = clamp(Math.round(b.x1), x0 + 1, src.width) - x0, h = clamp(Math.round(b.y1), y0 + 1, src.height) - y0;
  const p = ctx2d(src).getImageData(x0, y0, w, h).data;
  let dark = 0, tot = 0;
  for (let i = 0; i < p.length; i += 8) { tot++; if (p[i]! < 110) dark++; }
  return tot ? dark / tot : 0;
}

function thumb(src: HTMLCanvasElement, b: Box) {
  const w = b.x1 - b.x0;
  const c = cropScaled(src, b, Math.min(1, 560 / Math.max(1, w)), 4);
  const url = c.toDataURL("image/jpeg", 0.6);
  free(c);
  return url;
}

/* ---------------- text cleaning ---------------- */
const HANGUL = /[가-힣]/g;
const hangulCount = (s: string) => (s.match(HANGUL) ?? []).length;
const EN_VALID = /^[a-z][a-z' -]*[a-z]$/;

/** Letters/hyphen/apostrophe only; fixes common l/I confusion only when confidence is not high. */
export function cleanEnglish(raw: string, conf = 0): string {
  let s = raw.replace(/[\n|]/g, " ").replace(/[^A-Za-z' -]/g, " ");
  s = s.replace(/([a-z])I(?=[a-z])/g, "$1l"); // "utiIize" → "utilize" (capital I inside lowercase word)
  if (conf < 90) s = s.replace(/(^|\s)I(?=[a-z]{2,})/g, "$1l"); // "Iift" → "lift"
  let toks = s.split(/\s+/).filter(Boolean);
  while (toks.length > 1 && toks[0]!.replace(/[^A-Za-z]/g, "").length <= 1) toks.shift(); // check marks, row bullets
  while (toks.length > 1 && toks[toks.length - 1]!.replace(/[^A-Za-z]/g, "").length <= 1) toks.pop();
  toks = toks.slice(0, 4);
  return toks.join(" ").toLowerCase().replace(/^[-' ]+|[-' ]+$/g, "");
}

/** Keep Korean, commas, slashes, parentheses, tildes; drop row numbers / stray latin / jamo. */
export function cleanMeaning(raw: string): string {
  let s = raw.replace(/\n/g, " ").replace(/[|_[\]{}<>]/g, " ");
  s = s.replace(/(^|\s)[A-Za-z0-9]+(?=\s|$)/g, " ").replace(/\d+/g, " ");
  s = s.replace(/(^|\s)[ㄱ-ㅣ]+(?=\s|$)/g, " ").replace(/\(\s*\)/g, " ");
  s = s.replace(/\s+([,)])/g, "$1").replace(/\(\s+/g, "(").replace(/\s*\/\s*/g, " / ").replace(/,(?=\S)/g, ", ");
  return s.replace(/\s+/g, " ").replace(/^[\s,./:;-]+|[\s,/:;.-]+$/g, "").trim();
}

/* ---------------- layout detection ---------------- */
type Row = { yc: number; half: number; enX0: number; split: number; right: number; anchorX1?: number };

function detectRows(words: RawWord[], f: number, base: HTMLCanvasElement, expected: number): { rows: Row[]; mh: number } {
  const toks = words.map((w) => ({ t: w.text.trim(), conf: w.confidence, x0: w.bbox.x0 * f, x1: w.bbox.x1 * f, y0: w.bbox.y0 * f, y1: w.bbox.y1 * f }));
  const anchors = toks.filter((t) => {
    const s = t.t.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    return s.length >= 2 && /^[A-Za-z][A-Za-z'-]*$/.test(s) && /[aeiouyAEIOUY]/.test(s) && t.conf >= 60 && !/^(day|qr|word|words)$/i.test(s);
  });
  if (anchors.length < 3) return { rows: [], mh: 0 };
  const mh = median(anchors.map((a) => a.y1 - a.y0)) || 20;

  // cluster left edges → columns
  anchors.sort((a, b) => a.x0 - b.x0);
  type Col = { x: number; items: typeof anchors };
  const cols: Col[] = [];
  for (const a of anchors) {
    const c = cols[cols.length - 1];
    if (c && a.x0 - c.x < mh * 1.3) { c.items.push(a); c.x = median(c.items.map((i) => i.x0)); }
    else cols.push({ x: a.x0, items: [a] });
  }
  const maxN = Math.max(...cols.map((c) => c.items.length));
  const good = cols.filter((c) => {
    if (c.items.length < Math.max(3, maxN * 0.3)) return false;
    // one anchor per line: the leftmost token of the English cell
    const meanConf = c.items.reduce((s, i) => s + i.conf, 0) / c.items.length;
    return meanConf >= 72;
  });

  type Sec = { colX: number; ys: { y: number; x1: number }[]; pitch: number };
  const secs: Sec[] = [];
  for (const c of good) {
    const items = [...c.items].sort((a, b) => a.y0 - b.y0);
    const ys: { y: number; x1: number; conf: number }[] = [];
    for (const it of items) {
      const yc = (it.y0 + it.y1) / 2;
      const last = ys[ys.length - 1];
      if (last && yc - last.y < mh * 0.6) { if (it.conf > last.conf) Object.assign(last, { y: yc, x1: it.x1, conf: it.conf }); }
      else ys.push({ y: yc, x1: it.x1, conf: it.conf });
    }
    const diffs = ys.slice(1).map((v, i) => v.y - ys[i]!.y);
    const m0 = median(diffs) || mh * 2.5;
    const pitch = median(diffs.filter((d) => d < m0 * 1.6)) || m0;
    let block: { y: number; x1: number }[] = [];
    const flush = () => { if (block.length >= 2) secs.push({ colX: c.x, ys: block, pitch }); block = []; };
    for (const v of ys) {
      const last = block[block.length - 1];
      if (last && v.y - last.y > pitch * 3.5) flush();
      block.push(v);
    }
    flush();
  }
  if (!secs.length) return { rows: [], mh };

  const perSec = Math.max(1, Math.round(expected / secs.length));
  const rows: Row[] = [];
  for (const s of secs) {
    const top = s.ys[0]!.y, bottom = s.ys[s.ys.length - 1]!.y;
    // right edge: next section column to the right whose rows overlap vertically
    const right = Math.min(base.width - 2, ...secs.filter((o) => o.colX > s.colX + mh * 3 && o.ys[0]!.y < bottom + s.pitch && o.ys[o.ys.length - 1]!.y > top - s.pitch).map((o) => o.colX - mh * 0.6));
    // split between English and Korean cells: first non-anchor token to the right on the same line
    const starts: number[] = [];
    for (const r of s.ys) {
      const nxt = toks.filter((t) => Math.abs((t.y0 + t.y1) / 2 - r.y) < mh * 0.5 && t.x0 > r.x1 + mh * 0.4 && t.x0 < right).sort((a, b) => a.x0 - b.x0)[0];
      if (nxt) starts.push(nxt.x0);
    }
    const x1s = s.ys.map((r) => r.x1).sort((a, b) => a - b);
    const p80 = x1s[Math.floor(x1s.length * 0.8)] ?? x1s[x1s.length - 1]!;
    let split = starts.length ? median(starts) - mh * 0.35 : p80 + mh;
    split = clamp(split, p80 + mh * 0.2, right - mh * 2);
    const half = clamp(s.pitch * 0.5, mh * 0.8, mh * 1.6);

    // fill gaps (missed rows) using the regular row pitch
    const ys: { y: number; x1?: number }[] = [];
    s.ys.forEach((r, i) => {
      if (i > 0) {
        const prev = s.ys[i - 1]!;
        const k = Math.round((r.y - prev.y) / s.pitch);
        for (let j = 1; j < k; j++) ys.push({ y: prev.y + ((r.y - prev.y) * j) / k });
      }
      ys.push(r);
    });
    // extend up/down towards the expected rows per section while there is ink on that line
    const hasInk = (y: number) => y - half > 0 && y + half < base.height && inkRatio(base, { x0: s.colX, y0: y - half * 0.6, x1: right, y1: y + half * 0.6 }) > 0.01;
    let guard = 0;
    while (ys.length < perSec && guard++ < perSec) {
      const down = ys[ys.length - 1]!.y + s.pitch, up = ys[0]!.y - s.pitch;
      if (hasInk(down)) ys.push({ y: down });
      else if (hasInk(up)) ys.unshift({ y: up });
      else break;
    }
    for (const r of ys) {
      const row: Row = { yc: r.y, half, enX0: s.colX - mh * 0.4, split, right };
      if (r.x1 !== undefined) row.anchorX1 = r.x1;
      rows.push(row);
    }
  }
  return { rows, mh };
}

/* ---------------- row reading ---------------- */
type Read = { text: string; conf: number; score: number };
const EMPTY: Read = { text: "", conf: 0, score: -1 };

async function readCell(w: TW, base: HTMLCanvasElement, b: Box, scale: number, variant: "c" | "t", lang: Lang): Promise<Read> {
  const c0 = cropScaled(base, b, scale);
  const c = variant === "t" ? thresholdVariant(c0) : c0;
  try {
    const r = await w.recognize(c);
    const conf = r.data.confidence ?? 0;
    if (lang === "eng") {
      const text = cleanEnglish(r.data.text ?? "", conf);
      return { text, conf, score: EN_VALID.test(text) ? conf : conf * 0.2 };
    }
    const text = cleanMeaning(r.data.text ?? "");
    const hc = hangulCount(text);
    return { text, conf, score: hc ? conf + Math.min(10, hc) : -1 };
  } finally {
    if (c !== c0) free(c);
    free(c0);
  }
}

async function bestRead(lang: Lang, base: HTMLCanvasElement, b: Box, scale: number, good: number, prev: Read = EMPTY): Promise<Read> {
  const w = await getWorker(lang);
  await setMode(w, lang === "eng" ? "enLine" : "koLine");
  let best = prev;
  for (const v of ["c", "t"] as const) {
    const r = await readCell(w, base, b, scale, v, lang);
    if (r.score > best.score) best = r;
    if (best.score >= good) break;
  }
  return best;
}

type RowResult = { row: Row; en: Read; ko: Read; pos?: { text: string; conf: number } };

/** Dedicated read of the part-of-speech marker area at the start of the meaning cell. */
async function readPos(base: HTMLCanvasElement, ko: Box, mh: number, scale: number) {
  const w = await getWorker("kor");
  await setMode(w, "pos");
  const box = { x0: ko.x0, y0: ko.y0, x1: Math.min(ko.x1, ko.x0 + mh * 3.2), y1: ko.y1 };
  let best = { text: "", conf: 0 };
  for (const v of ["c", "t"] as const) {
    const c0 = cropScaled(base, box, scale + 0.5);
    const c = v === "t" ? thresholdVariant(c0) : c0;
    try {
      const r = await w.recognize(c);
      const t = (r.data.text ?? "").replace(/[^명동형부전접대감]/g, "").slice(0, 1);
      const conf = r.data.confidence ?? 0;
      if (t && conf > best.conf) best = { text: t, conf };
    } finally { if (c !== c0) free(c); free(c0); }
    if (best.conf >= 80) break;
  }
  return best;
}

/** Combine the meaning text with the separately read POS marker. */
function mergePos(ko: string, pos?: { text: string; conf: number }) {
  const senses = parseMeaning(ko);
  let auto = senses.some((s) => s.pos);
  if (pos?.text && pos.conf >= 70 && senses.length && !senses[0]!.pos) {
    // drop a misread single-glyph marker left at the start ("@ 교통", "명 교통" read as "멍")
    // Do not strip arbitrary first syllables: they may be part of the actual meaning.
    senses[0]!.ko = senses[0]!.ko.replace(/^[^가-힣\w]?\s*[.·:]\s*/, "");
    senses[0]!.pos = pos.text;
    auto = true;
  }
  return { senses, auto };
}
const isOk = (r: RowResult) => EN_VALID.test(r.en.text) && hangulCount(r.ko.text) > 0;
const isLow = (r: RowResult) => !isOk(r) || r.en.conf < 75 || r.ko.conf < 65;

function cellBoxes(row: Row, grow = 1) {
  const h = row.half * grow;
  const split = Math.max(row.split, (row.anchorX1 ?? 0) + 4);
  return {
    en: { x0: row.enX0, y0: row.yc - h, x1: split, y1: row.yc + h },
    ko: { x0: split, y0: row.yc - h, x1: row.right, y1: row.yc + h },
  };
}

export async function recognizeVocab(file: Blob, rotation: number, expected: number, onStage: (s: OcrStage) => void): Promise<OcrResult> {
  stageCb = onStage;
  phase = "load";
  let base: HTMLCanvasElement | null = null;
  try {
    onStage({ label: "사진 다듬는 중", progress: 0.01 });
    base = await preprocess(file, rotation);
    const eng = await getWorker("eng");
    getWorker("kor").catch(() => {}); // start Korean download while the layout pass runs

    // layout pass on a downscaled copy
    phase = "layout";
    onStage({ label: "구역과 줄 찾는 중", progress: 0.06 });
    const f = Math.min(1, 1600 / Math.max(base.width, base.height));
    const small = f < 1 ? scaled(base, f) : base;
    await setMode(eng, "sparse");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = (await eng.recognize(small, {}, { blocks: true })) as any;
    const raw: RawWord[] = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) for (const w of l.words ?? []) raw.push(w);
    if (small !== base) free(small);
    const { rows, mh } = detectRows(raw, 1 / f, base, expected);
    if (!rows.length) throw new Error("NO_LAYOUT");

    phase = "rows";
    onStage({ label: "한국어 엔진 준비 중", progress: 0.18 });
    await getWorker("kor");
    const scale = clamp(60 / mh, 2, 3);
    const results: RowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      onStage({ label: `줄 읽는 중 (${i + 1}/${rows.length})`, progress: 0.2 + 0.65 * (i / rows.length) });
      const row = rows[i]!;
      const bx = cellBoxes(row);
      const [en, ko] = await Promise.all([bestRead("eng", base, bx.en, scale, 88), bestRead("kor", base, bx.ko, scale, 85)]);
      results.push({ row, en, ko });
    }

    // second pass: empty / low-confidence rows, bigger and slightly taller crops
    let recognized = results.filter(isOk).length;
    if (recognized < expected) {
      const retry = results.filter(isLow);
      const s2 = Math.min(3.5, scale * 1.35);
      for (let i = 0; i < retry.length; i++) {
        onStage({ label: `어려운 줄 다시 읽는 중 (${i + 1}/${retry.length})`, progress: 0.85 + 0.13 * (i / retry.length) });
        const r = retry[i]!;
        const bx = cellBoxes(r.row, 1.2);
        const [en, ko] = await Promise.all([
          EN_VALID.test(r.en.text) && r.en.conf >= 75 ? r.en : bestRead("eng", base, bx.en, s2, 90, r.en),
          hangulCount(r.ko.text) && r.ko.conf >= 65 ? r.ko : bestRead("kor", base, bx.ko, s2, 88, r.ko),
        ]);
        r.en = en;
        r.ko = ko;
      }
      recognized = results.filter(isOk).length;
    }

    // A separate OCR pass is needed: ordinary Korean OCR often treats the printed
    // one-character POS abbreviation as part of the meaning or drops it entirely.
    // Only probe rows without a POS marker in the ordinary reading.
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (!hangulCount(r.ko.text) || parseMeaning(r.ko.text).some((s) => s.pos)) continue;
      const bx = cellBoxes(r.row);
      try { r.pos = await readPos(base, bx.ko, mh, scale); }
      catch { /* Keep the original meaning when the POS pass fails. */ }
      onStage({ label: `품사 확인 중 (${i + 1}/${results.length})`, progress: 0.95 + 0.02 * ((i + 1) / results.length) });
    }

    onStage({ label: "단어 정리 중", progress: 0.97 });
    const words: Word[] = [];
    const seen = new Set<string>();
    for (const r of results) {
      if (!r.en.text && !r.ko.text) continue;
      const key = r.en.text + "|" + r.ko.text;
      if (r.en.text && seen.has(key)) continue;
      seen.add(key);
      const b = cellBoxes(r.row);
      const merged = mergePos(r.ko.text, r.pos);
      words.push(withSenses({
        id: uid(), en: r.en.text, ko: joinSenses(merged.senses), senses: merged.senses,
        enConf: r.en.conf, koConf: r.ko.conf, posAuto: merged.auto,
        uncertain: isLow(r),
        crop: thumb(base, { x0: b.en.x0, y0: b.en.y0, x1: b.ko.x1, y1: b.ko.y1 }),
      }));
    }
    // Verify against the bundled local English↔Korean dictionary. Keep the
    // textbook's meanings, and attach suggestions instead of silently replacing
    // uncertain readings. Network/dictionary failure must never discard OCR rows.
    onStage({ label: "영한·한영 사전 교차검증 중", progress: 0.98 });
    const verified = await verifyAll(words.map((w) => ({
      en: w.en, senses: w.senses ?? [], enConf: w.enConf, koConf: w.koConf,
    })));
    const checked = words.map((w, i) => {
      const v = verified[i]!;
      return withSenses({ ...w, en: v.en, senses: v.senses, fixes: v.fixes,
        dict: v.dict, uncertain: !!w.uncertain || v.dict === "unknown" || v.fixes.some((f) => f.status === "suggest"),
      });
    });
    onStage({ label: "인식 완료", progress: 1 });
    return { words: checked, expected, recognized: checked.filter((w) => w.en && w.ko).length, low: checked.filter((w) => w.uncertain).length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg !== "NO_LAYOUT" && msg !== "IMAGE") await resetWorkers();
    throw e;
  } finally {
    if (base) free(base);
    stageCb = null;
    phase = "load";
  }
}
