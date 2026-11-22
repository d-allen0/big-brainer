// Letters screen: letter grid, single-letter lessons and practice.
// UI only. Logic lives in alphabet.js, srs.js, db.js and tts.js.
//
// PACING RULES (CLAUDE.md section 1):
//  - Every letter and group is open at all times; progress only produces suggestions.
//  - Practice is always available. No due dates, counts or "come back later".
//  - Nothing advances on a timer. The learner taps Next, Skip, Keep going or leaves.
//  - A wrong answer gets a calm explanation, is spoken, and returns later in the round.

import * as alphabet from "./alphabet.js";
import * as marks from "./marks.js";
import * as srs from "./srs.js";
import * as db from "./db.js";
import * as tts from "./tts.js";

const ROUND_SIZE = 10;
const REQUEUE_GAP = 3;
const WELL_KNOWN = 0.8;
const HEADS_UP_KEY = "alphabet.headsUpDismissed";
const FORM_LABELS = { isolated: "Alone", initial: "Start", medial: "Middle", final: "End" };
const QUESTION_TEXT = {
  name: "What is this letter called?",
  sound: "What sound does this letter make?",
  form: "Which letter is this? It is shown joined to its neighbors.",
};

/**
 * Build the screen. `h` is the app's DOM helper. Everything else is injectable for tests.
 * Returns render({ parts, setTitle }) -> Promise<Node>, where `parts` is the hash path,
 * e.g. ["alphabet"], ["alphabet", "letter", "beh"], ["alphabet", "practice", "group", "2"].
 */
export function createLettersScreen({
  h,
  loadLetters = alphabet.loadLetters,
  loadLessons = (letters) => marks.loadMarks(letters), // the Read it rows; if they cannot load, the grid still works
  store = db,
  speech = tts,
  now = () => Date.now(),
  rng = Math.random,
}) {
  // ---------- small building blocks ----------

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

  function speakButton(text, label) {
    const status = h("span", { class: "muted small", role: "status" });
    const btn = button(label, async () => {
      status.textContent = "";
      try {
        await speech.speak(text);
      } catch (err) {
        status.textContent = err.message;
      }
    }, "btn secondary");
    return h("div", { class: "row" }, btn, status);
  }

  /** One gentle, dismissible note when a group is far past the suggested one. Never blocks. */
  function headsUp(ctx, group) {
    if (!alphabet.farAhead(group, ctx.suggested) || ctx.dismissed.includes(group)) return null;
    const box = h("div", { class: "note" },
      h("p", { class: "text" }, "This is a few steps past your suggested next group, so it may feel hard right now. Go at your own pace."),
      button("Got it", async () => {
        box.remove();
        ctx.dismissed.push(group);
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
    const letters = await loadLetters();
    const lessons = await Promise.resolve().then(() => loadLessons(letters)).catch(() => []);
    const all = await store.getAllCards();
    const cards = all.filter((c) => c.deck === alphabet.DECK);
    const markCards = all.filter((c) => c.deck === marks.DECK);
    const dismissed = await store.getMeta(HEADS_UP_KEY, []);
    return {
      letters,
      cards,
      dismissed: Array.isArray(dismissed) ? dismissed : [],
      suggested: alphabet.suggestedGroup(cards, letters),
      mastery: alphabet.groupMastery(cards, letters),
      lessons,
      lessonMastery: marks.lessonMastery(markCards, lessons),
      suggestedLesson: lessons.length > 0 ? marks.suggestedLesson(markCards, lessons) : null,
    };
  }

  // ---------- grid ----------

  function gridView(ctx, setTitle) {
    setTitle("Letters");
    const { letters, cards, suggested, mastery } = ctx;
    const byId = new Map(cards.map((c) => [c.id, c]));
    const cardsOf = (l) => alphabet.cardsForLetter(l, 0).map((c) => byId.get(c.id));
    const learned = (l) => cardsOf(l).every((c) => (c?.reps ?? 0) >= 2);
    const met = (l) => cardsOf(l).some((c) => c?.lastReviewed != null);

    const learnedCount = letters.filter(learned).length;
    const metCount = letters.filter(met).length;
    const milestones = [];
    if (metCount === letters.length) milestones.push(`All ${letters.length} letters met`);
    if (learnedCount === letters.length) milestones.push(`All ${letters.length} letters learned`);

    const progress = h("div", { class: "card" },
      h("h2", {}, "Your progress"),
      h("div", { class: "stat" }, `${learnedCount} of ${letters.length}`),
      h("p", {}, "letters learned"),
      ...milestones.map((m) => h("p", { class: "text small" }, "✓ " + m)),
      h("div", { class: "row spaced" }, link("#/alphabet/practice", "Practice", "btn")),
      h("p", { class: "small" }, "Picks the letters that could use the most practice. Stop whenever you like."));

    // A "Read it" step is a full-width link under the group it follows. Every one is always open.
    // "Up next" shows only once the group before it is well known, and only on the suggested lesson.
    const readItRow = (lesson) => {
      const ratio = ctx.lessonMastery.find((x) => x.lesson === lesson.id)?.ratio ?? 0;
      const well = ratio >= WELL_KNOWN;
      const groupKnown = (mastery[lesson.afterGroup - 1]?.ratio ?? 0) >= WELL_KNOWN;
      const upNext = !well && groupKnown && ctx.suggestedLesson === lesson.id;
      return h("a", { class: "dialogue-row", href: `#/readit/${lesson.id}` },
        h("span", { class: "dialogue-title" }, lesson.title),
        h("span", { class: "dialogue-meta" }, `${lesson.items.length} items`),
        upNext ? h("span", { class: "tag" }, "Up next") : well ? h("span", { class: "tag quiet" }, "Well known") : null);
    };

    const groups = alphabet.groupsOf(letters).map((group, i) => {
      const n = i + 1;
      const m = mastery[i];
      const readIt = marks.lessonsAfterGroup(ctx.lessons, n);
      return h("section", { class: "card" },
        h("div", { class: "group-head" },
          h("h2", {}, `Group ${n}`),
          n === suggested && m.ratio < WELL_KNOWN ? h("span", { class: "tag" }, "Up next") : null,
          m.ratio >= WELL_KNOWN ? h("span", { class: "tag quiet" }, "Well known") : null),
        h("div", { class: "letter-grid" },
          group.map((l) =>
            h("a", { class: "letter-btn" + (learned(l) ? " learned" : ""), href: `#/alphabet/letter/${l.id}` },
              h("span", { class: "ar", lang: "ar" }, l.char),
              h("span", { class: "small" }, l.nameEn)))),
        h("div", { class: "row spaced" }, link(`#/alphabet/practice/group/${n}`, "Practice this group", "btn secondary")),
        readIt.length > 0 ? h("h3", { class: "home-topic" }, "Read it") : null,
        readIt.length > 0 ? h("div", { class: "dialogue-list" }, readIt.map(readItRow)) : null);
    });

    return h("div", {}, voiceBanner(), progress, ...groups);
  }

  // ---------- lesson ----------

  function lessonView(ctx, letter, setTitle) {
    setTitle(letter.nameEn);
    const forms = alphabet.formsOf(letter);
    const i = ctx.letters.indexOf(letter);
    const prev = ctx.letters[i - 1];
    const next = ctx.letters[i + 1];

    const cells = ["isolated", "initial", "medial", "final"].map((pos) =>
      h("div", { class: "form-cell" },
        h("div", { class: "ar", lang: "ar" }, forms[pos] ?? "–"),
        h("div", { class: "muted small" }, FORM_LABELS[pos])));

    return h("div", {},
      h("p", {}, link("#/alphabet", "← All letters")),
      headsUp(ctx, letter.group),
      voiceBanner(),
      h("div", { class: "card center" },
        h("div", { class: "ar big-letter", lang: "ar" }, letter.char),
        h("div", { class: "ar", lang: "ar" }, letter.name),
        h("p", { class: "text" }, `${letter.nameEn} · sounds like "${letter.sound}"`),
        h("p", { class: "small" }, letter.hint),
        speakButton(letter.name, "Hear the name")),
      h("div", { class: "card" },
        h("h2", {}, "Four forms"),
        h("div", { class: "forms" }, cells),
        letter.joins === "right"
          ? h("p", { class: "small" }, "This letter does not connect to the letter after it, so it has no start or middle form.")
          : h("p", { class: "small" }, "Letters change shape depending on where they sit in a word.")),
      h("div", { class: "card" },
        h("h2", {}, "Example"),
        h("p", { class: "ar text", lang: "ar" }, letter.example.ar),
        h("p", { class: "text" }, `${letter.example.tr} · ${letter.example.en}`),
        speakButton(letter.example.ar, "Hear the word")),
      h("div", { class: "actions-bar" }, link(`#/alphabet/practice/letter/${letter.id}`, "Practice this letter", "btn")),
      h("div", { class: "row spread" },
        prev ? link(`#/alphabet/letter/${prev.id}`, `← ${prev.nameEn}`) : h("span"),
        next ? link(`#/alphabet/letter/${next.id}`, `${next.nameEn} →`) : h("span")));
  }

  // ---------- practice ----------

  async function practiceView(ctx, scope, setTitle) {
    setTitle("Practice");
    const { letters } = ctx;
    const scopeLetters =
      scope.type === "group" ? letters.filter((l) => l.group === scope.group)
      : scope.type === "letter" ? [scope.letter]
      : letters;
    const scopeIds = new Set(scopeLetters.map((l) => l.id));
    const headsUpGroup = scope.type === "group" ? scope.group : scope.type === "letter" ? scope.letter.group : null;

    const content = h("div", { class: "practice-body" });
    const left = h("span", { class: "muted small" });
    const root = h("div", { class: "practice" },
      h("div", { class: "practice-head" }, link("#/alphabet", "← Back to letters"), left),
      headsUpGroup ? headsUp(ctx, headsUpGroup) : null,
      voiceBanner(),
      content);

    let queue = [];
    let latest = new Map();
    let seen = new Set();
    let stats = { answered: 0, right: 0 };

    async function freshCards() {
      return (await store.getAllCards()).filter((c) => c.deck === alphabet.DECK);
    }

    async function startRound() {
      let cards = await freshCards();
      // Make sure there is always something to practice: seed the scope, or for "all",
      // the currently suggested group. Existing progress is never overwritten.
      const seedLetters = scope.type === "all"
        ? letters.filter((l) => l.group === alphabet.suggestedGroup(cards, letters))
        : scopeLetters;
      await store.addCardsIfMissing(seedLetters.flatMap((l) => alphabet.cardsForLetter(l, now())));
      cards = await freshCards();

      const pool = cards.filter((c) => scopeIds.has(c.extra?.letterId));
      seen = new Set(cards.map((c) => c.extra?.letterId));
      latest = new Map(cards.map((c) => [c.id, c]));
      queue = srs.practiceOrder(pool, now(), { limit: ROUND_SIZE }).map((c) => c.id);
      stats = { answered: 0, right: 0 };

      if (queue.length === 0) {
        left.textContent = "";
        content.replaceChildren(
          h("div", { class: "card" }, h("p", { class: "text" }, "There is nothing to practice here yet."),
            h("div", { class: "row spaced" }, link("#/alphabet", "Back to letters", "btn"))));
        return;
      }
      showQuestion();
    }

    function showQuestion() {
      try {
        const cardId = queue.shift();
        const card = latest.get(cardId);
        const letter = letters.find((l) => l.id === card.extra.letterId);
        // Wrong options come from letters the learner has already met, when there are enough.
        const met = letters.filter((l) => seen.has(l.id));
        const q = alphabet.buildQuestion({
          letter,
          kind: card.extra.kind,
          position: card.extra.position ?? null,
          letters: met.length >= 4 ? met : letters,
          rng,
          choiceCount: 4,
        });

        let answered = false;
        const feedback = h("div", { class: "feedback", role: "status" });
        const actions = h("div", { class: "actions-bar" }); // pinned above the tab bar

        const buttons = q.choices.map((choice) =>
          h("button", { type: "button", class: "choice", dir: "auto", onclick: () => answer(choice) }, choice.text));

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

          const chosen = correct ? null : letters.find((l) => l.id === choice.id);
          feedback.replaceChildren(
            h("p", { class: "verdict" }, correct ? "Yes!" : "Not quite."),
            ...alphabet.mistakeNote({ letter, chosen }).map((line) => h("p", { class: "text small" }, line)));
          speech.speak(letter.name).catch(() => {}); // the banner already explains missing voices

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
            h("div", { class: "ar prompt", lang: "ar" }, q.prompt)),
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
        next = alphabet.suggestedGroup(await freshCards(), letters);
      } catch {
        // the suggestion is optional
      }
      content.replaceChildren(
        h("div", { class: "card center" },
          h("h2", {}, "Round complete"),
          h("p", { class: "text" }, `${stats.right} of ${stats.answered} answers were right.`),
          next ? h("p", { class: "small" }, `Suggested next group: ${next}`) : null),
        h("div", { class: "actions-bar" },
          button("Keep going", () => startRound().catch((err) => showError(content, err)), "btn"),
          link("#/alphabet", "Back to letters", "btn secondary")));
    }

    await startRound();
    return root;
  }

  // ---------- routing ----------

  return async function render({ parts = ["alphabet"], setTitle = () => {} } = {}) {
    const [, view, a, b] = parts;
    const ctx = await load();

    if (view === "letter") {
      const letter = ctx.letters.find((l) => l.id === a);
      if (letter) return lessonView(ctx, letter, setTitle);
    } else if (view === "practice") {
      if (a === "group") {
        const group = Number(b);
        if (Number.isInteger(group) && ctx.letters.some((l) => l.group === group)) {
          return practiceView(ctx, { type: "group", group }, setTitle);
        }
      } else if (a === "letter") {
        const letter = ctx.letters.find((l) => l.id === b);
        if (letter) return practiceView(ctx, { type: "letter", letter }, setTitle);
      } else {
        return practiceView(ctx, { type: "all" }, setTitle);
      }
    }
    return gridView(ctx, setTitle);
  };
}
