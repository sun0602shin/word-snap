// English pronunciation via the browser's free SpeechSynthesis.
// speak() must be called synchronously inside a user gesture (iOS Safari/PWA).
const KEY = "wk_tts_auto";

export function ttsSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}
export function getAutoSpeak() {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}
export function setAutoSpeak(on: boolean) {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* ignore */ }
}

let voice: SpeechSynthesisVoice | null = null;
function pickVoice() {
  const vs = window.speechSynthesis.getVoices();
  voice = vs.find((v) => v.lang === "en-US" && v.localService) ?? vs.find((v) => v.lang === "en-US") ?? vs.find((v) => v.lang.startsWith("en")) ?? null;
}
/** Call once from useEffect: voices load lazily (esp. Chrome/iOS). */
export function initVoices() {
  if (!ttsSupported()) return;
  pickVoice();
  window.speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

export function cancelSpeech() {
  if (ttsSupported()) { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }
}

/** Returns false if speech is unavailable or failed to start. onError reports async failures. */
export function speak(text: string, onError?: () => void): boolean {
  if (!ttsSupported() || !text.trim()) return false;
  try {
    const s = window.speechSynthesis;
    s.cancel();
    if (!voice) pickVoice();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice?.lang ?? "en-US";
    if (voice) u.voice = voice;
    u.rate = 0.85;
    u.onerror = (e) => { if (e.error !== "canceled" && e.error !== "interrupted") onError?.(); };
    s.speak(u);
    if (s.paused) s.resume();
    return true;
  } catch { return false; }
}
