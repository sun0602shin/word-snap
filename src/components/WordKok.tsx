import { useEffect, useMemo, useRef, useState } from "react";
import { POS_LIST, POS_LABEL, joinSenses, parseMeaning, type Sense } from "@/lib/pos";
import { withSenses, normalize, sampleWords, shuffle, store, uid, type Session, type Weak, type Word } from "@/lib/wordkok";
import { recognizeVocab, warmUp, type OcrResult, type OcrStage } from "@/lib/ocr";
import { applyFix } from "@/lib/dict";

type Stat = { wrong: number; solved: boolean };
type View = "home" | "photo" | "edit" | "quiz" | "result";

export function WordKok() {
  const [view, setView] = useState<View>("home");
  const [words, setWords] = useState<Word[]>([]);
  const [quizSet, setQuizSet] = useState<Word[]>([]);
  const [stats, setStats] = useState<Record<string, Stat>>({});
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | undefined>();
  const [summary, setSummary] = useState<{ expected: number; recognized: number; low: number } | null>(null);

  useEffect(() => setWords(store.words()), []);
  const save = (w: Word[]) => { setWords(w); store.setWords(w); };

  function handleFile(f?: File) {
    if (!f) return;
    setFile(f);
    setView("photo");
    warmUp(); // download engine data while the user checks the photo
  }

  function startQuiz(list: Word[]) {
    const valid = list.filter((w) => w.en.trim() && w.ko.trim());
    if (!valid.length) return;
    setQuizSet(valid);
    setView("quiz");
  }

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
      {view === "home" && (
        <Home busy={false} progress={0} saved={words.length} onFile={handleFile}
          onSample={() => { save(sampleWords().map(withSenses)); setErr(undefined); setSummary(null); setView("edit"); }}
          onManual={() => { save([]); setErr(undefined); setSummary(null); setView("edit"); }}
          onContinue={() => { setErr(undefined); setSummary(null); setView("edit"); }} />
      )}
      {view === "photo" && file && (
        <PhotoStep file={file} onCancel={() => setView("home")}
          onManual={() => { save([]); setErr(undefined); setSummary(null); setView("edit"); }}
          onDone={(r) => { save(r.words); setSummary(r); setErr(r.words.length ? undefined : "단어를 찾지 못했어요. 직접 입력해 주세요."); setView("edit"); }} />
      )}
      {view === "edit" && <Editor words={words} onChange={save} error={err} summary={summary} onBack={() => setView("home")} onStart={() => startQuiz(words)} />}
      {view === "quiz" && <Quiz key={quizSet.map((w) => w.id).join()} words={quizSet} onFinish={(s) => { setStats(s); setView("result"); }} />}
      {view === "result" && <Result words={quizSet} stats={stats} onRetryWrong={(w) => startQuiz(w)} onRetryAll={() => startQuiz(words)} onHome={() => setView("home")} />}
    </div>
  );
}

function PhotoStep({ file, onCancel, onManual, onDone }: { file: File; onCancel: () => void; onManual: () => void; onDone: (r: OcrResult) => void }) {
  const [rot, setRot] = useState(0);
  const [url, setUrl] = useState("");
  const [expected, setExpected] = useState(40);
  const [stage, setStage] = useState<OcrStage | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [sec, setSec] = useState(0);
  useEffect(() => { const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u); }, [file]);
  useEffect(() => {
    if (!stage) return;
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [!!stage]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setSec(0);
    setFail(null);
    setStage({ label: "준비 중", progress: 0 });
    try {
      onDone(await recognizeVocab(file, rot, clamp(expected || 40, 1, 200), setStage));
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setStage(null);
      setFail(
        m === "NO_LAYOUT" ? "단어 표를 찾지 못했어요. 사진을 바로 세우거나, 단어장이 화면에 꽉 차게 다시 찍어 주세요."
        : m === "IMAGE" ? "이 사진을 열 수 없어요. 다른 사진을 골라 주세요."
        : "인식 엔진이나 언어 데이터를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.",
      );
    }
  }

  if (stage)
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center text-center">
        <div className="spinner mb-6" />
        <p className="text-xl font-bold">{stage.label}</p>
        <div className="mt-4 h-3 w-full max-w-xs overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(4, Math.round(stage.progress * 100))}%` }} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{Math.round(stage.progress * 100)}% · {sec}초</p>
        <p className="mt-6 max-w-xs text-sm text-muted-foreground">줄마다 영어와 한국어를 따로 꼼꼼히 읽어서 1~2분 정도 걸릴 수 있어요. 처음 한 번은 언어 데이터도 내려받아요. 화면을 켜 둔 채 기다려 주세요.</p>
      </div>
    );

  return (
    <div>
      <Header title="사진 확인" left={<button className="btn-ghost h-11 px-3" onClick={onCancel}>‹ 처음</button>} />
      {fail && (
        <div className="mb-3 rounded-2xl bg-warning/15 p-4 font-medium text-warning-foreground">
          {fail}
          <button className="btn-soft mt-3 h-12 w-full" onClick={onManual}>직접 입력하기</button>
        </div>
      )}
      <p className="mb-3 text-muted-foreground">글자가 바로 서 있도록 돌려 주세요. 단어장이 화면에 꽉 차고 흔들리지 않을수록 잘 읽어요.</p>
      <div className="card flex aspect-square items-center justify-center overflow-hidden p-2">
        {url && <img src={url} alt="선택한 단어장 사진" className="max-h-full max-w-full object-contain transition-transform" style={{ transform: `rotate(${rot}deg)` }} />}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button className="btn-soft h-14" onClick={() => setRot((r) => r - 90)}>↺ 왼쪽으로</button>
        <button className="btn-soft h-14" onClick={() => setRot((r) => r + 90)}>↻ 오른쪽으로</button>
      </div>
      <label className="card mt-3 flex items-center justify-between gap-3 p-4">
        <span className="font-semibold">이 페이지의 단어 수</span>
        <input type="number" inputMode="numeric" min={1} max={200} className="field h-12 w-24 text-center text-lg font-bold" value={expected || ""} onChange={(e) => setExpected(parseInt(e.target.value, 10) || 0)} />
      </label>
      <button className="btn-primary mt-4 h-16 w-full text-xl" onClick={start}>{fail ? "다시 인식하기" : "글자 인식 시작"}</button>
    </div>
  );
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function Header({ title, left }: { title: string; left?: React.ReactNode }) {
  return (
    <div className="mb-4 flex min-h-12 items-center gap-2">
      {left}
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
    </div>
  );
}

function Home(p: { busy: boolean; progress: number; saved: number; onFile: (f?: File) => void; onSample: () => void; onManual: () => void; onContinue: () => void }) {
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  const [weak, setWeak] = useState<Weak>({});
  const [hist, setHist] = useState<Session[]>([]);
  useEffect(() => { setWeak(store.weak()); setHist(store.history()); }, []);
  const weakList = Object.entries(weak).sort((a, b) => b[1].wrong - a[1].wrong).slice(0, 8);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 pt-4">
        <img src="/icon-192.png" alt="" width={56} height={56} className="rounded-2xl shadow-card" />
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">단어콕</h1>
          <p className="text-muted-foreground">단어장을 찍고 바로 퀴즈!</p>
        </div>
      </div>

      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => p.onFile(e.target.files?.[0])} />
      <input ref={lib} type="file" accept="image/*" hidden onChange={(e) => p.onFile(e.target.files?.[0])} />

      {p.busy ? (
        <div className="card p-6 text-center">
          <p className="text-lg font-semibold">글자를 읽고 있어요…</p>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(p.progress * 100)}%` }} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">처음엔 준비하느라 조금 오래 걸릴 수 있어요</p>
        </div>
      ) : (
        <div className="grid gap-3">
          <button className="btn-primary h-20 text-xl" onClick={() => cam.current?.click()}>📷 단어장 사진 찍기</button>
          <button className="btn-soft h-16 text-lg" onClick={() => lib.current?.click()}>🖼️ 사진 보관함에서 고르기</button>
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-soft h-14" onClick={p.onManual}>✏️ 직접 입력</button>
            <button className="btn-soft h-14" onClick={p.onSample}>📘 DAY 20 샘플</button>
          </div>
          {p.saved > 0 && <button className="btn-ghost h-12" onClick={p.onContinue}>저장된 단어 {p.saved}개 이어서 하기 →</button>}
        </div>
      )}

      {weakList.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 font-bold">자주 틀리는 단어</h2>
          <ul className="divide-y divide-border">
            {weakList.map(([en, v]) => (
              <li key={en} className="flex justify-between gap-3 py-2">
                <span><b>{en}</b> <span className="text-sm text-muted-foreground">{v.ko}</span></span>
                <span className="shrink-0 font-semibold text-destructive">{v.wrong}회</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {hist.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 font-bold">최근 학습</h2>
          <ul className="space-y-1 text-sm">
            {hist.slice(0, 5).map((h, i) => (
              <li key={i} className="flex justify-between">
                <span className="text-muted-foreground">{new Date(h.date).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                <span>{h.total}개 · 첫 정답 {Math.round((h.first / h.total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Editor({ words, onChange, error, summary, onBack, onStart }: { words: Word[]; onChange: (w: Word[]) => void; error?: string | undefined; summary: { expected: number; recognized: number; low: number } | null; onBack: () => void; onStart: () => void }) {
  const unsure = words.filter((w) => w.uncertain).length;
  const valid = words.filter((w) => w.en.trim() && w.ko.trim()).length;
  const upd = (id: string, patch: Partial<Word>) => onChange(words.map((w) => (w.id === id ? { ...w, ...patch, uncertain: false } : w)));
  const resolveFix = (id: string, fixId: string, accept: boolean) => onChange(words.map((w) => {
    if (w.id !== id) return w;
    const f = w.fixes?.find((x) => x.id === fixId);
    if (!f) return w;
    const fixes = w.fixes?.map((x) => x.id === fixId ? { ...x, status: accept ? "accepted" as const : "ignored" as const } : x);
    if (!accept) return { ...w, fixes };
    const result = applyFix({ en: w.en, senses: w.senses ?? parseMeaning(w.ko) }, f);
    return { ...w, en: result.en, senses: result.senses, ko: joinSenses(result.senses), fixes };
  }));
  return (
    <div>
      <Header title="단어 확인" left={<button className="btn-ghost h-11 px-3" onClick={onBack}>‹ 처음</button>} />
      {error && <div className="mb-3 rounded-2xl bg-warning/15 p-4 font-medium text-warning-foreground">{error}</div>}
      <div className="card mb-3 flex items-center justify-between p-4">
        {summary ? (
          <span className="text-lg">인식 <b className="text-primary">{valid}</b>/{summary.expected} <span className="text-xs text-muted-foreground">OCR v3</span></span>
        ) : (
          <span className="text-lg">단어 <b className="text-primary">{words.length}</b>개</span>
        )}
        {unsure > 0 && <span className="rounded-full bg-warning/20 px-3 py-1 text-sm font-semibold text-warning-foreground">⚠️ 낮은 신뢰도 {unsure}</span>}
      </div>
      <ul className="space-y-2">
        {words.map((w, i) => (
          <li key={w.id} className={`card p-3 ${w.uncertain ? "ring-2 ring-warning" : ""}`}>
            <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
              <span>{i + 1}{w.uncertain && " · 확인해 주세요"}</span>
              <button className="h-9 rounded-lg px-3 text-destructive active:bg-muted" onClick={() => onChange(words.filter((x) => x.id !== w.id))}>삭제</button>
            </div>
            {w.crop && <img src={w.crop} alt={`${i + 1}번 줄 원본`} className="mb-2 w-full rounded-lg border border-border bg-card" />}
            <input className="field mb-2" placeholder="영어 단어" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={w.en} onChange={(e) => upd(w.id, { en: e.target.value })} />
            <SensesEditor senses={w.senses?.length ? w.senses : [{ pos: "", ko: w.ko }]} onChange={(senses) => upd(w.id, { senses, ko: joinSenses(senses) })} />
            {w.fixes?.filter((f) => f.status === "suggest").map((f) => (
              <div key={f.id} className="mt-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="font-semibold">사전 확인: {f.from || "(빈칸)"} → {f.to}</p>
                <p className="mt-1 text-muted-foreground">{f.reason}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="btn-soft min-h-10 flex-1" onClick={() => resolveFix(w.id, f.id, true)}>수정 적용</button>
                  <button type="button" className="btn-ghost min-h-10 flex-1" onClick={() => resolveFix(w.id, f.id, false)}>원문 유지</button>
                </div>
              </div>
            ))}
          </li>
        ))}
      </ul>
      <button className="btn-soft mt-3 h-14 w-full" onClick={() => onChange([...words, { id: uid(), en: "", ko: "", senses: [{ pos: "", ko: "" }] }])}>+ 단어 추가</button>
      <div className="sticky bottom-0 -mx-4 mt-4 bg-background/90 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <button className="btn-primary h-16 w-full text-xl" disabled={!valid} onClick={onStart}>퀴즈 시작 ({valid}개)</button>
      </div>
    </div>
  );
}

function SensesEditor({ senses, onChange }: { senses: Sense[]; onChange: (s: Sense[]) => void }) {
  const set = (i: number, patch: Partial<Sense>) => onChange(senses.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  // typed "명. 교통 / 동. 수송하다" → split POS out when leaving the field
  const split = (i: number) => {
    const parsed = parseMeaning(senses[i]!.ko);
    if (parsed.length === 1 && !parsed[0]!.pos) return;
    if (parsed[0] && !parsed[0].pos && senses[i]!.pos) parsed[0].pos = senses[i]!.pos;
    onChange([...senses.slice(0, i), ...parsed, ...senses.slice(i + 1)]);
  };
  return (
    <div className="space-y-2">
      {senses.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <label className="pos-chip" data-empty={!s.pos || undefined}>
            <span aria-hidden>{s.pos || "품사"}</span>
            <select aria-label="품사" className="absolute inset-0 opacity-0" value={s.pos} onChange={(e) => set(i, { pos: e.target.value })}>
              <option value="">없음</option>
              {POS_LIST.map((p) => <option key={p} value={p}>{p} ({POS_LABEL[p]})</option>)}
              {s.pos && !(POS_LIST as readonly string[]).includes(s.pos) && <option value={s.pos}>{s.pos}</option>}
            </select>
          </label>
          <input className="field flex-1" placeholder="한국어 뜻" value={s.ko} onChange={(e) => set(i, { ko: e.target.value })} onBlur={() => split(i)} />
          {senses.length > 1 && <button className="h-11 w-9 shrink-0 rounded-lg text-muted-foreground active:bg-muted" aria-label="뜻 삭제" onClick={() => onChange(senses.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
      <button className="h-9 rounded-lg px-2 text-sm font-semibold text-secondary-foreground active:bg-muted" onClick={() => onChange([...senses, { pos: "", ko: "" }])}>+ 품사·뜻 추가</button>
    </div>
  );
}

function Quiz({ words, onFinish }: { words: Word[]; onFinish: (s: Record<string, Stat>) => void }) {
  const byId = useMemo(() => Object.fromEntries(words.map((w) => [w.id, w])), [words]);
  const [queue, setQueue] = useState(() => shuffle(words.map((w) => w.id)));
  const [stats, setStats] = useState<Record<string, Stat>>(() => Object.fromEntries(words.map((w) => [w.id, { wrong: 0, solved: false }])));
  const [answer, setAnswer] = useState("");
  const [fb, setFb] = useState<null | { ok: boolean }>(null);
  const input = useRef<HTMLInputElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const cur = byId[queue[0]!]!;
  const solved = Object.values(stats).filter((s) => s.solved).length;

  useEffect(() => { (fb ? nextBtn : input).current?.focus(); }, [fb, queue]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (fb) return next();
    if (!answer.trim()) return;
    const ok = normalize(answer) === normalize(cur.en);
    setStats((s) => ({ ...s, [cur.id]: ok ? { wrong: s[cur.id]!.wrong, solved: true } : { solved: false, wrong: s[cur.id]!.wrong + 1 } }));
    setFb({ ok });
  }
  function next() {
    const [head, ...rest] = queue;
    const nq = fb?.ok ? rest : [...rest, head!];
    setFb(null); setAnswer("");
    if (!nq.length) return onFinish(stats);
    setQueue(nq);
  }

  return (
    <form onSubmit={submit}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex-1">
          <div className="mb-1 text-sm font-semibold text-muted-foreground">{solved} / {words.length} 완료</div>
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(solved / words.length) * 100}%` }} />
          </div>
        </div>
        <button type="button" className="btn-ghost h-11 px-4" onClick={() => onFinish(stats)}>마치기</button>
      </div>

      <div className="card flex min-h-56 flex-col items-center justify-center p-6 text-center">
        {stats[cur.id]!.wrong > 0 && <span className="mb-2 rounded-full bg-warning/20 px-3 py-1 text-sm font-semibold text-warning-foreground">다시 도전!</span>}
        <p className="text-3xl font-bold leading-snug sm:text-4xl">{cur.ko}</p>
      </div>

      <input ref={input} className={`field mt-4 h-16 text-center text-2xl ${fb ? (fb.ok ? "ring-2 ring-success" : "ring-2 ring-destructive") : ""}`}
        placeholder="영어로 써 보세요" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
        value={answer} readOnly={!!fb} onChange={(e) => setAnswer(e.target.value)} />

      {fb && (
        <div className={`mt-3 rounded-2xl p-4 text-center ${fb.ok ? "bg-success/15" : "bg-destructive/10"}`}>
          <p className={`text-xl font-bold ${fb.ok ? "text-success" : "text-destructive"}`}>{fb.ok ? "정답! 🎉" : "아쉬워요"}</p>
          <p className="mt-1 text-lg">정답: <b className="tracking-wide">{cur.en}</b></p>
          {!fb.ok && <p className="text-sm text-muted-foreground">이 단어는 뒤에서 다시 나와요</p>}
        </div>
      )}
      {fb ? (
        <button ref={nextBtn} type="submit" className="btn-primary mt-4 h-16 w-full text-xl">다음 →</button>
      ) : (
        <button type="submit" className="btn-primary mt-4 h-16 w-full text-xl" disabled={!answer.trim()}>제출</button>
      )}
    </form>
  );
}

function Result({ words, stats, onRetryWrong, onRetryAll, onHome }: { words: Word[]; stats: Record<string, Stat>; onRetryWrong: (w: Word[]) => void; onRetryAll: () => void; onHome: () => void }) {
  const total = words.length;
  const first = words.filter((w) => stats[w.id]?.solved && !stats[w.id]!.wrong).length;
  const after = words.filter((w) => stats[w.id]?.solved && stats[w.id]!.wrong > 0).length;
  const still = total - first - after;
  const wrongWords = words.filter((w) => !stats[w.id]?.solved || stats[w.id]!.wrong > 0);
  const rate = total ? Math.round((first / total) * 100) : 0;
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    store.record({ date: new Date().toISOString(), total, first, after, wrong: still },
      words.filter((w) => (stats[w.id]?.wrong ?? 0) > 0).map((w) => ({ en: w.en, ko: w.ko, n: stats[w.id]!.wrong })));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const box = (label: string, v: number, cls = "") => (
    <div className="card p-4 text-center"><div className={`text-3xl font-extrabold ${cls}`}>{v}</div><div className="text-sm text-muted-foreground">{label}</div></div>
  );
  return (
    <div>
      <Header title="결과" />
      <div className="card mb-3 bg-primary p-6 text-center text-primary-foreground">
        <div className="text-sm opacity-90">정답률 (첫 시도)</div>
        <div className="text-6xl font-extrabold">{rate}%</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {box("전체 단어", total)}
        {box("첫 시도 정답", first, "text-success")}
        {box("틀린 후 정답", after, "text-warning-foreground")}
        {box("아직 틀림", still, "text-destructive")}
      </div>
      {wrongWords.length > 0 && (
        <section className="card mt-4 p-4">
          <h2 className="mb-2 font-bold">단어별 오답</h2>
          <ul className="divide-y divide-border">
            {wrongWords.sort((a, b) => (stats[b.id]?.wrong ?? 0) - (stats[a.id]?.wrong ?? 0)).map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 py-2">
                <span><b>{w.en}</b> <span className="text-sm text-muted-foreground">{w.ko}</span></span>
                <span className="shrink-0 text-sm font-semibold">{stats[w.id]?.solved ? <span className="text-destructive">{stats[w.id]!.wrong}회</span> : <span className="text-muted-foreground">미완료 · {stats[w.id]?.wrong ?? 0}회</span>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="mt-4 grid gap-3">
        {wrongWords.length > 0 && <button className="btn-primary h-16 text-xl" onClick={() => onRetryWrong(wrongWords)}>오답만 다시 풀기 ({wrongWords.length})</button>}
        <button className="btn-soft h-14" onClick={onRetryAll}>전체 다시 풀기</button>
        <button className="btn-ghost h-12" onClick={onHome}>처음으로</button>
      </div>
    </div>
  );
}
