// Read screen: a list of short dialogues, and each dialogue as chat bubbles. UI only.
// Logic lives in dialogues.js.
//
// PACING RULES (CLAUDE.md section 1):
//  - Every dialogue is open from the start. "Up next" only suggests where to begin.
//  - Nothing is spoken until the learner presses a speaker button (or Hear whole dialogue).
//  - Reading never needs the voice: without an Arabic voice a clear note appears and the
//    Arabic, transliteration and meanings are all still there.

import * as dialogues from "./dialogues.js";
import * as db from "./db.js";
import * as tts from "./tts.js";

export const OPENED_KEY = "read.opened";

/**
 * Build the screen. `h` is the app's DOM helper. Storage and speech are injectable for tests.
 * Routes: #/read (the list), #/read/dialogue/<id>. An unknown id falls back to the list.
 */
export function createReadScreen({ h, loadDialogues = dialogues.loadDialogues, store = db, speech = tts }) {
  const link = (href, text, cls = "") => h("a", { href, class: cls }, text);
  const button = (text, onClick, cls = "btn") => h("button", { type: "button", class: cls, onclick: onClick }, text);

  async function readOpened() {
    try {
      const saved = await store.getMeta(OPENED_KEY, []);
      return Array.isArray(saved) ? saved : [];
    } catch {
      return []; // a storage problem never stops the learner from reading
    }
  }

  function voiceNote(result) {
    if (result.ok) return null;
    const kids = [h("p", { class: "text" }, result.message ?? "Arabic speech is not available on this device.")];
    if (result.code === "no-arabic-voice") {
      kids.push(button("Open voice settings", () => speech.openVoiceInstall(), "btn secondary"));
    }
    return h("div", { class: "note", role: "status" }, ...kids);
  }

  // ---- the list ----

  async function listView(setTitle) {
    setTitle("Read");
    const list = await loadDialogues();
    const opened = await readOpened();
    const next = dialogues.suggestedDialogue(list, opened);
    return h("div", { class: "read" },
      h("div", { class: "card" },
        h("h2", {}, "Dialogues"),
        h("p", { class: "text" }, "Short conversations to read and listen to. Every one is open: start anywhere.")),
      h("div", { class: "dialogue-list" },
        list.map((d) =>
          h("a", { href: `#/read/dialogue/${d.id}`, class: "dialogue-row" },
            h("span", { class: "dialogue-title" }, d.title),
            h("span", { class: "dialogue-meta" }, `${d.lines.length} lines`),
            d.id === next.id ? h("span", { class: "tag" }, "Up next") : null))));
  }

  // ---- one dialogue ----

  async function dialogueView(id, setTitle) {
    const list = await loadDialogues();
    const dialogue = dialogues.findDialogue(list, id);
    if (!dialogue) return listView(setTitle);
    setTitle(dialogue.title);

    const voice = await speech.checkArabic().catch(() => ({ ok: false }));
    const hasVoice = voice.ok === true;
    // Remember that it was opened (only to move the "Up next" marker). Failing to save changes nothing.
    readOpened().then((opened) => store.setMeta(OPENED_KEY, dialogues.markOpened(list, opened, dialogue.id))).catch(() => {});

    const msg = h("p", { class: "speak-msg small", role: "status" });
    const setMsg = (t) => { msg.textContent = t; };
    let playing = false;
    let token = 0;
    const rows = [];

    function showPlaying(index) {
      rows.forEach((row, i) => row.classList.toggle("playing", i === index));
    }

    async function speakOne(text) {
      try {
        setMsg("");
        await speech.speak(text);
      } catch (err) {
        setMsg(err?.message ?? "Could not play the sound.");
      }
    }

    function stopAll() {
      token++;
      playing = false;
      showPlaying(-1);
      hearAll.textContent = "Hear whole dialogue";
      Promise.resolve(speech.stop?.()).catch(() => {});
    }

    async function playAll() {
      if (playing) return stopAll();
      playing = true;
      const mine = ++token;
      hearAll.textContent = "Stop";
      setMsg("");
      try {
        const texts = dialogues.hearAllTexts(dialogue);
        for (let i = 0; i < texts.length && token === mine; i++) {
          showPlaying(i);
          await speech.speak(texts[i]);
        }
      } catch (err) {
        if (token === mine) setMsg(err?.message ?? "Could not play the sound.");
      } finally {
        if (token === mine) {
          playing = false;
          showPlaying(-1);
          hearAll.textContent = "Hear whole dialogue";
        }
      }
    }

    const hearAll = button("Hear whole dialogue", playAll, "btn");
    if (!hasVoice) hearAll.disabled = true;

    const bubbles = dialogue.lines.map((line, i) => {
      const detail = h("div", { class: "bubble-detail" },
        h("div", { class: "bubble-tr", dir: "ltr" }, line.tr),
        h("div", { class: "bubble-en" }, line.en));
      detail.hidden = true;
      const bubble = h("button", { type: "button", class: "bubble", "aria-expanded": "false" },
        h("span", { class: "bubble-who" }, dialogues.speakerName(dialogue, line)),
        h("span", { class: "ar bubble-ar", lang: "ar" }, line.ar),
        detail);
      bubble.addEventListener("click", () => {
        const show = detail.hidden;
        detail.hidden = !show;
        bubble.setAttribute("aria-expanded", String(show));
      });
      const speak = h("button", {
        type: "button", class: "speak-btn", "aria-label": `Hear line ${i + 1}`, title: "Hear this line",
        onclick: () => { if (playing) stopAll(); speakOne(line.ar); },
      }, "\u{1F50A}");
      const row = h("div", { class: `bubble-row who-${line.who}` }, bubble, speak);
      rows.push(row);
      return row;
    });

    // Leaving the screen (Back, a tab, another route) stops any speech.
    const onLeave = () => {
      stopAll();
      window.removeEventListener("hashchange", onLeave);
    };
    window.addEventListener("hashchange", onLeave);

    return h("div", { class: "practice dialogue" },
      h("div", { class: "practice-head" }, link("#/read", "← Back to Read")),
      voiceNote(voice),
      h("p", { class: "text small" }, "Tap a line to see what it means."),
      h("div", { class: "bubbles" }, bubbles),
      msg,
      h("div", { class: "actions-bar" }, hearAll));
  }

  return async function readScreen({ parts = ["read"], setTitle = () => {} } = {}) {
    if (parts[1] === "dialogue" && parts[2]) return dialogueView(parts[2], setTitle);
    return listView(setTitle);
  };
}
