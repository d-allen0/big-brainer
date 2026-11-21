// Match screen: pair up Arabic tiles with their meanings, 5 pairs per page, 10 per round. UI only.
// Logic lives in match.js.
//
// PACING RULES (CLAUDE.md section 1):
//  - Match is always available and never empty. Nothing is locked, limited or timed.
//  - A wrong pair costs nothing: both tiles reset, a short note says what goes with what, the Arabic
//    is spoken, and the item comes back on a short extra page. No score, timer or speed is shown.
//  - Nothing advances on a timer: Next page, Keep going and leaving are always the learner's choice.
//  - Nothing is spoken until a pair has been tried.

import * as match from "./match.js";
import * as quiz from "./quiz.js";
import * as alphabet from "./alphabet.js";
import * as vocab from "./vocab.js";
import * as phrasesMod from "./phrases.js";
import * as srs from "./srs.js";
import * as db from "./db.js";
import * as tts from "./tts.js";

const DECKS = [alphabet.DECK, vocab.DECK, phrasesMod.DECK];
const LONG_TEXT = 16; // tiles with longer text are set a little smaller

/**
 * Build the screen. `h` is the app's DOM helper. Storage, speech, the scheduling clock and the
 * shuffle are injectable for tests.
 */
export function createMatchScreen({
  h,
  loadLetters = alphabet.loadLetters,
  loadWords = vocab.loadVocab,
  loadPhrases = phrasesMod.loadPhrases,
  store = db,
  speech = tts,
  now = () => Date.now(),
  rng = Math.random,
}) {
  const link = (href, text, cls = "") => h("a", { href, class: cls }, text);
  const button = (text, onClick, cls = "btn") => h("button", { type: "button", class: cls, onclick: onClick }, text);

  function showError(container, err) {
    container.replaceChildren(h("p", { class: "error" }, "Something went wrong: " + (err?.message ?? err)));
  }

  function voiceNote(result) {
    if (result.ok) return null;
    const kids = [h("p", { class: "text" }, result.message ?? "Arabic speech is not available on this device.")];
    if (result.code === "no-arabic-voice") {
      kids.push(button("Open voice settings", () => speech.openVoiceInstall(), "btn secondary"));
    }
    return h("div", { class: "note", role: "status" }, ...kids);
  }

  async function matchView(setTitle) {
    setTitle("Match");
    const [letters, words, phrases] = await Promise.all([loadLetters(), loadWords(), loadPhrases()]);
    const voice = await speech.checkArabic().catch(() => ({ ok: false }));

    const label = h("span", { class: "muted small" });
    const content = h("div", { class: "practice-body" });
    const root = h("div", { class: "practice" },
      h("div", { class: "practice-head" }, link("#/", "← Back to Home"), label),
      voiceNote(voice),
      content);

    let state = null;
    let latest = new Map();
    let selection = { left: null, right: null };
    let awaiting = null; // { shown, next, advanced } while a finished page is on screen

    const freshCards = async () => (await store.getAllCards()).filter((c) => DECKS.includes(c.deck));

    // What is spoken for an item: a letter says its name, words and phrases say themselves.
    function speakText(id) {
      const card = latest.get(id);
      if (card?.deck === alphabet.DECK) return letters.find((l) => l.id === card.extra.letterId)?.name ?? card.front;
      return card?.front ?? "";
    }
    const say = (id) => speech.speak(speakText(id)).catch(() => {}); // the note above already explains missing voices

    async function startRound() {
      let cards = await freshCards();
      // Always something to match: seed the suggested group and sets. Progress is never overwritten.
      await store.addCardsIfMissing(quiz.seedForQuiz({ cards, letters, words, phrases, now: now() }));
      cards = await freshCards();
      latest = new Map(cards.map((c) => [c.id, c]));
      const picked = match.pickMatchCards({ cards, now: now() });
      selection = { left: null, right: null };
      awaiting = null;

      if (picked.length === 0) {
        label.textContent = "";
        content.replaceChildren(
          h("div", { class: "card" }, h("p", { class: "text" }, "There is nothing to match yet."),
            h("div", { class: "row spaced" }, link("#/", "Back to Home", "btn"))));
        return;
      }
      state = match.createRound(picked, rng);
      showPage();
    }

    const feedback = h("div", { class: "feedback match-feedback", role: "status" });
    const actions = h("div", { class: "actions-bar" });

    function tile(side, t, shown) {
      const done = shown.matched.includes(t.id);
      const selected = !done && selection[side] === t.id;
      const long = t.text.length >= LONG_TEXT ? " long" : "";
      const el = h("button", {
        type: "button",
        class: "tile" + (side === "left" ? " ar" : "") + long + (selected ? " selected" : "") + (done ? " done" : ""),
        "aria-pressed": String(selected),
        onclick: () => tap(side, t.id),
      }, t.text);
      if (side === "left") el.setAttribute("lang", "ar");
      el.disabled = done || awaiting !== null;
      return el;
    }

    function showPage(shown = state) {
      const p = match.progress(shown);
      label.textContent = p.retry ? "Another look" : `Page ${p.page} of ${p.pages}`;
      content.replaceChildren(
        h("p", { class: "text small match-hint" }, "Tap an Arabic tile, then the tile that goes with it."),
        h("div", { class: "match-grid" },
          h("div", { class: "match-col" }, shown.layout.left.map((t) => tile("left", t, shown))),
          h("div", { class: "match-col" }, shown.layout.right.map((t) => tile("right", t, shown)))),
        feedback,
        actions);
    }

    function tap(side, id) {
      if (awaiting) return;
      selection[side] = selection[side] === id ? null : id; // tap again to let go; tap another to swap
      if (selection.left && selection.right) return attempt();
      showPage();
    }

    function attempt() {
      const { left, right } = selection;
      selection = { left: null, right: null };
      const before = state;
      const res = match.pairUp(state, left, right, rng);

      if (!res.correct) {
        state = res.state;
        feedback.replaceChildren(
          h("p", { class: "verdict" }, "Not quite."),
          ...res.note.map((line) => h("p", { class: "text small" }, line)));
        say(left);
        return showPage();
      }

      feedback.replaceChildren();
      say(left);
      for (const { id, grade } of res.grades) {
        const updated = srs.review(latest.get(id), srs.GRADES[grade], now()); // match.js names grades; srs wants the number
        latest.set(id, updated);
        store.putCard(updated).catch((err) => {
          feedback.append(h("p", { class: "muted small" }, "Could not save this answer: " + err.message));
        });
      }

      if (!res.advanced) {
        state = res.state;
        return showPage();
      }
      // A page is finished: leave it on screen (all faded) until the learner chooses to go on.
      const shown = { ...before, matched: [...before.matched, left] };
      awaiting = { next: res.state, advanced: res.advanced };
      const text = res.advanced === "page" ? "Next page" : res.advanced === "retry" ? "Keep going" : "Finish round";
      actions.replaceChildren(button(text, goOn, "btn"));
      showPage(shown);
    }

    function goOn() {
      const { next, advanced } = awaiting;
      awaiting = null;
      state = next;
      actions.replaceChildren();
      feedback.replaceChildren();
      if (advanced === "done") return showSummary();
      showPage();
    }

    function showSummary() {
      label.textContent = "";
      content.replaceChildren(
        h("div", { class: "card center" },
          h("h2", {}, "Round complete"),
          h("p", { class: "text" }, `All ${state.items.length} pairs matched.`)),
        h("div", { class: "actions-bar" },
          button("Keep going", () => startRound().catch((err) => showError(content, err)), "btn"),
          link("#/", "Back to Home", "btn secondary")));
    }

    await startRound();
    return root;
  }

  return async function render({ setTitle = () => {} } = {}) {
    return matchView(setTitle);
  };
}
