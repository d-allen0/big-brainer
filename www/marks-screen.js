// Read-it screens: a lesson page and its practice. UI only. Logic lives in marks.js.
//
// PACING RULES (CLAUDE.md section 1):
//  - Every lesson is open at all times; progress only produces suggestions and one gentle heads-up.
//  - Practice is always available and never empty. Nothing is locked, limited or timed.
//  - Nothing is spoken before an answer. The listen question has a speaker button the learner presses.
//  - A wrong answer costs nothing: it shows the right answer, a short note, speaks it, and the
//    card comes back a few questions later in the same round.
//  - Nothing advances on a timer.
//
// Routes: #/readit/<lesson id> (the lesson) and #/readit/<lesson id>/practice.
// An unknown lesson id goes to the Letters grid.

import * as alphabet from "./alphabet.js";
import * as marks from "./marks.js";
import * as srs from "./srs.js";
import * as db from "./db.js";
import * as tts from "./tts.js";

const ROUND_SIZE = 10;
const REQUEUE_GAP = 3;
const HEADS_UP_KEY = "marks.headsUpDismissed";
const QUESTION_TEXT = {
  read: "How is this read?",
  hear: "Which one did you hear?",
};

/**
 * Build the screen. `h` is the app's DOM helper. Everything else is injectable for tests.
 * Returns render({ parts, setTitle }) -> Promise<Node>, where `parts` is the hash path,
 * e.g. ["readit", "sukun"] or ["readit", "sukun", "practice"].
 */
export function createMarksScreen({
  h,
  loadLetters = alphabet.loadLetters,
  loadLessons = (letters) => marks.loadMarks(letters),
  store = db,
  speech = tts,
  now = () => Date.now(),
  rng = Math.random,
  goTo = (hash) => { globalThis.location.hash = hash; },
}) {
  // ---------- small building blocks ----------

  const link = (href, text, cls = "") => h("a", { href, class: cls }, text);
  const button = (text, onClick, cls = "btn") => h("button", { type: "button", class: cls, onclick: onClick }, text);

  function showError(container, err) {
    container.replaceChildren(h("p", { class: "error" }, "Something went wrong: " + (err?.message ?? err)));
  }

  /** The note shown when Arabic speech is unavailable (same wording and button as the other screens). */
  function voiceNote(result) {
    if (result.ok) return null;
    const kids = [h("p", { class: "text" }, result.message ?? "Arabic speech is not available on this device.")];
    if (result.code === "no-arabic-voice") {
      kids.push(button("Open voice settings", () => speech.openVoiceInstall(), "btn secondary"));
    }
    return h("div", { class: "note", role: "status" }, ...kids);
  }

  /** Fills in without blocking the page. */
  function voiceBanner() {
    const box = h("div");
    speech.checkArabic().then((result) => {
      const note = voiceNote(result);
      if (note) box.append(note);
    }).catch(() => {});
    return box;
  }

  /** Small speaker button. Speaks only when pressed; a failure becomes a plain message. */
  function speakBtn(text, label, onError, extraClass = "") {
    return h("button", {
      type: "button",
      class: "speak-btn" + extraClass,
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

  /** One gentle, dismissible note when a lesson is far past the suggested group. Never blocks. */
  function headsUp(ctx, lesson) {
    if (!alphabet.farAhead(lesson.afterGroup, ctx.suggestedGroup) || ctx.dismissed.includes(lesson.id)) return null;
    const box = h("div", { class: "note" },
      h("p", { class: "text" }, "This is a few steps past your suggested next group, so it may feel hard right now. Go at your own pace."),
      button("Got it", async () => {
        box.remove();
        ctx.dismissed.push(lesson.id);
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
    const lessons = await loadLessons(letters);
    const all = await store.getAllCards();
    const dismissed = await store.getMeta(HEADS_UP_KEY, []);
    return {
      letters,
      lessons,
      dismissed: Array.isArray(dismissed) ? dismissed : [],
      suggestedGroup: alphabet.suggestedGroup(all.filter((c) => c.deck === alphabet.DECK), letters),
    };
  }

  // ---------- lesson ----------

  function lessonView(ctx, lesson, setTitle) {
    setTitle(lesson.title);
    const { lessons } = ctx;
    const i = lessons.indexOf(lesson);
    const prev = lessons[i - 1];
    const next = lessons[i + 1];

    const msg = h("p", { class: "muted small", role: "status" });
    const setMsg = (text) => { msg.textContent = text; };

    const rows = lesson.items.map((item) =>
      h("div", { class: "bubble-row" },
        h("div", { class: "bubble" },
          h("span", { class: "ar bubble-ar", lang: "ar" }, item.ar),
          h("span", { class: "bubble-tr" }, item.en ? `${item.tr} · ${item.en}` : item.tr)),
        speakBtn(item.ar, `Hear ${item.tr}`, setMsg)));

    return h("div", {},
      h("p", {}, link("#/alphabet", "← All letters")),
      headsUp(ctx, lesson),
      voiceBanner(),
      h("div", { class: "card" },
        ...lesson.intro.map((line) => h("p", { class: "text" }, line)),
        lesson.marks.length > 0
          ? h("div", { class: "row spaced" },
            lesson.marks.map((name) =>
              h("span", { class: "tag" },
                h("span", { class: "ar", lang: "ar" }, marks.markGlyph(name)),
                ` ${marks.MARKS[name].label} · ${marks.MARKS[name].sound}`)))
          : null),
      h("div", { class: "card" },
        h("h2", {}, "Try reading these"),
        h("div", { class: "bubbles" }, rows),
        msg),
      h("div", { class: "actions-bar" }, link(`#/readit/${lesson.id}/practice`, "Practice this lesson", "btn")),
      h("div", { class: "row spread" },
        prev ? link(`#/readit/${prev.id}`, `← ${prev.title}`) : h("span"),
        next ? link(`#/readit/${next.id}`, `${next.title} →`) : h("span")));
  }

  // ---------- practice ----------

  async function practiceView(ctx, lesson, setTitle) {
    setTitle("Practice");
    const { lessons } = ctx;
    const voice = await speech.checkArabic().catch(() => ({ ok: false }));
    // Listening questions need a working Arabic voice; without one, every question is a reading question.
    const kinds = voice.ok ? marks.KINDS : ["read"];
    const itemIds = new Set(lesson.items.map((it) => it.id));

    const content = h("div", { class: "practice-body" });
    const left = h("span", { class: "muted small" });
    const root = h("div", { class: "practice" },
      h("div", { class: "practice-head" }, link(`#/readit/${lesson.id}`, "← Back to lesson"), left),
      headsUp(ctx, lesson),
      voiceNote(voice),
      content);

    let queue = [];
    let latest = new Map();
    let stats = { answered: 0, right: 0 };

    async function freshCards() {
      return (await store.getAllCards()).filter((c) => c.deck === marks.DECK);
    }

    async function startRound() {
      // Make sure there is always something to practice. Existing progress is never overwritten.
      await store.addCardsIfMissing(marks.cardsForLesson(lesson, now()));
      const cards = await freshCards();
      latest = new Map(cards.map((c) => [c.id, c]));
      const pool = cards.filter((c) => c.extra?.lessonId === lesson.id && itemIds.has(c.extra.itemId) && kinds.includes(c.extra.kind));
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
        const item = lesson.items.find((it) => it.id === card.extra.itemId);
        const q = marks.buildQuestion({ lesson, item, kind: card.extra.kind, lessons, rng, choiceCount: 4 });

        let answered = false;
        const feedback = h("div", { class: "feedback", role: "status" });
        const speakMsg = h("p", { class: "muted small", role: "status" });
        const setMsg = (text) => { speakMsg.textContent = text; };
        const actions = h("div", { class: "actions-bar" }); // pinned above the tab bar

        const buttons = q.choices.map((choice) =>
          h("button", {
            type: "button",
            class: "choice" + (q.choicesAreArabic ? " choice-ar" : ""),
            ...(q.choicesAreArabic ? { lang: "ar" } : { dir: "auto" }),
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

          const chosen = correct ? null : marks.findItem(lessons, choice.id)?.item ?? null;
          feedback.replaceChildren(
            h("p", { class: "verdict" }, correct ? "Yes!" : "Not quite."),
            ...marks.mistakeNote({ lesson, item, chosen }).map((line) => h("p", { class: "text small" }, line)));
          speech.speak(item.ar).catch(() => {}); // the banner already explains missing voices

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

        const promptNode = q.kind === "hear"
          ? h("div", { class: "prompt-row" }, speakBtn(q.speak, "Hear it", setMsg, " speak-big"))
          : h("div", { class: "ar prompt", lang: "ar" }, q.prompt);

        left.textContent = `${queue.length + 1} left in this round`;
        content.replaceChildren(
          h("div", { class: "card center" }, h("p", { class: "text" }, QUESTION_TEXT[q.kind]), promptNode),
          h("div", { class: "choices" }, buttons),
          feedback,
          q.kind === "hear" ? speakMsg : null,
          actions);
      } catch (err) {
        showError(content, err);
      }
    }

    async function showSummary() {
      left.textContent = "";
      let suggested = null;
      try {
        const id = marks.suggestedLesson(await freshCards(), lessons);
        suggested = marks.findLesson(lessons, id);
      } catch {
        // the suggestion is optional
      }
      content.replaceChildren(
        h("div", { class: "card center" },
          h("h2", {}, "Round complete"),
          h("p", { class: "text" }, `${stats.right} of ${stats.answered} answers were right.`),
          suggested ? h("p", { class: "small" }, `Suggested next lesson: ${suggested.title}`) : null),
        h("div", { class: "actions-bar" },
          button("Keep going", () => startRound().catch((err) => showError(content, err)), "btn"),
          link(`#/readit/${lesson.id}`, "Back to lesson", "btn secondary")));
    }

    await startRound();
    return root;
  }

  // ---------- routing ----------

  return async function render({ parts = ["readit"], setTitle = () => {} } = {}) {
    const [, lessonId, view] = parts;
    const ctx = await load();
    const lesson = marks.findLesson(ctx.lessons, lessonId);
    if (!lesson) {
      goTo("#/alphabet"); // an unknown or missing lesson falls back to the Letters grid
      return h("div");
    }
    return view === "practice" ? practiceView(ctx, lesson, setTitle) : lessonView(ctx, lesson, setTitle);
  };
}
