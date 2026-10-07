// Part-of-speech (품사) markers printed before Korean meanings, e.g. "명. 교통 / 동. 수송하다".
export type Sense = { pos: string; ko: string };

export const POS_LIST = ["명", "동", "형", "부", "전", "접", "대", "감"] as const;
export const POS_LABEL: Record<string, string> = { 명: "명사", 동: "동사", 형: "형용사", 부: "부사", 전: "전치사", 접: "접속사", 대: "대명사", 감: "감탄사" };

// A POS marker is a standalone token: at the start or after a boundary (space , / ; ·),
// optionally bracketed, followed by "." or by a boundary/end. "동결", "대한" etc. are untouched.
const POS_RE = /(^|[\s,/;·])[[(]?(명|동|형|부|전|접|대|감)[\])]?(?:\s*\.|(?=[\s,/;·]|$))/g;

const tidy = (s: string) =>
  s.replace(/\s+/g, " ").replace(/^[\s,/;·.:-]+|[\s,/;·:-]+$/g, "").trim();

/** Split a raw meaning into senses, each linked to its POS markers (joined with "·"). */
export function parseMeaning(raw: string): Sense[] {
  const text = raw ?? "";
  const marks: { start: number; end: number; pos: string }[] = [];
  for (const m of text.matchAll(POS_RE)) {
    const start = m.index! + m[1]!.length;
    marks.push({ start, end: m.index! + m[0].length, pos: m[2]! });
  }
  if (!marks.length) return [{ pos: "", ko: tidy(text) }];
  const senses: Sense[] = [];
  const lead = tidy(text.slice(0, marks[0]!.start));
  if (lead) senses.push({ pos: "", ko: lead });
  let pending: string[] = [];
  marks.forEach((mk, i) => {
    pending.push(mk.pos);
    const seg = tidy(text.slice(mk.end, marks[i + 1]?.start ?? text.length));
    if (seg || i === marks.length - 1) {
      senses.push({ pos: [...new Set(pending)].join("·"), ko: seg });
      pending = [];
    }
  });
  return senses;
}

/** Meaning text shown in the quiz: senses joined, never containing POS markers. */
export const joinSenses = (s: Sense[]) => s.map((x) => x.ko.trim()).filter(Boolean).join(" / ");
