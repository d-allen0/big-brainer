// Cards screen: word sets and multiple-choice vocabulary practice.
// UI only. Logic lives in vocab.js, srs.js, db.js and tts.js.
//
// PACING RULES (CLAUDE.md section 1):
//  - Every set is open at all times; progress only produces suggestions.
//  - Practice is always available. No due dates, counts or "come back later".
//  - Nothing advances on a timer. The learner taps Next, Skip, Keep going or leaves.
//  - A wrong answer gets a calm explanation, is spoken, and returns later in the round.

import * as vocab from "./vocab.js";
import * as srs from "./srs.js";
import * as db from "./db.js";
import * as tts from "./tts.js";

const ROUND_SIZE = 10;
const REQUEUE_GAP = 3;
const WELL_KNOWN = 0.8;
const HEADS_UP_KEY = "vocab.headsUpDismissed";
const QUESTION_TEXT = {
  ar2en: "What does this word mean?",
  en2ar: "Which Arabic word means this?",
};

/**
 * Build the screen. `h` is the app's DOM helper. Everything else is injectable for tests.
 * Returns render({ parts, setTitle }) -> Promise<Node>, where `parts` is the hash path,
 * e.g. ["cards"], ["cards", "practice"], ["cards", "practice", "set", "2"].
 */
export function createVocabScreen({
  h,
  loadWords = vocab.loadVocab,
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

  /** Quiet note shown only if Arabic speech is unavailable. Fills in without blocking the page. */
  function voiceBanner() {
    const box = h("div");
    speech
      .checkArabic()
      .then((result) => {
        if (result.ok) return;
        const kids = [h("p", { class: "text" }, result.message ?? "Arabic speech is not available on this device.")];
        if (result.code === "no-arabic-voice") {
          kids.push(button("Open voice settings", () => speech.openVoiceInstall(), "btn secondary"));
        }
        box.append(h("div", { class: "note", role: "status" }, ...kids));
      })
      .catch(() => {});
    return box;
  }

  /** One gentle, dismissible note when a set is far past the suggested one. Never blocks. */
  function headsUp(ctx, set) {
    if (!vocab.farAhead(set, ctx.suggested) || ctx.dismissed.includes(set)) return null;
    const box = h("div", { class: "note" },
      h("p", { class: "text" }, "This is a few steps past your suggested next set, so it may feel hard right now. Go at your own pace."),
      button("Got it", async () => {
        box.remove();
        ctx.dismissed.push(set);
        try {
          await store.setMeta(HEADS_UP_KEY, [...ctx.dismissed]);
        } catch {
          // not being able to remember the dismissal is harmless
        }
      }, "btn secondary"));
    return box;
  }

  // ---------- data ----------

  async function load() {
    const words = await loadWords();
    const cards = (await store.getAllCards()).filter((c) => c.deck === vocab.DECK);
    const dismissed = await store.getMeta(HEADS_UP_KEY, []);
    return {
      words,
      cards,
      dismissed: Array.isArray(dismissed) ? dismissed : [],
      suggested: vocab.suggestedSet(cards, words),
      mastery: vocab.setMastery(cards, words),
    };
  }

  // ---------- sets overview ----------

  function setsView(ctx, setTitle) {
    setTitle("Flashcards");
    const { words, cards, suggested, mastery } = ctx;
    const byId = new Map(cards.map((c) => [c.id, c]));
    const learned = (w) => vocab.cardsForWord(w, 0).every((c) => (byId.get(c.id)?.reps ?? 0) >= 2);
    const learnedCount = words.filter(learned).length;
    const milestones = [];
    if (learnedCount === words.length) milestones.push(`All ${words.length} words learned`);

    const progress = h("div", { class: "card" },
      h("h2", {}, "Your progress"),
      h("div", { class: "stat" }, `${learnedCount} of ${words.length}`),
      h("p", {}, "words learned"),
      ...milestones.map((m) => h("p", { class: "text small" }, "✓ " + m)),
      h("div", { class: "row spaced" }, link("#/cards/practice", "Practice", "btn")),
      h("p", { class: "small" }, "Picks the words that could use the most practice. Stop whenever you like."));

    const sets = mastery.map((m) => {
      const list = vocab.wordsOfSet(words, m.set);
      return h("section", { class: "card" },
        h("div", { class: "group-head" },
          h("h2", {}, `Set ${m.set}`),
          m.set === suggested && m.ratio < WELL_KNOWN ? h("span", { class: "tag" }, "Up next") : null,
          m.ratio >= WELL_KNOWN ? h("span", { class: "tag quiet" }, "Well known") : null),
        h("div", { class: "word-grid" },
          list.map((w) =>
            h("div", { class: "word" + (learned(w) ? " learned" : "") },
              h("span", { class: "ar", lang: "ar" }, w.ar),
              h("span", { class: "small" }, w.en)))),
        h("div", { class: "row spaced" }, link(`#/cards/practice/set/${m.set}`, "Practice this set", "btn secondary")));
    });

    return h("div", {}, voiceBanner(), progress, ...sets);
  }

  // ---------- practice ----------

  async function practiceView(ctx, scope, setTitle) {
    setTitle("Practice");
    const { words } = ctx;
    const scopeWords = scope.type === "set" ? vocab.wordsOfSet(words, scope.set) : words;
    const scopeIds = new Set(scopeWords.map((w) => w.id));

    const content = h("div", { class: "practice-body" });
    const left = h("span", { class: "muted small" });
    const root = h("div", { class: "practice" },
      h("div", { class: "practice-head" }, link("#/cards", "← Back to words"), left),
      scope.type === "set" ? headsUp(ctx, scope.set) : null,
      voiceBanner(),
      content);

    let queue = [];
    let latest = new Map();
    let stats = { answered: 0, right: 0 };

    async function freshCards() {
      return (await store.getAllCards()).filter((c) => c.deck === vocab.DECK);
    }

    async function startRound() {
      let cards = await freshCards();
      // Always something to practice: seed the scope, or for "all" the suggested set.
      // Existing progress is never overwritten.
      const seedSet = scope.type === "all" ? vocab.suggestedSet(cards, words) : scope.set;
      await store.addCardsIfMissing(vocab.cardsForSet(words, seedSet, now()));
      cards = await freshCards();

      const pool = cards.filter((c) => scopeIds.has(c.extra?.wordId));
      latest = new Map(cards.map((c) => [c.id, c]));
      queue = srs.practiceOrder(pool, now(), { limit: ROUND_SIZE }).map((c) => c.id);
      stats = { answered: 0, right: 0 };

      if (queue.length === 0) {
        left.textContent = "";
        content.replaceChildren(
          h("div", { class: "card" }, h("p", { class: "text" }, "There is nothing to practice here yet."),
            h("div", { class: "row spaced" }, link("#/cards", "Back to words", "btn"))));
        return;
      }
      showQuestion();
    }

    function showQuestion() {
      try {
        const cardId = queue.shift();
        const card = latest.get(cardId);
        const word = words.find((w) => w.id === card.extra.wordId);
        const q = vocab.buildQuestion({ word, kind: card.extra.kind, words, rng, choiceCount: 4 });

        let answered = false;
        const feedback = h("div", { class: "feedback", role: "status" });
        const actions = h("div", { class: "actions-bar" }); // pinned above the tab bar

        const buttons = q.choices.map((choice) =>
          h("button", {
            type: "button",
            class: "choice" + (q.choicesAreArabic ? " choice-ar" : ""),
            dir: "auto",
            ...(q.choicesAreArabic ? { lang: "ar" } : {}),
            onclick: () => answer(choice),
          }, choice.text));

        if (queue.length > 0) {
          actions.append(button("Skip for now", () => {
            if (answered) return;
            queue = srs.requeueAfter(queue, cardId, queue.length); // to the end, ungraded
            showQuestion();
          }, "btn secondary"));
        }

        function answer(choice) {
          if (answered) return;
          answered = true;
          const correct = choice.id === q.answerId;
          buttons.forEach((b, i) => {
            b.disabled = true;
            if (q.choices[i].id === q.answerId) b.classList.add("correct");
            else if (q.choices[i] === choice) b.classList.add("chosen");
          });

          const chosen = correct ? null : words.find((w) => w.id === choice.id);
          feedback.replaceChildren(
            h("p", { class: "verdict" }, correct ? "Yes!" : "Not quite."),
            ...vocab.mistakeNote({ word, chosen }).map((line) => h("p", { class: "text small" }, line)));
          speech.speak(word.ar).catch(() => {}); // the banner already explains missing voices

          stats.answered++;
          if (correct) stats.right++;
          const updated = srs.review(card, correct ? srs.GRADES.good : srs.GRADES.again, now());
          latest.set(card.id, updated);
          if (!correct) queue = srs.requeueAfter(queue, card.id, REQUEUE_GAP);

          actions.replaceChildren(
            button(queue.length > 0 ? "Next" : "Finish round", () => (queue.length > 0 ? showQuestion() : showSummary()), "btn"));

          store.putCard(updated).catch((err) => {
            feedback.append(h("p", { class: "muted small" }, "Could not save this answer: " + err.message));
          });
        }

        left.textContent = `${queue.length + 1} left in this round`;
        content.replaceChildren(
          h("div", { class: "card center" },
            h("p", { class: "text" }, QUESTION_TEXT[q.kind]),
            q.promptIsArabic
              ? h("div", { class: "ar prompt", lang: "ar" }, q.prompt)
              : h("div", { class: "prompt-en" }, q.prompt)),
          h("div", { class: "choices" }, buttons),
          feedback,
          actions);
      } catch (err) {
        showError(content, err);
      }
    }

    async function showSummary() {
      left.textContent = "";
      let next = null;
      try {
        next = vocab.suggestedSet(await freshCards(), words);
      } catch {
        // the suggestion is optional
      }
      content.replaceChildren(
        h("div", { class: "card center" },
          h("h2", {}, "Round complete"),
          h("p", { class: "text" }, `${stats.right} of ${stats.answered} answers were right.`),
          next ? h("p", { class: "small" }, `Suggested next set: ${next}`) : null),
        h("div", { class: "actions-bar" },
          button("Keep going", () => startRound().catch((err) => showError(content, err)), "btn"),
          link("#/cards", "Back to words", "btn secondary")));
    }

    await startRound();
    return root;
  }

  // ---------- routing ----------

  return async function render({ parts = ["cards"], setTitle = () => {} } = {}) {
    const [, view, a, b] = parts;
    const ctx = await load();

    if (view === "practice") {
      if (a === "set") {
        const set = Number(b);
        if (Number.isInteger(set) && set >= 1 && set <= vocab.setCount(ctx.words)) {
          return practiceView(ctx, { type: "set", set }, setTitle);
        }
      } else if (a === undefined) {
        return practiceView(ctx, { type: "all" }, setTitle);
      }
    }
    return setsView(ctx, setTitle);
  };
}
