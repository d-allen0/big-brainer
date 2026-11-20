// Cards screen: word sets and phrase sets with multiple-choice practice.
// UI only. Logic lives in vocab.js, phrases.js, srs.js, db.js and tts.js.
// A toggle at the top of the overview switches between decks. Each deck is described by an
// entry in DECKS below, so another deck (for example a new list of names) is one more entry.
//
// PACING RULES (CLAUDE.md section 1):
//  - Every set is open at all times; progress only produces suggestions.
//  - Practice is always available. No due dates, counts or "come back later".
//  - Nothing advances on a timer. The learner taps Next, Skip, Keep going or leaves.
//  - A wrong answer gets a calm explanation, is spoken, and returns later in the round.

import * as vocab from "./vocab.js";
import * as phrases from "./phrases.js";
import * as srs from "./srs.js";
import * as db from "./db.js";
import * as tts from "./tts.js";

const ROUND_SIZE = 10;
const REQUEUE_GAP = 3;
const WELL_KNOWN = 0.8;

// One entry per deck. `mod` is the logic module; the adapters hide small naming differences
// between modules (wordsOfSet / phrasesOfSet, `word` / `phrase` arguments, card extra ids).
const DECKS = {
  words: {
    key: "words", label: "Words", base: "#/cards", noun: "words", singular: "word", mod: vocab, idField: "wordId",
    headsUpKey: "vocab.headsUpDismissed", layout: "tiles",
    question: { ar2en: "What does this word mean?", en2ar: "Which Arabic word means this?" },
    itemsOfSet: (list, set) => vocab.wordsOfSet(list, set),
    makeQuestion: ({ item, kind, list, rng }) => vocab.buildQuestion({ word: item, kind, words: list, rng, choiceCount: 4 }),
    note: ({ item, chosen }) => vocab.mistakeNote({ word: item, chosen }),
  },
  phrases: {
    key: "phrases", label: "Phrases", base: "#/cards/phrases", noun: "phrases", singular: "phrase", mod: phrases, idField: "phraseId",
    headsUpKey: "phrases.headsUpDismissed", layout: "rows",
    question: { ar2en: "What does this phrase mean?", en2ar: "Which Arabic phrase means this?" },
    itemsOfSet: (list, set) => phrases.phrasesOfSet(list, set),
    makeQuestion: ({ item, kind, list, rng }) => phrases.buildQuestion({ phrase: item, kind, phrases: list, rng, choiceCount: 4 }),
    note: ({ item, chosen }) => phrases.mistakeNote({ phrase: item, chosen }),
  },
};

/**
 * Build the screen. `h` is the app's DOM helper. Everything else is injectable for tests.
 * Returns render({ parts, setTitle }) -> Promise<Node>, where `parts` is the hash path,
 * e.g. ["cards"], ["cards", "practice"], ["cards", "practice", "set", "2"].
 */
export function createVocabScreen({
  h,
  loadWords = vocab.loadVocab,
  loadPhrases = phrases.loadPhrases,
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

  /**
   * Small speaker button: speaks `text` only when pressed (nothing is ever spoken automatically
   * before an answer). A failure is shown as a plain message through `onError`.
   */
  function speakBtn(text, label, onError) {
    return h("button", {
      type: "button",
      class: "speak-btn",
      "aria-label": label,
      title: label,
      onclick: async () => {
        try {
          onError("");
          await speech.speak(text);
        } catch (err) {
          onError(err?.message ?? "Could not play the sound.");
        }
      },
    }, "\u{1F50A}");
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
          await store.setMeta(ctx.deck.headsUpKey, [...ctx.dismissed]);
        } catch {
          // not being able to remember the dismissal is harmless
        }
      }, "btn secondary"));
    return box;
  }

  // ---------- data ----------

  async function load(deck) {
    const items = await (deck.key === "words" ? loadWords() : loadPhrases());
    const cards = (await store.getAllCards()).filter((c) => c.deck === deck.mod.DECK);
    const dismissed = await store.getMeta(deck.headsUpKey, []);
    return {
      deck,
      items,
      cards,
      dismissed: Array.isArray(dismissed) ? dismissed : [],
      suggested: deck.mod.suggestedSet(cards, items),
      mastery: deck.mod.setMastery(cards, items),
    };
  }

  /** Words | Phrases switch at the top of the overview. The current deck is marked, both are links. */
  function deckToggle(current) {
    return h("nav", { class: "segmented", "aria-label": "Choose a deck" },
      Object.values(DECKS).map((d) =>
        h("a", { href: d.base, class: d.key === current.key ? "active" : "", ...(d.key === current.key ? { "aria-current": "true" } : {}) }, d.label)));
  }

  // ---------- sets overview ----------

  function setsView(ctx, setTitle) {
    setTitle("Flashcards");
    const { deck, items, cards, suggested, mastery } = ctx;
    const byId = new Map(cards.map((c) => [c.id, c]));
    const learned = (item) => deck.mod.cardsForSet([item], 1, 0).every((c) => (byId.get(c.id)?.reps ?? 0) >= 2);
    const learnedCount = items.filter(learned).length;
    const milestones = [];
    if (learnedCount === items.length) milestones.push(`All ${items.length} ${deck.noun} learned`);

    const progress = h("div", { class: "card" },
      h("h2", {}, "Your progress"),
      h("div", { class: "stat" }, `${learnedCount} of ${items.length}`),
      h("p", {}, `${deck.noun} learned`),
      ...milestones.map((m) => h("p", { class: "text small" }, "✓ " + m)),
      h("div", { class: "row spaced" }, link(`${deck.base}/practice`, "Practice", "btn")),
      h("p", { class: "small" }, `Picks the ${deck.noun} that could use the most practice. Stop whenever you like.`));

    const speakMsg = h("p", { class: "speak-msg small", role: "status" });
    const setMsg = (t) => { speakMsg.textContent = t; };
    const sets = mastery.map((m) => {
      const list = deck.itemsOfSet(items, m.set);
      const tile = (w) => deck.layout === "rows"
        ? h("div", { class: "phrase" + (learned(w) ? " learned" : "") },
            h("div", { class: "phrase-text" },
              h("span", { class: "ar", lang: "ar" }, w.ar),
              h("span", { class: "small" }, w.en)),
            speakBtn(w.ar, `Hear ${w.en}`, setMsg))
        : h("div", { class: "word" + (learned(w) ? " learned" : "") },
            h("span", { class: "ar", lang: "ar" }, w.ar),
            h("span", { class: "small" }, w.en),
            speakBtn(w.ar, `Hear ${w.en}`, setMsg));
      return h("section", { class: "card" },
        h("div", { class: "group-head" },
          h("h2", {}, `Set ${m.set}`),
          m.set === suggested && m.ratio < WELL_KNOWN ? h("span", { class: "tag" }, "Up next") : null,
          m.ratio >= WELL_KNOWN ? h("span", { class: "tag quiet" }, "Well known") : null),
        h("div", { class: deck.layout === "rows" ? "phrase-list" : "word-grid" }, list.map(tile)),
        h("div", { class: "row spaced" }, link(`${deck.base}/practice/set/${m.set}`, "Practice this set", "btn secondary")));
    });

    return h("div", {}, deckToggle(deck), voiceBanner(), progress, speakMsg, ...sets);
  }

  // ---------- practice ----------

  async function practiceView(ctx, scope, setTitle) {
    setTitle("Practice");
    const { deck, items } = ctx;
    const mod = deck.mod;
    const scopeItems = scope.type === "set" ? deck.itemsOfSet(items, scope.set) : items;
    const scopeIds = new Set(scopeItems.map((w) => w.id));

    const content = h("div", { class: "practice-body" });
    const left = h("span", { class: "muted small" });
    const root = h("div", { class: "practice" },
      h("div", { class: "practice-head" }, link(deck.base, `← Back to ${deck.noun}`), left),
      scope.type === "set" ? headsUp(ctx, scope.set) : null,
      voiceBanner(),
      content);

    let queue = [];
    let latest = new Map();
    let stats = { answered: 0, right: 0 };

    async function freshCards() {
      return (await store.getAllCards()).filter((c) => c.deck === mod.DECK);
    }

    async function startRound() {
      let cards = await freshCards();
      // Always something to practice: seed the scope, or for "all" the suggested set.
      // Existing progress is never overwritten.
      const seedSet = scope.type === "all" ? mod.suggestedSet(cards, items) : scope.set;
      await store.addCardsIfMissing(mod.cardsForSet(items, seedSet, now()));
      cards = await freshCards();

      const pool = cards.filter((c) => scopeIds.has(c.extra?.[deck.idField]));
      latest = new Map(cards.map((c) => [c.id, c]));
      queue = srs.practiceOrder(pool, now(), { limit: ROUND_SIZE }).map((c) => c.id);
      stats = { answered: 0, right: 0 };

      if (queue.length === 0) {
        left.textContent = "";
        content.replaceChildren(
          h("div", { class: "card" }, h("p", { class: "text" }, "There is nothing to practice here yet."),
            h("div", { class: "row spaced" }, link(deck.base, `Back to ${deck.noun}`, "btn"))));
        return;
      }
      showQuestion();
    }

    function showQuestion() {
      try {
        const cardId = queue.shift();
        const card = latest.get(cardId);
        const word = items.find((w) => w.id === card.extra[deck.idField]);
        const q = deck.makeQuestion({ item: word, kind: card.extra.kind, list: items, rng });
        const longText = deck.key === "phrases" ? " long" : ""; // phrases are longer, so their Arabic is set a little smaller

        let answered = false;
        const feedback = h("div", { class: "feedback" + longText, role: "status" });
        const speakMsg = h("p", { class: "speak-msg small", role: "status" });
        const setMsg = (t) => { speakMsg.textContent = t; };
        const actions = h("div", { class: "actions-bar" }); // pinned above the tab bar

        const buttons = q.choices.map((choice) =>
          h("button", {
            type: "button",
            class: "choice" + (q.choicesAreArabic ? " choice-ar" + longText : ""),
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

          const chosen = correct ? null : items.find((w) => w.id === choice.id);
          const verdict = h("p", { class: "verdict" }, correct ? "Yes!" : "Not quite.");
          feedback.replaceChildren(
            // meaning-to-Arabic: the Arabic is only revealed after answering, so the button appears now
            q.promptIsArabic ? verdict : h("div", { class: "verdict-row" }, verdict, speakBtn(word.ar, "Hear it again", setMsg)),
            ...deck.note({ item: word, chosen }).map((line) => h("p", { class: "text small" }, line)),
            speakMsg);
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
            h("p", { class: "text" }, deck.question[q.kind]),
            q.promptIsArabic
              ? h("div", { class: "prompt-row" },
                  h("div", { class: "ar prompt" + longText, lang: "ar" }, q.prompt),
                  speakBtn(word.ar, `Hear this ${deck.singular}`, setMsg))
              : h("div", { class: "prompt-en" + longText }, q.prompt)),
          h("div", { class: "choices" + longText }, buttons),
          feedback,
          q.promptIsArabic ? speakMsg : null,
          actions);
      } catch (err) {
        showError(content, err);
      }
    }

    async function showSummary() {
      left.textContent = "";
      let next = null;
      try {
        next = mod.suggestedSet(await freshCards(), items);
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
          link(deck.base, `Back to ${deck.noun}`, "btn secondary")));
    }

    await startRound();
    return root;
  }

  // ---------- routing ----------

  return async function render({ parts = ["cards"], setTitle = () => {} } = {}) {
    const deck = parts[1] === "phrases" ? DECKS.phrases : DECKS.words;
    const [view, a, b] = parts.slice(deck.key === "phrases" ? 2 : 1);
    const ctx = await load(deck);

    if (view === "practice") {
      if (a === "set") {
        const set = Number(b);
        if (Number.isInteger(set) && set >= 1 && set <= deck.mod.setCount(ctx.items)) {
          return practiceView(ctx, { type: "set", set }, setTitle);
        }
      } else if (a === undefined) {
        return practiceView(ctx, { type: "all" }, setTitle);
      }
    }
    return setsView(ctx, setTitle);
  };
}
