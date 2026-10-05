import { useEffect, useMemo, useRef, useState } from "react";
import { normalize, runOcr, sampleWords, shuffle, store, uid, type Session, type Weak, type Word } from "@/lib/wordkok";

type Stat = { wrong: number; solved: boolean };
type View = "home" | "edit" | "quiz" | "result";

export function WordKok() {
  const [view, setView] = useState<View>("home");
  const [words, setWords] = useState<Word[]>([]);
  const [quizSet, setQuizSet] = useState<Word[]>([]);
  const [stats, setStats] = useState<Record<string, Stat>>({});
  const [ocr, setOcr] = useState<{ busy: boolean; p: number; err?: string | undefined }>({ busy: false, p: 0 });

  useEffect(() => setWords(store.words()), []);
  const save = (w: Word[]) => { setWords(w); store.setWords(w); };

  async function handleFile(f?: File) {
    if (!f) return;
    setOcr({ busy: true, p: 0 });
    try {
      const res = await runOcr(f, (p) => setOcr({ busy: true, p }));
      save(res);
      setOcr({ busy: false, p: 1, err: res.length ? undefined : "단어를 찾지 못했어요. 직접 입력해 주세요." });
    } catch {
      save([]);
      setOcr({ busy: false, p: 0, err: "글자 인식에 실패했어요. 직접 입력해 주세요." });
    }
    setView("edit");
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
        <Home busy={ocr.busy} progress={ocr.p} saved={words.length} onFile={handleFile}
          onSample={() => { save(sampleWords()); setOcr({ busy: false, p: 0 }); setView("edit"); }}
          onManual={() => { save([]); setOcr({ busy: false, p: 0 }); setView("edit"); }}
          onContinue={() => setView("edit")} />
      )}
      {view === "edit" && <Editor words={words} onChange={save} error={ocr.err} onBack={() => setView("home")} onStart={() => startQuiz(words)} />}
      {view === "quiz" && <Quiz key={quizSet.map((w) => w.id).join()} words={quizSet} onFinish={(s) => { setStats(s); setView("result"); }} />}
      {view === "result" && <Result words={quizSet} stats={stats} onRetryWrong={(w) => startQuiz(w)} onRetryAll={() => startQuiz(words)} onHome={() => setView("home")} />}
    </div>
  );
}

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

function Editor({ words, onChange, error, onBack, onStart }: { words: Word[]; onChange: (w: Word[]) => void; error?: string | undefined; onBack: () => void; onStart: () => void }) {
  const unsure = words.filter((w) => w.uncertain).length;
  const valid = words.filter((w) => w.en.trim() && w.ko.trim()).length;
  const upd = (id: string, patch: Partial<Word>) => onChange(words.map((w) => (w.id === id ? { ...w, ...patch, uncertain: false } : w)));
  return (
    <div>
      <Header title="단어 확인" left={<button className="btn-ghost h-11 px-3" onClick={onBack}>‹ 처음</button>} />
      {error && <div className="mb-3 rounded-2xl bg-warning/15 p-4 font-medium text-warning-foreground">{error}</div>}
      <div className="card mb-3 flex items-center justify-between p-4">
        <span className="text-lg">단어 <b className="text-primary">{words.length}</b>개</span>
        {unsure > 0 && <span className="rounded-full bg-warning/20 px-3 py-1 text-sm font-semibold text-warning-foreground">⚠️ 확인 필요 {unsure}</span>}
      </div>
      <ul className="space-y-2">
        {words.map((w, i) => (
          <li key={w.id} className={`card p-3 ${w.uncertain ? "ring-2 ring-warning" : ""}`}>
            <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
              <span>{i + 1}{w.uncertain && " · 확인해 주세요"}</span>
              <button className="h-9 rounded-lg px-3 text-destructive active:bg-muted" onClick={() => onChange(words.filter((x) => x.id !== w.id))}>삭제</button>
            </div>
            <input className="field mb-2" placeholder="영어 단어" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={w.en} onChange={(e) => upd(w.id, { en: e.target.value })} />
            <input className="field" placeholder="한국어 뜻" value={w.ko} onChange={(e) => upd(w.id, { ko: e.target.value })} />
          </li>
        ))}
      </ul>
      <button className="btn-soft mt-3 h-14 w-full" onClick={() => onChange([...words, { id: uid(), en: "", ko: "" }])}>+ 단어 추가</button>
      <div className="sticky bottom-0 -mx-4 mt-4 bg-background/90 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <button className="btn-primary h-16 w-full text-xl" disabled={!valid} onClick={onStart}>퀴즈 시작 ({valid}개)</button>
      </div>
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
    const nq = fb?.ok ? rest : [...rest, head];
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
      words.filter((w) => stats[w.id]?.wrong > 0).map((w) => ({ en: w.en, ko: w.ko, n: stats[w.id]!.wrong })));
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
