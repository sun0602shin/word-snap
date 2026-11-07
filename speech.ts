// English pronunciation using the browser's built-in speech synthesis.
// Call speak() directly from the submit/click handler for iOS Safari/PWA.
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
let listening = false;
let activeUtterance: SpeechSynthesisUtterance | null = null;

function pickVoice() {
  if (!ttsSupported()) return;
  const voices = window.speechSynthesis.getVoices();
  voice = voices.find(v => v.lang.toLowerCase() === "en-us" && v.localService)
    ?? voices.find(v => v.lang.toLowerCase() === "en-us")
    ?? voices.find(v => v.lang.toLowerCase().startsWith("en"))
    ?? null;
}

export function initVoices() {
  if (!ttsSupported()) return;
  pickVoice();
  if (!listening) {
    window.speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
    listening = true;
  }
}

export function cancelSpeech() {
  if (ttsSupported()) {
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }
  activeUtterance = null;
}

/** True means the utterance was queued; asynchronous errors are sent to onError. */
export function speak(text: string, onError?: () => void): boolean {
  if (!ttsSupported() || !text.trim()) return false;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    pickVoice(); // Voice list can load after initial mount, especially on iOS.
    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.lang = voice?.lang ?? "en-US";
    if (voice) utterance.voice = voice;
    utterance.rate = 0.85;
    utterance.pitch = 1;
    activeUtterance = utterance; // Prevent premature garbage collection in Safari.
    utterance.onend = () => {
      if (activeUtterance === utterance) activeUtterance = null;
    };
    utterance.onerror = (event) => {
      if (activeUtterance === utterance) activeUtterance = null;
      if (event.error !== "canceled" && event.error !== "interrupted") onError?.();
    };
    synth.speak(utterance);
    if (synth.paused) synth.resume();
    return true;
  } catch {
    activeUtterance = null;
    return false;
  }
}
