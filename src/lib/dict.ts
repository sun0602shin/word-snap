// Local English↔Korean dictionary (public/dict, built by scripts/build-dict.py from
// open-english-korean-dict CC-BY-SA 4.0 + kengdic MPL 2.0). Data is sharded so only the
// few shards needed for a lookup are fetched: en-<length>.json and ko-<len>-<initial>.json.
import type { Sense } from "./pos";

export type Fix = {
  id: string;
  field: "en" | "ko";
  sense?: number; // index into senses for ko fixes
  from: string;
  to: string;
  alts?: string[];
  reason: string;
  status: "auto" | "suggest" | "accepted" | "ignored";
};

type Shard = Record<string, string[]>;
const cache = new Map<string, Promise<Shard>>();
const MAX_SHARDS = 24;

function shard(name: string): Promise<Shard> {
  let p = cache.get(name);
  if (p) { cache.delete(name); cache.set(name, p); return p; } // LRU touch
  p = fetch(`/dict/${name}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  cache.set(name, p);
  while (cache.size > MAX_SHARDS) cache.delete(cache.keys().next().value!);
  return p;
}

const enShard = (w: string) => `en-${Math.min(w.length, 20)}`;
function koShard(k: string) {
  const c = k.charCodeAt(0) - 0xac00;
  return `ko-${Math.min(k.length, 6)}-${c >= 0 && c < 11172 ? Math.floor(c / 588) : "x"}`;
}

export async function lookupEn(w: string): Promise<string[] | null> {
  if (!w) return null;
  return (await shard(enShard(w)))[w] ?? null;
}
export async function lookupKo(k: string): Promise<string[] | null> {
  if (!k) return null;
  return (await shard(koShard(k)))[k] ?? null;
}
/** Probe that the dictionary is actually reachable (used in UI + tests). */
export async function dictReady() {
  return !!(await lookupEn("precise"))?.length;
}

/* ---------------- distances ---------------- */
export function lev(a: string | string[], b: string | string[], max = 9): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > max) return max + 1;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[n]!;
}
// OCR-confusable letter pairs cost less (l/i/1, rn/m, c/e, …)
const CONF = new Set(["li", "il", "ce", "ec", "oa", "ao", "nu", "un", "ft", "tf", "hb", "bh", "vy", "yv", "nr", "rn"]);
function ocrDist(a: string, b: string) {
  const d = lev(a, b, 3);
  if (d !== 1 || a.length !== b.length) return d;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return CONF.has(a[i]! + b[i]!) ? 0.6 : 1;
  return d;
}
function jamo(s: string): string[] {
  const out: string[] = [];
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c >= 11172) { out.push(ch); continue; }
    out.push("i" + Math.floor(c / 588), "m" + (Math.floor(c / 28) % 21));
    if (c % 28) out.push("f" + (c % 28));
  }
  return out;
}

async function enCandidates(w: string) {
  const names = new Set<string>();
  for (let L = Math.max(2, w.length - 1); L <= w.length + 1; L++) names.add(enShard("x".repeat(L)));
  const out: { w: string; d: number; ko: string[] }[] = [];
  for (const s of await Promise.all([...names].map(shard)))
    for (const k in s) {
      if (Math.abs(k.length - w.length) > 1 || k[0] !== w[0] && k[k.length - 1] !== w[w.length - 1]) continue;
      const d = ocrDist(w, k);
      if (d <= 2) out.push({ w: k, d, ko: s[k]! });
    }
  return out;
}
async function koCandidates(k: string) {
  const s = await shard(koShard(k));
  const jk = jamo(k);
  const out: { k: string; en: string[] }[] = [];
  for (const key in s) if (key.length === k.length && key !== k && lev(jamo(key), jk, 1) <= 1) out.push({ k: key, en: s[key]! });
  return out;
}

/* ---------------- meaning helpers ---------------- */
const items = (ko: string) =>
  ko.split(/[,/;·]/).map((t) => t.replace(/\([^)]*\)/g, "").replace(/[~\s]/g, "").trim()).filter((t) => /^[가-힣]{2,8}$/.test(t));
const sim = (a: string, b: string) => a === b ? 1 : a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a)) ? 0.7 : a.slice(0, 2) === b.slice(0, 2) ? 0.4 : 0;
function meaningSim(ocrItems: string[], dictKo: string[]) {
  let best = 0;
  for (const a of ocrItems) for (const b of dictKo) best = Math.max(best, sim(a, b.replace(/\s/g, "")));
  return best;
}

export type VerifyInput = { en: string; senses: Sense[]; enConf?: number; koConf?: number };
export type VerifyOut = { en: string; senses: Sense[]; fixes: Fix[]; dict: "ok" | "fixed" | "unknown" };
const fid = () => Math.random().toString(36).slice(2, 9);

/** Cross-check one row against the dictionary in both directions. Never rewrites whole meanings. */
export async function verifyRow(row: VerifyInput): Promise<VerifyOut> {
  let en = row.en.trim().toLowerCase();
  const senses = row.senses.map((s) => ({ ...s }));
  const fixes: Fix[] = [];
  const enConf = row.enConf ?? 100, koConf = row.koConf ?? 100;
  const all = senses.flatMap((s) => items(s.ko));
  // Korean → English: which headwords does the printed meaning point to?
  const rev = new Map<string, number>();
  for (const list of await Promise.all(all.map(lookupKo))) for (const w of list ?? []) rev.set(w, (rev.get(w) ?? 0) + 1);

  let enKo = en ? await lookupEn(en) : null;
  if (en && !enKo && /^[a-z][a-z'-]+$/.test(en)) {
    const cands = await enCandidates(en);
    const scored = cands
      .map((c) => {
        const ms = Math.max(meaningSim(all, c.ko), rev.has(c.w) ? 1 : 0);
        return { ...c, ms, score: (1 - c.d / 3) * 0.55 + ms * 0.45 };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0], second = scored[1];
    if (best) {
      const sure = best.d <= 1 && (best.ms >= 0.7 || enConf < 70) && (!second || best.score - second.score > 0.15);
      fixes.push({
        id: fid(), field: "en", from: en, to: best.w, alts: scored.slice(1, 3).map((s) => s.w),
        reason: best.ms >= 0.7 ? "철자가 비슷하고 뜻이 사전과 맞아요" : "철자가 비슷한 사전 단어예요",
        status: sure ? "auto" : "suggest",
      });
      if (sure) { en = best.w; enKo = best.ko; }
    }
  } else if (!en && rev.size) {
    const top = [...rev.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
    fixes.push({ id: fid(), field: "en", from: "", to: top[0]!, alts: top.slice(1), reason: "뜻으로 사전에서 찾은 단어예요", status: "suggest" });
  }

  // English → Korean: fix single broken Korean words (jamo-level), never whole meanings.
  for (let si = 0; si < senses.length; si++) {
    for (const it of items(senses[si]!.ko)) {
      if (await lookupKo(it)) continue;
      const cands = await koCandidates(it);
      if (!cands.length) continue;
      const linked = cands.filter((c) => c.en.includes(en) || (enKo ?? []).some((k) => k.replace(/\s/g, "") === c.k));
      const pick = linked[0] ?? (cands.length === 1 ? cands[0] : undefined);
      if (!pick) continue;
      const sure = linked.length === 1 && koConf < 92;
      fixes.push({ id: fid(), field: "ko", sense: si, from: it, to: pick.k, alts: cands.filter((c) => c !== pick).slice(0, 2).map((c) => c.k), reason: linked.length ? `'${en}' 사전 뜻과 맞아요` : "사전에 있는 비슷한 낱말이에요", status: sure ? "auto" : "suggest" });
      if (sure) senses[si] = { ...senses[si]!, ko: senses[si]!.ko.replace(it, pick.k) };
    }
  }
  const known = !!enKo || rev.has(en);
  return { en, senses, fixes, dict: fixes.some((f) => f.status === "auto") ? "fixed" : known ? "ok" : "unknown" };
}

export async function verifyAll<T extends VerifyInput>(rows: T[], onProgress?: (i: number) => void): Promise<VerifyOut[]> {
  const out: VerifyOut[] = [];
  for (let i = 0; i < rows.length; i++) {
    onProgress?.(i);
    try { out.push(await verifyRow(rows[i]!)); }
    catch { out.push({ en: rows[i]!.en, senses: rows[i]!.senses, fixes: [], dict: "unknown" }); }
  }
  return out;
}

/** Apply (or undo) a fix on a word's en/senses. */
export function applyFix(w: { en: string; senses: Sense[] }, f: Fix, to = f.to, undo = false) {
  if (f.field === "en") return { en: undo ? f.from : to, senses: w.senses };
  const senses = w.senses.map((s, i) => (i === f.sense ? { ...s, ko: undo ? s.ko.replace(f.to, f.from) : s.ko.replace(f.from, to) } : s));
  return { en: w.en, senses };
}
