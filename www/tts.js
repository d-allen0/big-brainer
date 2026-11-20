// Text-to-speech wrapper.
// Prefers the native Android engine (Capacitor TextToSpeech plugin); falls back to the
// browser's Web Speech API. All functions take an optional `g` (global object) so tests
// can inject fake backends.

const ARABIC_CANDIDATES = ["ar-SA", "ar", "ar-001", "ar-EG"];
const MAX_TEXT_LENGTH = 500;
const DEFAULT_RATE = 0.8; // slightly slow, better for learners

export class TTSError extends Error {
  /** code: "bad-input" | "no-backend" | "no-arabic-voice" | "timeout" | "engine-error" */
  constructor(code, message) {
    super(message);
    this.name = "TTSError";
    this.code = code;
  }
}

/** Pick the best available speech backend. */
export function detectBackend(g = globalThis) {
  const plugin = g.Capacitor?.Plugins?.TextToSpeech;
  if (plugin && typeof plugin.speak === "function") return { kind: "native", plugin };
  const synth = g.speechSynthesis;
  if (synth && typeof g.SpeechSynthesisUtterance === "function") return { kind: "web", synth };
  return { kind: "none" };
}

// ---- Arabic voice lookup ----

async function findNativeArabic(plugin) {
  for (const lang of ARABIC_CANDIDATES) {
    try {
      const res = await plugin.isLanguageSupported({ lang });
      if (res?.supported) return lang;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Web voices load asynchronously; wait briefly for them. */
function loadWebVoices(synth, waitMs = 1500) {
  return new Promise((resolve) => {
    const existing = synth.getVoices();
    if (existing.length > 0) return resolve(existing);
    const done = () => {
      synth.removeEventListener?.("voiceschanged", done);
      clearTimeout(timer);
      resolve(synth.getVoices());
    };
    const timer = setTimeout(done, waitMs);
    synth.addEventListener?.("voiceschanged", done);
  });
}

async function findWebArabic(synth) {
  const voices = await loadWebVoices(synth);
  const arabic = voices.filter((v) => /^ar([-_]|$)/i.test(v.lang));
  if (arabic.length === 0) return null;
  const preferred = ARABIC_CANDIDATES.map((c) => c.toLowerCase());
  arabic.sort((a, b) => rank(a) - rank(b));
  return arabic[0];

  function rank(v) {
    const i = preferred.indexOf(v.lang.replace("_", "-").toLowerCase());
    return (i === -1 ? preferred.length : i) + (v.localService ? 0 : 0.5);
  }
}

/**
 * Report whether Arabic speech is available.
 * Resolves (never rejects) with { ok, backend, lang?, code?, message? }.
 */
export async function checkArabic(g = globalThis) {
  const backend = detectBackend(g);
  if (backend.kind === "none") {
    return { ok: false, backend: "none", code: "no-backend", message: "This device has no speech engine." };
  }
  try {
    if (backend.kind === "native") {
      const lang = await findNativeArabic(backend.plugin);
      return lang
        ? { ok: true, backend: "native", lang }
        : noArabic("native");
    }
    const voice = await findWebArabic(backend.synth);
    return voice ? { ok: true, backend: "web", lang: voice.lang } : noArabic("web");
  } catch (err) {
    return { ok: false, backend: backend.kind, code: "engine-error", message: String(err?.message ?? err) };
  }
}

function noArabic(backend) {
  return {
    ok: false,
    backend,
    code: "no-arabic-voice",
    message: "No Arabic voice is installed. Install Arabic in your phone's text-to-speech settings.",
  };
}

// ---- speaking ----

function validateText(text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new TTSError("bad-input", "Nothing to speak.");
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new TTSError("bad-input", `Text is too long (max ${MAX_TEXT_LENGTH} characters).`);
  }
  return text.trim();
}

function clampRate(rate) {
  return Number.isFinite(rate) ? Math.min(2, Math.max(0.3, rate)) : DEFAULT_RATE;
}

/**
 * Speak Arabic text. Cancels anything already playing.
 * Resolves when speech ends; rejects with TTSError.
 */
export async function speak(text, { rate = DEFAULT_RATE, g = globalThis } = {}) {
  const clean = validateText(text);
  const backend = detectBackend(g);
  if (backend.kind === "none") throw new TTSError("no-backend", "This device has no speech engine.");

  if (backend.kind === "native") {
    const lang = await findNativeArabic(backend.plugin);
    if (!lang) throw new TTSError("no-arabic-voice", noArabic("native").message);
    try {
      await backend.plugin.speak({ text: clean, lang, rate: clampRate(rate), queueStrategy: 0 });
    } catch (err) {
      throw new TTSError("engine-error", String(err?.message ?? err));
    }
    return;
  }

  const voice = await findWebArabic(backend.synth);
  if (!voice) throw new TTSError("no-arabic-voice", noArabic("web").message);
  return speakWeb(backend.synth, g, clean, voice, clampRate(rate));
}

function speakWeb(synth, g, text, voice, rate) {
  return new Promise((resolve, reject) => {
    synth.cancel();
    const utter = new g.SpeechSynthesisUtterance(text);
    utter.voice = voice;
    utter.lang = voice.lang;
    utter.rate = rate;

    // Some engines never fire "end"; don't leave the caller hanging.
    const timeoutMs = Math.max(5000, text.length * 600);
    const timer = setTimeout(() => {
      synth.cancel();
      reject(new TTSError("timeout", "Speech took too long."));
    }, timeoutMs);

    utter.onend = () => {
      clearTimeout(timer);
      resolve();
    };
    utter.onerror = (e) => {
      clearTimeout(timer);
      // Cancelling (by stop() or a newer speak()) is expected, not a failure.
      if (e?.error === "canceled" || e?.error === "interrupted") resolve();
      else reject(new TTSError("engine-error", `Speech failed: ${e?.error ?? "unknown"}`));
    };
    synth.speak(utter);
  });
}

/** Stop any speech in progress. Never throws. */
export async function stop(g = globalThis) {
  const backend = detectBackend(g);
  try {
    if (backend.kind === "native") await backend.plugin.stop();
    else if (backend.kind === "web") backend.synth.cancel();
  } catch {
    // stopping is best-effort
  }
}

/**
 * Open the system screen for installing voice data (Android only).
 * Returns true if the screen was opened, false if unsupported.
 */
export async function openVoiceInstall(g = globalThis) {
  const backend = detectBackend(g);
  if (backend.kind !== "native" || typeof backend.plugin.openInstall !== "function") return false;
  try {
    await backend.plugin.openInstall();
    return true;
  } catch {
    return false;
  }
}
