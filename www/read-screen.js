// Read screen: a Dialogues | Texts switch. Dialogues are a list and then chat bubbles; Texts are a list
// grouped by level and then a short reading with one question. UI only.
// Logic lives in dialogues.js and texts.js.
//
// PACING RULES (CLAUDE.md section 1):
//  - Every dialogue and every text is open from the start. "Up next" only suggests where to begin, and a
//    level is only a label.
//  - The comprehension question is never graded or scored and does not touch scheduling. A wrong answer
//    shows the right one with a short note and costs nothing.
//  - Nothing is spoken until the learner presses a speaker button (or Hear whole dialogue).
//  - Reading never needs the voice: without an Arabic voice a clear note appears and the
//    Arabic, transliteration and meanings are all still there.

import * as dialogues from "./dialogues.js";
import * as textsMod from "./texts.js";
import * as db from "./db.js";
import * as tts from "./tts.js";

export const OPENED_KEY = "read.opened";
export const TEXTS_OPENED_KEY = "read.textsOpened";

/**
 * Build the screen. `h` is the app's DOM helper. Storage and speech are injectable for tests.
 * Routes: #/read (the dialogues), #/read/dialogue/<id>, #/read/texts (the texts), #/read/text/<id>.
 * An unknown id falls back to that list.
 */
export function createReadScreen({ h, loadDialogues = dialogues.loadDialogues, loadTexts = textsMod.loadTexts, store = db, speech = tts, rng = Math.random }) {
  const link = (href, text, cls = "") => h("a", { href, class: cls }, text);
  const button = (text, onClick, cls = "btn") => h("button", { type: "button", class: cls, onclick: onClick }, text);

  async function readOpened(key = OPENED_KEY) {
    try {
      const saved = await store.getMeta(key, []);
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

  /** Dialogues | Texts switch at the top of both lists. The current one is marked; both are links. */
  function readToggle(current) {
    const items = [["dialogues", "Dialogues", "#/read"], ["texts", "Texts", "#/read/texts"]];
    return h("nav", { class: "segmented", "aria-label": "Choose what to read" },
      items.map(([key, label, href]) =>
        h("a", { href, class: key === current ? "active" : "", ...(key === current ? { "aria-current": "true" } : {}) }, label)));
  }

  // ---- the lists ----

  async function listView(setTitle) {
    setTitle("Read");
    const list = await loadDialogues();
    const opened = await readOpened();
    const next = dialogues.suggestedDialogue(list, opened);
    return h("div", {},
      readToggle("dialogues"),
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

  async function textsListView(setTitle) {
    setTitle("Read");
    const list = await loadTexts();
    const opened = await readOpened(TEXTS_OPENED_KEY);
    const next = textsMod.suggestedText(list, opened);
    return h("div", {},
      readToggle("texts"),
      h("div", { class: "card" },
        h("h2", {}, "Texts"),
        h("p", { class: "text" }, "Short readings, from one sentence to a short passage. Every one is open: start anywhere.")),
      textsMod.byLevel(list).map((group) =>
        h("div", {},
          h("h3", {}, textsMod.levelLabel(group.level)),
          h("div", { class: "dialogue-list" },
            group.texts.map((t) =>
              h("a", { href: `#/read/text/${t.id}`, class: "dialogue-row" },
                h("span", { class: "dialogue-title" }, t.title),
                h("span", { class: "dialogue-meta" }, t.sentences.length === 1 ? "1 sentence" : `${t.sentences.length} sentences`),
                t.id === next.id ? h("span", { class: "tag" }, "Up next") : null))))));
  }

  // ---- speech for a screen of rows (shared by a dialogue and a text) ----

  /**
   * Speaker buttons and "Hear whole ..." for rows of Arabic. `rows` are the row elements (so the one being
   * read can be marked), `texts` the Arabic to say, in order. Nothing is spoken until a button is pressed.
   */
  function makePlayer({ rows, texts, idleLabel, hasVoice }) {
    const msg = h("p", { class: "speak-msg small", role: "status" });
    const setMsg = (t) => { msg.textContent = t; };
    let playing = false;
    let token = 0;
    const showPlaying = (index) => rows.forEach((row, i) => row.classList.toggle("playing", i === index));

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
      hearAll.textContent = idleLabel;
      Promise.resolve(speech.stop?.()).catch(() => {});
    }
    async function playAll() {
      if (playing) return stopAll();
      playing = true;
      const mine = ++token;
      hearAll.textContent = "Stop";
      setMsg("");
      try {
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
          hearAll.textContent = idleLabel;
        }
      }
    }
    const hearAll = button(idleLabel, playAll, "btn");
    if (!hasVoice) hearAll.disabled = true;

    const speakButton = (index, label) => h("button", {
      type: "button", class: "speak-btn", "aria-label": `Hear ${label} ${index + 1}`, title: `Hear this ${label}`,
      onclick: () => { if (playing) stopAll(); speakOne(texts[index]); },
    }, "\u{1F50A}");

    // Leaving the screen (Back, a tab, another route) stops any speech.
    const onLeave = () => {
      stopAll();
      window.removeEventListener("hashchange", onLeave);
    };
    window.addEventListener("hashchange", onLeave);

    return { msg, hearAll, speakButton };
  }

  /** A row that shows or hides the transliteration and meaning when tapped, with a speaker beside it. */
  function lineRow({ cls, who, line, speakBtn }) {
    const detail = h("div", { class: "bubble-detail" },
      h("div", { class: "bubble-tr", dir: "ltr" }, line.tr),
      h("div", {}, line.en));
    detail.hidden = true;
    const bubble = h("button", { type: "button", class: "bubble", "aria-expanded": "false" },
      who ? h("span", { class: "bubble-who" }, who) : null,
      h("span", { class: "ar bubble-ar", lang: "ar" }, line.ar),
      detail);
    bubble.addEventListener("click", () => {
      const show = detail.hidden;
      detail.hidden = !show;
      bubble.setAttribute("aria-expanded", String(show));
    });
    return h("div", { class: cls }, bubble, speakBtn);
  }

  // ---- one dialogue ----

  async function dialogueView(id, setTitle) {
    const list = await loadDialogues();
    const dialogue = dialogues.findDialogue(list, id);
    if (!dialogue) return listView(setTitle);
    setTitle(dialogue.title);

    const voice = await speech.checkArabic().catch(() => ({ ok: false }));
    // Remember that it was opened (only to move the "Up next" marker). Failing to save changes nothing.
    readOpened().then((opened) => store.setMeta(OPENED_KEY, dialogues.markOpened(list, opened, dialogue.id))).catch(() => {});

    const rows = [];
    const player = makePlayer({ rows, texts: dialogues.hearAllTexts(dialogue), idleLabel: "Hear whole dialogue", hasVoice: voice.ok === true });
    const bubbles = dialogue.lines.map((line, i) => {
      const row = lineRow({
        cls: line.who === "b" ? "bubble-row who-b" : "bubble-row",
        who: dialogues.speakerName(dialogue, line), line, speakBtn: player.speakButton(i, "line"),
      });
      rows.push(row);
      return row;
    });

    return h("div", { class: "practice" },
      h("div", { class: "practice-head" }, link("#/read", "← Back to Read")),
      voiceNote(voice),
      h("p", { class: "text small" }, "Tap a line to see what it means."),
      h("div", { class: "bubbles" }, bubbles),
      player.msg,
      h("div", { class: "actions-bar" }, player.hearAll));
  }

  // ---- one text ----

  async function textView(id, setTitle) {
    const list = await loadTexts();
    const text = textsMod.findText(list, id);
    if (!text) return textsListView(setTitle);
    setTitle(text.title);

    const voice = await speech.checkArabic().catch(() => ({ ok: false }));
    readOpened(TEXTS_OPENED_KEY).then((opened) => store.setMeta(TEXTS_OPENED_KEY, textsMod.markOpened(list, opened, text.id))).catch(() => {});

    const rows = [];
    const player = makePlayer({ rows, texts: textsMod.hearAllTexts(text), idleLabel: "Hear whole text", hasVoice: voice.ok === true });
    const sentences = text.sentences.map((line, i) => {
      const row = lineRow({ cls: "bubble-row", who: null, line, speakBtn: player.speakButton(i, "sentence") });
      rows.push(row);
      return row;
    });

    // One question, never graded: the answer, a short note and nothing else.
    const q = textsMod.buildQuestion(text, rng);
    const feedback = h("div", { class: "feedback", role: "status" });
    let answered = false;
    const choices = q.options.map((option) => {
      const btn = h("button", { type: "button", class: "choice", dir: "auto", onclick: () => answer(option, btn) }, option.text);
      return btn;
    });
    function answer(option, btn) {
      if (answered) return;
      answered = true;
      const result = textsMod.checkAnswer(text, option.id);
      choices.forEach((b, i) => {
        b.disabled = true;
        if (q.options[i].id === q.answerId) b.classList.add("correct");
      });
      if (!result.correct) btn.classList.add("chosen");
      feedback.replaceChildren(
        h("p", { class: "verdict" }, result.correct ? "Yes!" : "Not quite."),
        ...(result.correct ? [] : [h("p", { class: "text small" }, `The answer is: ${result.answer}.`)]),
        h("p", { class: "text small" }, result.note));
    }

    return h("div", { class: "practice" },
      h("div", { class: "practice-head" }, link("#/read/texts", "← Back to Texts"), h("span", { class: "muted small" }, textsMod.levelLabel(text.level))),
      voiceNote(voice),
      h("p", { class: "text small" }, "Tap a sentence to see what it means."),
      h("div", { class: "bubbles" }, sentences),
      player.msg,
      h("p", { class: "text" }, q.prompt),
      h("div", { class: "choices" }, choices),
      feedback,
      h("div", { class: "actions-bar" }, player.hearAll));
  }

  return async function readScreen({ parts = ["read"], setTitle = () => {} } = {}) {
    if (parts[1] === "dialogue" && parts[2]) return dialogueView(parts[2], setTitle);
    if (parts[1] === "text" && parts[2]) return textView(parts[2], setTitle);
    if (parts[1] === "texts" || parts[1] === "text") return textsListView(setTitle);
    return listView(setTitle);
  };
}
