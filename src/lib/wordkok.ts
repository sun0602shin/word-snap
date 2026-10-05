export type Word = { id: string; en: string; ko: string; uncertain?: boolean };

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

/* ---------- OCR line parsing ---------- */
const HANGUL = /[가-힣]/;
export function parseLine(raw: string, conf = 100): Word | null {
  let line = raw.replace(/[|_[\]{}<>©®]/g, " ").replace(/\s+/g, " ").trim();
  if (!line) return null;
  if (/\bDAY\b/i.test(line) && !HANGUL.test(line.replace(/day/i, ""))) return null;
  if (/QR/i.test(line)) return null;
  line = line.replace(/^[\s\d.,)\-:•·□☐✓✔vV]{0,6}(?=[A-Za-z])/, "");
  const m = line.match(/^([A-Za-z][A-Za-z'\- ]*[A-Za-z])\s*(.*)$/);
  if (!m) return null;
  const en = m[1]!.trim().toLowerCase();
  if (/^day$/i.test(en) || en.length < 2) return null;
  let ko = (m[2] ?? "").replace(/^[\s\d.,:\-]+/, "").replace(/\s*\d+\s*$/, "").trim();
  ko = ko.replace(/\s*,\s*/g, ", ").replace(/\s*\/\s*/g, " / ");
  const uncertain = conf < 75 || !HANGUL.test(ko) || /[^A-Za-z'\- ]/.test(en) || en.split(" ").length > 3;
  return { id: uid(), en, ko, uncertain };
}

/* ---------- local storage ---------- */
export type Session = { date: string; total: number; first: number; after: number; wrong: number };
export type Weak = Record<string, { ko: string; wrong: number }>;
const get = <T,>(k: string, d: T): T => {
  try { return JSON.parse(localStorage.getItem(k) || "") as T; } catch { return d; }
};
export const store = {
  words: () => get<Word[]>("wk_words", []),
  setWords: (w: Word[]) => localStorage.setItem("wk_words", JSON.stringify(w)),
  history: () => get<Session[]>("wk_history", []),
  weak: () => get<Weak>("wk_weak", {}),
  record(s: Session, wrongs: { en: string; ko: string; n: number }[]) {
    localStorage.setItem("wk_history", JSON.stringify([s, ...this.history()].slice(0, 50)));
    const weak = this.weak();
    for (const w of wrongs) weak[w.en] = { ko: w.ko, wrong: (weak[w.en]?.wrong ?? 0) + w.n };
    localStorage.setItem("wk_weak", JSON.stringify(weak));
  },
};
