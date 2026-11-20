// Voice options screen: choose the voice and speed used by every pronunciation button.
// UI only. Voice logic lives in tts.js; the choice is saved in the progress store's `meta`.
//
// PACING AND RESPECT (CLAUDE.md section 1):
//  - Nothing is spoken until the learner presses a speaker button. Choosing a voice or a speed
//    never plays anything by itself.
//  - Nothing here is gated, timed or required. With no voice installed the screen says so plainly.

import * as tts from "./tts.js";
import * as db from "./db.js";

export const PREFS_KEY = "speech.prefs";
const SAMPLE = "مَرْحَبًا"; // "hello"

const LANG_NAMES = {
  ar: "Arabic",
  "ar-xa": "Arabic",
  "ar-001": "Arabic (Modern Standard)",
  "ar-sa": "Arabic (Saudi Arabia)",
  "ar-eg": "Arabic (Egypt)",
  "ar-ae": "Arabic (United Arab Emirates)",
};
const SPEED_LABELS = { slow: "Slow", normal: "Normal", fast: "Fast" };

/** A readable language name for a voice, e.g. "Arabic (Saudi Arabia)". */
export function languageName(lang) {
  const key = String(lang ?? "").replace("_", "-").toLowerCase();
  return LANG_NAMES[key] ?? `Arabic (${lang})`;
}

/**
 * Build the screen. `h` is the app's DOM helper. `speech` and `store` are injectable for tests.
 * Returns render({ setTitle }) -> Promise<Node>.
 */
export function createOptionsScreen({ h, speech = tts, store = db }) {
  const button = (text, onClick, cls = "btn", extra = {}) => h("button", { type: "button", class: cls, onclick: onClick, ...extra }, text);

  return async function render({ setTitle = () => {} } = {}) {
    setTitle("Voice options");

    // Saved choices (a corrupted or missing value just means the defaults).
    let saved = null;
    try {
      saved = await store.getMeta(PREFS_KEY, null);
    } catch {
      // not being able to read the saved choice is harmless
    }
    let prefs = speech.setPreferences(saved);

    const listing = await speech.listVoices();
    const voices = listing.voices ?? [];
    const voiceCheck = voices.length === 0 ? await speech.checkArabic().catch(() => ({ ok: false })) : { ok: true };

    const speakMsg = h("p", { class: "speak-msg small", role: "status" });
    const saveMsg = h("p", { class: "speak-msg small", role: "status" });
    const body = h("div", {});

    /** Say a short sample. Only ever called from a button press. */
    async function sample(options) {
      try {
        speakMsg.textContent = "";
        await speech.speak(SAMPLE, options);
      } catch (err) {
        speakMsg.textContent = err?.message ?? "Could not play the sound.";
      }
    }

    async function save(next) {
      prefs = speech.setPreferences(next);
      saveMsg.textContent = "";
      try {
        await store.setMeta(PREFS_KEY, prefs);
      } catch (err) {
        saveMsg.textContent = "Could not save your choice: " + (err?.message ?? err) + ". It still applies until you close the app.";
      }
      draw();
    }

    const speakBtn = (label, onClick) =>
      h("button", { type: "button", class: "speak-btn", "aria-label": label, title: label, onclick: onClick }, "\u{1F50A}");

    function voiceRow({ title, detail, small, selected, onChoose, hearLabel, onHear }) {
      return h("div", { class: "voice-row" },
        h("button", {
          type: "button",
          class: "voice-choice" + (selected ? " selected" : ""),
          "aria-pressed": selected ? "true" : "false",
          onclick: onChoose,
        },
          h("span", { class: "voice-title" }, title),
          h("span", { class: "small voice-detail" }, detail),
          small ? h("span", { class: "small muted voice-name", dir: "ltr" }, small) : null),
        speakBtn(hearLabel, onHear));
    }

    function draw() {
      const known = voices.some((v) => v.id === prefs.voiceId);
      const missing = prefs.voiceId !== null && !known;
      const rows = [
        voiceRow({
          title: "Automatic (default)",
          detail: "Uses your phone's best Arabic voice",
          selected: prefs.voiceId === null || missing,
          onChoose: () => save({ ...prefs, voiceId: null }),
          hearLabel: "Hear the automatic voice",
          onHear: () => sample({ voiceId: null }),
        }),
        ...voices.map((v, i) =>
          voiceRow({
            title: `Voice ${i + 1}`,
            detail: `${languageName(v.lang)} · ${v.local ? "works offline" : "needs internet"}`,
            small: v.name,
            selected: v.id === prefs.voiceId,
            onChoose: () => save({ ...prefs, voiceId: v.id }),
            hearLabel: `Hear Voice ${i + 1}`,
            onHear: () => sample({ voiceId: v.id }),
          })),
      ];

      const notes = [];
      if (voices.length === 0) {
        const kids = [h("p", { class: "text" }, voiceCheck.message ?? "No Arabic voice was found on this device.")];
        if (voiceCheck.code === "no-arabic-voice") kids.push(button("Open voice settings", () => speech.openVoiceInstall(), "btn secondary"));
        notes.push(h("div", { class: "note", role: "status" }, ...kids));
      }
      if (missing) {
        notes.push(h("div", { class: "note", role: "status" },
          h("p", { class: "text" }, "Your chosen voice is not installed on this phone right now, so the automatic voice is used.")));
      }

      body.replaceChildren(
        ...notes,
        h("section", { class: "card" },
          h("h2", {}, "Voice"),
          h("p", { class: "small" }, "Used for every pronunciation button. Nothing plays until you press a speaker button."),
          h("div", { class: "voice-list" }, rows)),
        h("section", { class: "card" },
          h("h2", {}, "Speed"),
          h("div", { class: "segmented three", role: "group", "aria-label": "Speaking speed" },
            Object.keys(tts.SPEEDS).map((key) =>
              h("button", {
                type: "button",
                class: key === prefs.speed ? "active" : "",
                "aria-pressed": key === prefs.speed ? "true" : "false",
                onclick: () => save({ ...prefs, speed: key }),
              }, SPEED_LABELS[key]))),
          h("div", { class: "row spaced" },
            speakBtn("Hear a sample at this speed", () => sample({})),
            h("span", { class: "small" }, "Hear a sample"))),
        speakMsg,
        saveMsg);
    }

    draw();
    return h("div", {},
      h("div", { class: "practice-head" }, h("a", { href: "#/" }, "← Back to Home")),
      body);
  };
}
