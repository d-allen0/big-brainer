// Quiz screen: a mixed round of letters, words and phrases with three question types
// (choose, listen and pick, type the answer). UI only. Logic lives in quiz.js.
//
// PACING RULES (CLAUDE.md section 1):
//  - A quiz is always available and never empty. Nothing is locked or limited.
//  - Nothing advances on a timer and no timer or speed is ever shown. How fast an answer
//    was given is measured silently and only picks a scheduling grade (see quiz.speedGrade).
//  - A wrong answer gets a calm explanation, is spoken, and returns later in the round.
//  - Skip, Keep going and leaving are always available. Nothing is spoken before an answer.

import * as quiz from "./quiz.js";
import * as alphabet from "./alphabet.js";
import * as vocab from "./vocab.js";
import * as phrasesMod from "./phrases.js";
import * as srs from "./srs.js";
import * as db from "./db.js";
import * as tts from "./tts.js";

const REQUEUE_GAP = 3;
const DECKS = [alphabet.DECK, vocab.DECK, phrasesMod.DECK];

/**
 * Build the screen. `h` is the app's DOM helper. Everything else is injectable for tests:
 * `clock()` measures milliseconds for the silent speed grade, `now()` is the scheduling clock.
 */
export function createQuizScreen({
  h,
  loadLetters = alphabet.loadLetters,
  loadWords = vocab.loadVocab,
  loadPhrases = phrasesMod.loadPhrases,
  store = db,
  speech = tts,
  now = () => Date.now(),
  clock = () => Date.now(),
  rng = Math.random,
}) {
  const link = (href, text, cls = "") => h("a", { href, class: cls }, text);
  const button = (text, onClick, cls = "btn") => h("button", { type: "button", class: cls, onclick: onClick }, text);

  function showError(container, err) {
    container.replaceChildren(h("p", { class: "error" }, "Something went wrong: " + (err?.message ?? err)));
  }

  /** Small speaker button. Speaks only when pressed; a failure becomes a plain message. */
  function speakBtn(text, label, onError, onPress = () => {}, extraClass = "") {
    return h("button", {
      type: "button",
      class: "speak-btn" + extraClass,
      "aria-label": label,
      title: label,
      onclick: async () => {
        onPress();
        try {
          onError("");
          await speech.speak(text);
        } catch (err) {
          onError(err?.message ?? "Could not play the sound.");
        }
      },
    }, "\u{1F50A}");
  }

  function voiceNote(result) {
    if (result.ok) return null;
    const kids = [h("p", { class: "text" }, result.message ?? "Arabic speech is not available on this device.")];
    if (result.code === "no-arabic-voice") {
      kids.push(button("Open voice settings", () => speech.openVoiceInstall(), "btn secondary"));
    }
    return h("div", { class: "note", role: "status" }, ...kids);
  }

  async function quizView(setTitle) {
    setTitle("Quiz");
    const [letters, words, phrases] = await Promise.all([loadLetters(), loadWords(), loadPhrases()]);
    const voice = await speech.checkArabic().catch(() => ({ ok: false }));
    const hasVoice = voice.ok === true;

    const content = h("div", { class: "practice-body" });
    const left = h("span", { class: "muted small" });
    const root = h("div", { class: "practice" },
      h("div", { class: "practice-head" }, link("#/", "← Back to Home"), left),
      voiceNote(voice),
      content);

    let queue = [];
    let latest = new Map();
    let stats = { answered: 0, right: 0 };
    let cleanup = () => {};

    async function freshCards() {
      return (await store.getAllCards()).filter((c) => DECKS.includes(c.deck));
    }

    async function startRound() {
      let cards = await freshCards();
      // Always something to quiz on: seed the suggested group and set. Progress is never overwritten.
      await store.addCardsIfMissing(quiz.seedForQuiz({ cards, letters, words, phrases, now: now() }));
      cards = await freshCards();
      latest = new Map(cards.map((c) => [c.id, c]));
      queue = quiz.pickQuizCards({ cards, now: now() }).map((c) => c.id);
      stats = { answered: 0, right: 0 };

      if (queue.length === 0) {
        left.textContent = "";
        content.replaceChildren(
          h("div", { class: "card" }, h("p", { class: "text" }, "There is nothing to quiz on yet."),
            h("div", { class: "row spaced" }, link("#/", "Back to Home", "btn"))));
        return;
      }
      showQuestion();
    }

    function showQuestion() {
      cleanup();
      try {
        const cardId = queue.shift();
        const card = latest.get(cardId);
        // Wrong letters come from letters the learner has already met, when there are enough.
        const metIds = new Set([...latest.values()].filter((c) => c.deck === alphabet.DECK).map((c) => c.extra?.letterId));
        const met = letters.filter((l) => metIds.has(l.id));
        const q = quiz.buildQuizQuestion({ card, letters, words, phrases, hasVoice, rng, letterPool: met.length >= 4 ? met : letters });
        const longText = q.deck === phrasesMod.DECK ? " long" : ""; // phrases are longer, so they are set a little smaller
        const word = q.deck === vocab.DECK ? words.find((w) => w.id === q.itemId) : null;

        let answered = false;
        let interrupted = false; // the app left the screen while this question was open
        let startedAt = clock();
        const onVisibility = () => { if (document.hidden) interrupted = true; };
        document.addEventListener("visibilitychange", onVisibility);
        cleanup = () => document.removeEventListener("visibilitychange", onVisibility);

        const feedback = h("div", { class: "feedback" + longText, role: "status" });
        const speakMsg = h("p", { class: "speak-msg small", role: "status" });
        const setMsg = (t) => { speakMsg.textContent = t; };
        const actions = h("div", { class: "actions-bar" }); // pinned above the tab bar

        // ---- answer handling (shared by every question type) ----
        function conclude({ correct, chosenId = null, typo = false, onLock }) {
          answered = true;
          cleanup();
          onLock?.();
          const ms = interrupted ? null : clock() - startedAt;
          const grade = quiz.speedGrade({ correct, ms, type: q.type, firstView: card.lastReviewed == null });

          const verdict = h("p", { class: "verdict" }, correct ? (typo ? "Yes! Just a small slip in spelling." : "Yes!") : "Not quite.");
          const hearAgain = q.type === "choice" && !q.promptIsArabic; // the Arabic is only revealed now
          feedback.replaceChildren(
            hearAgain ? h("div", { class: "verdict-row" }, verdict, speakBtn(q.speakAfter, "Hear it again", setMsg)) : verdict,
            ...quiz.explain({ question: q, letters, words, phrases, chosenId: correct ? null : chosenId }).map((line) => h("p", { class: "text small" }, line)),
            speakMsg);
          speech.speak(q.speakAfter).catch(() => {}); // the note above already explains missing voices

          stats.answered++;
          if (correct) stats.right++;
          const updated = srs.review(card, grade, now());
          latest.set(card.id, updated);
          if (!correct) queue = srs.requeueAfter(queue, card.id, REQUEUE_GAP);

          actions.replaceChildren(
            button(queue.length > 0 ? "Next" : "Finish round", () => (queue.length > 0 ? showQuestion() : showSummary()), "btn"));

          store.putCard(updated).catch((err) => {
            feedback.append(h("p", { class: "muted small" }, "Could not save this answer: " + err.message));
          });
        }

        // ---- the question itself ----
        const parts = [];
        let promptNode;
        if (q.type === "listen") {
          promptNode = h("div", { class: "prompt-row" },
            speakBtn(q.speakText, "Hear it", setMsg, () => { if (!answered) startedAt = clock(); }, " speak-big"));
        } else if (q.promptIsArabic) {
          const speakWord = (q.deck === vocab.DECK || q.deck === phrasesMod.DECK) && q.kind === "ar2en"; // letters: the sound would give the answer away
          promptNode = h("div", { class: "prompt-row" },
            h("div", { class: "ar prompt" + longText, lang: "ar" }, q.prompt),
            speakWord ? speakBtn(q.speakAfter, q.deck === phrasesMod.DECK ? "Hear this phrase" : "Hear this word", setMsg) : null);
        } else {
          promptNode = h("div", { class: "prompt-en" + longText }, q.prompt);
        }
        parts.push(h("div", { class: "card center" }, h("p", { class: "text" }, q.instruction), promptNode));

        if (q.type === "type") {
          const input = h("input", {
            type: "text", class: "type-input", "aria-label": "Your answer", placeholder: "Type the meaning",
            autocomplete: "off", autocapitalize: "none", autocorrect: "off", spellcheck: "false", enterkeyhint: "done", lang: "en",
          });
          const check = () => {
            if (answered) return;
            const result = quiz.checkTyped(input.value, word, words);
            if (result.empty) {
              setMsg("Type your answer, or choose Skip for now.");
              return;
            }
            conclude({
              correct: result.correct,
              typo: result.typo,
              chosenId: result.otherWord?.id ?? null,
              onLock: () => {
                input.readOnly = true;
                input.classList.add(result.correct ? "correct" : "chosen");
              },
            });
          };
          input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); check(); } });
          parts.push(input);
          actions.append(button("Check", check, "btn"));
        } else {
          const buttons = q.choices.map((choice) =>
            h("button", {
              type: "button",
              class: "choice" + (q.choicesAreArabic ? " choice-ar" + longText : ""),
              dir: "auto",
              ...(q.choicesAreArabic ? { lang: "ar" } : {}),
              onclick: () => {
                if (answered) return;
                const correct = choice.id === q.answerId;
                conclude({
                  correct,
                  chosenId: choice.id,
                  onLock: () => buttons.forEach((b, i) => {
                    b.disabled = true;
                    if (q.choices[i].id === q.answerId) b.classList.add("correct");
                    else if (q.choices[i] === choice) b.classList.add("chosen");
                  }),
                });
              },
            }, choice.text));
          parts.push(h("div", { class: "choices" + longText }, buttons));
        }

        if (queue.length > 0) {
          actions.prepend(button("Skip for now", () => {
            if (answered) return;
            queue = srs.requeueAfter(queue, cardId, queue.length); // to the end, ungraded
            showQuestion();
          }, "btn secondary"));
        }

        left.textContent = `${queue.length + 1} left in this round`;
        content.replaceChildren(...parts, feedback, q.type === "type" || q.promptIsArabic || q.type === "listen" ? speakMsg : null, actions);
      } catch (err) {
        showError(content, err);
      }
    }

    function showSummary() {
      cleanup();
      left.textContent = "";
      content.replaceChildren(
        h("div", { class: "card center" },
          h("h2", {}, "Round complete"),
          h("p", { class: "text" }, `${stats.right} of ${stats.answered} answers were right.`)),
        h("div", { class: "actions-bar" },
          button("Keep going", () => startRound().catch((err) => showError(content, err)), "btn"),
          link("#/", "Back to Home", "btn secondary")));
    }

    await startRound();
    return root;
  }

  return async function render({ setTitle = () => {} } = {}) {
    return quizView(setTitle);
  };
}
