import { joinSenses, parseMeaning, type Sense } from "./pos";
import type { Fix } from "./dict";

export type Word = {
  id: string; en: string; ko: string; senses?: Sense[]; uncertain?: boolean; crop?: string;
  enConf?: number; koConf?: number; posAuto?: boolean; fixes?: Fix[]; dict?: "ok" | "fixed" | "unknown";
};

/** Ensure senses exist and ko is the POS-free meaning text. */
export function withSenses(w: Word): Word {
  const senses = w.senses?.length ? w.senses : parseMeaning(w.ko);
  return { ...w, senses, ko: joinSenses(senses) };
}

export const uid = () => Math.random().toString(36).slice(2, 10);

const RAW: [string, string][] = [
  ["traffic", "교통, 통행, 수송량"],
  ["major", "주요한, 중대한 / 전공"],
  ["route", "경로, 길, 방법"],
  ["vehicle", "자동차, 탈것, 매개체"],
  ["transport", "수송하다, 이동시키다 / 수송, 이동"],
  ["utilize", "이용하다, 활용하다"],
  ["remote", "외진, 멀리 떨어진"],
  ["leak", "(물이) 새다, 유출하다 / 새는 곳, 누출"],
  ["guess", "~일 것 같다, 추측하다"],
  ["temperature", "온도, 기온"],
  ["passage", "통과, 통행, 통로"],
  ["flat", "평평한, 바람이 빠진, 납작한"],
  ["enormous", "거대한, 엄청난, 막대한"],
  ["accurate", "정확한, 정밀한"],
  ["freeze", "얼어붙다, 얼다 / 동결, 한파"],
  ["gear", "장비, 복장, 기구"],
  ["license", "면허증, 면허, 승낙 / 허가하다"],
  ["construction", "공사, 건설, 건축물"],
  ["wireless", "무선 시스템 / 무선의"],
  ["nevertheless", "그럼에도 불구하고, 그렇기는 하지만"],
  ["barrier", "장벽, 장애물"],
  ["lift", "들어 올리다, 기분이 좋아지다 / 승강기"],
  ["curved", "꺾인, 곡선인, 굽은"],
  ["eliminate", "없애다, 제거하다"],
  ["commit", "(범죄를) 저지르다, (활동 등에) 전념하다"],
  ["commute", "통근하다 / 통근(거리), 통학"],
  ["drag", "끌다, 끌고 가다"],
  ["fasten", "매다, 채우다, 잠그다"],
  ["precise", "정확한, 정밀한"],
  ["vital", "필수적인, 중요한, 생명에 관한"],
  ["component", "부품, 구성 요소"],
  ["seldom", "거의 ~이 아닌, 드물게"],
  ["enhance", "향상시키다, 높이다"],
  ["sink", "가라앉다, 침몰시키다 / 싱크대, 개수대"],
  ["destination", "목적지, 행선지"],
  ["station", "역, 정거장, 위치 / 배치하다"],
  ["passenger", "승객"],
  ["fuel", "연료 / 연료를 공급하다"],
  ["distance", "거리, 먼 곳"],
  ["accident", "사고, 우연"],
];
export const sampleWords = (): Word[] => RAW.map(([en, ko]) => ({ id: uid(), en, ko }));

export function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j]!, b[i]!];
  }
  return b;
}

export const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[’']/g, "'");

/* ---------- local storage ---------- */
export type Session = { date: string; total: number; first: number; after: number; wrong: number; bookId?: string; title?: string; wrongEn?: string[] };
export type Weak = Record<string, { ko: string; wrong: number }>;
export type Book = { id: string; title: string; words: Word[]; createdAt: string; updatedAt: string };
const get = <T,>(k: string, d: T): T => {
  try { return (JSON.parse(localStorage.getItem(k) || "null") as T) ?? d; } catch { return d; }
};
const strip = (w: Word[]) => w.map(({ crop: _c, ...rest }) => rest);
export const store = {
  words: () => get<Word[]>("wk_words", []).map(withSenses),
  setWords: (w: Word[]) => {
    try { localStorage.setItem("wk_words", JSON.stringify(strip(w))); } catch { /* quota */ }
  },
  books: () => get<Book[]>("wk_books", []).map((b) => ({ ...b, words: b.words.map(withSenses) })),
  setBooks: (b: Book[]) => localStorage.setItem("wk_books", JSON.stringify(b.map((x) => ({ ...x, words: strip(x.words) })))),
  saveBook(b: Book) {
    const all = this.books();
    const i = all.findIndex((x) => x.id === b.id);
    const nb = { ...b, updatedAt: new Date().toISOString() };
    if (i >= 0) all[i] = nb; else all.unshift(nb);
    this.setBooks(all);
    return nb;
  },
  deleteBook(id: string) { this.setBooks(this.books().filter((b) => b.id !== id)); },
  history: () => get<Session[]>("wk_history", []),
  weak: () => get<Weak>("wk_weak", {}),
  record(s: Session, wrongs: { en: string; ko: string; n: number }[]) {
    localStorage.setItem("wk_history", JSON.stringify([s, ...this.history()].slice(0, 200)));
    const weak = this.weak();
    for (const w of wrongs) weak[w.en] = { ko: w.ko, wrong: (weak[w.en]?.wrong ?? 0) + w.n };
    localStorage.setItem("wk_weak", JSON.stringify(weak));
  },
};

/* ---------- JSON export / import ---------- */
export const BOOK_FORMAT = "wordkok-book", BACKUP_FORMAT = "wordkok-backup", FILE_VERSION = 1;
const cleanWord = (w: Word) => ({ en: w.en, ko: w.ko, senses: w.senses ?? [] });
export function bookFile(b: Book) {
  return { format: BOOK_FORMAT, version: FILE_VERSION, exportedAt: new Date().toISOString(), book: { id: b.id, title: b.title, createdAt: b.createdAt, updatedAt: b.updatedAt, words: b.words.map(cleanWord) } };
}
export function backupFile() {
  return { format: BACKUP_FORMAT, version: FILE_VERSION, exportedAt: new Date().toISOString(), books: store.books().map((b) => bookFile(b).book), history: store.history(), weak: store.weak() };
}
type RawBook = { id?: string; title?: string; createdAt?: string; updatedAt?: string; words?: Partial<Word>[] };
export function toBook(r: RawBook): Book {
  const now = new Date().toISOString();
  const words = (r.words ?? []).filter((w) => w && (w.en || w.ko || w.senses?.length)).map((w) => withSenses({ id: uid(), en: String(w.en ?? ""), ko: String(w.ko ?? ""), ...(Array.isArray(w.senses) ? { senses: w.senses.map((s) => ({ pos: String(s.pos ?? ""), ko: String(s.ko ?? "") })) } : {}) }));
  return { id: r.id || uid(), title: (r.title || "가져온 단어장").slice(0, 60), words, createdAt: r.createdAt || now, updatedAt: r.updatedAt || now };
}
export type Parsed = { kind: "book"; book: Book } | { kind: "backup"; books: Book[]; history: Session[]; weak: Weak };
export function parseFile(text: string): Parsed {
  const j = JSON.parse(text);
  if (j?.format === BOOK_FORMAT && j.book) return { kind: "book", book: toBook(j.book) };
  if (j?.format === BACKUP_FORMAT && Array.isArray(j.books)) return { kind: "backup", books: j.books.map(toBook), history: Array.isArray(j.history) ? j.history : [], weak: j.weak && typeof j.weak === "object" ? j.weak : {} };
  throw new Error("FORMAT");
}

/** iOS share sheet (AirDrop, 파일, 메시지) when supported, otherwise a download. */
export async function shareJson(name: string, data: unknown): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: name }); return "shared"; }
    catch (e) { if ((e as Error).name === "AbortError") return "cancelled"; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return "downloaded";
}
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "단어장";
