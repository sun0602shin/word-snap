// Browser-only OCR pipeline tuned for "English word | Korean meaning" vocabulary tables.
// Uses tesseract.js (eng+kor) with word-level bounding boxes, then pairs words by row/column geometry.
import { uid, type Word } from "./wordkok";

export type OcrStage = { label: string; progress: number };
type TWorker = import("tesseract.js").Worker;

let workerPromise: Promise<TWorker> | null = null;
let stageCb: ((s: OcrStage) => void) | null = null;

const STAGE_KO: Record<string, string> = {
  "loading tesseract core": "인식 엔진 불러오는 중",
  "initializing tesseract": "인식 엔진 준비 중",
  "initialized tesseract": "인식 엔진 준비 완료",
  "loading language traineddata": "영어·한국어 데이터 내려받는 중",
  "loaded language traineddata": "언어 데이터 준비 완료",
  "initializing api": "인식 준비 중",
  "initialized api": "인식 준비 완료",
  "recognizing text": "글자 읽는 중",
};

/** Single reusable worker; recreated after a failure. */
export function getWorker(): Promise<TWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const T = await import("tesseract.js");
      const w = await T.createWorker(["eng", "kor"], T.OEM.LSTM_ONLY, {
        logger: (m: { status: string; progress: number }) =>
          stageCb?.({ label: STAGE_KO[m.status] ?? "처리 중", progress: m.progress ?? 0 }),
      });
      await w.setParameters({
        tessedit_pageseg_mode: (globalThis as { __psm?: string }).__psm as never ?? T.PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      return w;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

export async function resetWorker() {
  const p = workerPromise;
  workerPromise = null;
  if (p) (await p.catch(() => null))?.terminate();
}

/** Load with EXIF orientation honored (img element does this on iOS Safari). */
function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => rej(new Error("이미지를 열 수 없어요"));
    img.src = url;
  });
}

/** Resize to OCR-friendly resolution, rotate, grayscale, percentile contrast stretch. */
export async function preprocess(file: Blob, rotation = 0): Promise<HTMLCanvasElement> {
  const img = await loadImage(file);
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  // Target long side ~2800px; iOS canvas limit ~16.7M px.
  let scale = 2800 / Math.max(w0, h0);
  if (w0 * h0 * scale * scale > 14_000_000) scale = Math.sqrt(14_000_000 / (w0 * h0));
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const rot = ((rotation % 360) + 360) % 360;
  const c = document.createElement("canvas");
  c.width = rot % 180 ? h : w;
  c.height = rot % 180 ? w : h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
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
  const gray = new Uint8ClampedArray(px.length / 4);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = (px[i]! * 0.299 + px[i + 1]! * 0.587 + px[i + 2]! * 0.114) | 0;
    gray[j] = g;
    hist[g]!++;
  }
  const n = gray.length;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]!; if (acc > n * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]!; if (acc > n * 0.08) { hi = v; break; } }
  const range = Math.max(30, hi - lo);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    let v = ((gray[j]! - lo) / range) * 255;
    v = v > 235 ? 255 : v; // flatten paper shading
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/* ---------- table pairing ---------- */
type Tok = { t: string; conf: number; x0: number; x1: number; y0: number; y1: number; kind: "en" | "ko" | "punct" | "noise" };
const HANGUL = /[가-힣]/;
const EN_RE = /^[A-Za-z][A-Za-z'-]*$/;

function classify(raw: string, conf: number): Tok["kind"] {
  if (HANGUL.test(raw)) return "ko";
  const s = raw.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
  if (s && EN_RE.test(s) && s.length >= 2 && conf >= 25) return "en";
  if (/^[/,()~·.:;\-[\]]+$/.test(raw)) return "punct";
  return "noise";
}

export function pairTokens(words: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[], pageH: number): Word[] {
  const toks: Tok[] = words
    .map((w) => ({ t: w.text.trim(), conf: w.confidence, ...w.bbox, kind: classify(w.text.trim(), w.confidence) }))
    .filter((t) => t.t && t.kind !== "noise" && !/^day$/i.test(t.t.replace(/[^A-Za-z]/g, "")) && !/^qr$/i.test(t.t));
  if (!toks.length) return [];
  const heights = toks.map((t) => t.y1 - t.y0).sort((a, b) => a - b);
  const mh = heights[Math.floor(heights.length / 2)] || 20;

  // group into rows by vertical center
  toks.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const rows: Tok[][] = [];
  let cy = -1e9;
  for (const t of toks) {
    const yc = (t.y0 + t.y1) / 2;
    const last = rows[rows.length - 1];
    if (last && Math.abs(yc - cy) < mh * 0.6) { last.push(t); cy = (cy * (last.length - 1) + yc) / last.length; }
    else { rows.push([t]); cy = yc; }
  }

  type Pair = { en: Tok[]; ko: Tok[]; y: number };
  const pageW = Math.max(...toks.map((t) => t.x1));
  const pairs: Pair[] = [];
  let prevRowPairs: Pair[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x0 - b.x0);
    const rowPairs: Pair[] = [];
    let cur: Pair | null = null;
    const orphanKo: Tok[] = [];
    for (let i = 0; i < row.length; i++) {
      const t = row[i]!;
      if (t.kind === "en") {
        const prev = row[i - 1];
        const continuesEn = cur && cur.ko.length === 0 && prev?.kind === "en" && t.x0 - prev.x1 < mh * 1.2 && cur.en.length < 4;
        const insideKo = cur && cur.ko.length > 0 && prev && t.x0 - prev.x1 < mh * 0.8 && row[i + 1]?.kind === "ko" && t.x0 - prev.x1 < mh * 0.4;
        if (continuesEn) cur!.en.push(t);
        else if (insideKo) cur!.ko.push(t);
        else { cur = { en: [t], ko: [], y: t.y0 }; rowPairs.push(cur); }
      } else if (cur) cur.ko.push(t);
      else if (t.kind === "ko") orphanKo.push(t);
    }
    // Korean-only text: wrapped continuation of a meaning in the previous row (same column)
    const leftovers = rowPairs.length ? [] : orphanKo;
    if (leftovers.length && prevRowPairs.length) {
      const x = leftovers[0]!.x0;
      const target = prevRowPairs.find((p) => p.ko.length && Math.abs((p.ko[0]?.x0 ?? 0) - x) < mh * 6);
      if (target) target.ko.push(...leftovers);
    }
    if (rowPairs.length) { pairs.push(...rowPairs); prevRowPairs = rowPairs; }
  }

  const out: (Word & { x: number; y: number })[] = [];
  for (const p of pairs) {
    const en = p.en.map((t) => t.t.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "")).join(" ").toLowerCase();
    const koToks = p.ko.filter((t) => !(t.kind === "punct" && /^[.:;]$/.test(t.t)));
    while (koToks.length && koToks[koToks.length - 1]!.kind === "punct" && !/[)]/.test(koToks[koToks.length - 1]!.t)) koToks.pop();
    // Korean OCR often splits syllables: join tightly spaced tokens without a space
    let latinNoise = false;
    let ko = "";
    let prev: Tok | null = null;
    for (const t of koToks) {
      if (t.kind === "en") { latinNoise = true; continue; }
      if (prev) ko += t.x0 - prev.x1 < mh * 0.32 ? "" : " ";
      ko += t.t;
      prev = t;
    }
    ko = ko.replace(/\s+([,)])/g, "$1").replace(/\(\s+/g, "(").replace(/\s*\/\s*/g, " / ").replace(/,(?=\S)/g, ", ").replace(/\s+/g, " ").trim();
    const hasKo = HANGUL.test(ko);
    // Header/title without meaning near the top → noise
    if (!hasKo && p.y < pageH * 0.12) continue;
    if (!hasKo && en.length < 3) continue;
    const enConf = Math.min(...p.en.map((t) => t.conf));
    const koConf = koToks.length ? koToks.reduce((s, t) => s + t.conf, 0) / koToks.length : 0;
    out.push({ id: uid(), en, ko, uncertain: !hasKo || latinNoise || enConf < 70 || koConf < 60, x: p.en[0]!.x0, y: p.y } as Word & { x: number; y: number });
  }
  // order by column (section) then row: cluster English start x positions
  const xs = [...new Set(out.map((w) => w.x))].sort((a, b) => a - b);
  const starts: number[] = [];
  for (const x of xs) if (!starts.length || x - starts[starts.length - 1]! > pageW * 0.15) starts.push(x);
  const col = (x: number) => starts.filter((s0) => x >= s0 - pageW * 0.05).length;
  out.sort((a, b) => col(a.x) - col(b.x) || a.y - b.y);
  // de-duplicate identical English words (e.g. repeated reads)
  const seen = new Set<string>();
  return out
    .filter((w) => (seen.has(w.en + "|" + w.ko) ? false : (seen.add(w.en + "|" + w.ko), true)))
    .map(({ id, en, ko, uncertain }) => ({ id, en, ko, uncertain }));
}

export async function recognizeVocab(file: Blob, rotation: number, onStage: (s: OcrStage) => void): Promise<Word[]> {
  stageCb = onStage;
  try {
    onStage({ label: "사진 다듬는 중", progress: 0 });
    const canvas = await preprocess(file, rotation);
    onStage({ label: "인식 엔진 준비 중", progress: 0 });
    const worker = await getWorker();
    onStage({ label: "글자 읽는 중", progress: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = (await worker.recognize(canvas, { rotateAuto: true }, { blocks: true })) as any;
    const words: Parameters<typeof pairTokens>[0] = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) for (const w of l.words ?? []) words.push(w);
    onStage({ label: "단어 정리 중", progress: 1 });
    return pairTokens(words, canvas.height);
  } catch (e) {
    await resetWorker();
    throw e;
  } finally {
    stageCb = null;
  }
}
