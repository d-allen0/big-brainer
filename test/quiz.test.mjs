// Quiz logic tests: speed grading, typed-answer checking, question building, card picking.
// Pure logic; no DOM. Never paste invisible characters here; use String.fromCharCode.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WWW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../www");
const read = (f) => fs.readFileSync(path.join(WWW, f), "utf8");
const Q = await import(path.join(WWW, "quiz.js"));
const srs = await import(path.join(WWW, "srs.js"));
const A = await import(path.join(WWW, "alphabet.js"));
const V = await import(path.join(WWW, "vocab.js"));

const letters = A.parseLetters(JSON.parse(read("letters.json")));
const words = V.parseVocab(JSON.parse(read("vocab.json")));
const wordById = Object.fromEntries(words.map((w) => [w.id, w]));
const T0 = 1_700_000_000_000;
const G = srs.GRADES;

const seenCard = (card) => ({ ...card, lastReviewed: T0 - 1000, reps: 1 });
const letterCard = (id, kind = "name") => A.cardsForLetter(letters.find((l) => l.id === id), T0).find((c) => c.extra.kind === kind);
const wordCard = (id, kind = "ar2en") => V.cardsForWord(wordById[id], T0).find((c) => c.extra.kind === kind);
const countTypes = (make, n = 400) => {
  const counts = { choice: 0, listen: 0, type: 0 };
  for (let s = 0; s < n; s++) counts[make(A.seededRng(s)).type]++;
  return counts;
};

describe("quiz: silent answer-speed grading", () => {
  it("wrong is always 'again', whatever the speed", () => {
    for (const type of Q.TYPES) for (const ms of [0, 500, 5000, 40000, null]) {
      assert.equal(Q.speedGrade({ correct: false, ms, type }), G.again);
    }
  });

  it("right and quick is easy, normal is good, slow is hard (per type)", () => {
    for (const type of Q.TYPES) {
      const { fast, slow } = Q.SPEED[type];
      assert.equal(Q.speedGrade({ correct: true, ms: 0, type }), G.easy);
      assert.equal(Q.speedGrade({ correct: true, ms: fast, type }), G.easy);
      assert.equal(Q.speedGrade({ correct: true, ms: fast + 1, type }), G.good);
      assert.equal(Q.speedGrade({ correct: true, ms: slow - 1, type }), G.good);
      assert.equal(Q.speedGrade({ correct: true, ms: slow, type }), G.hard);
    }
  });

  it("first views, unknown times and long pauses are never judged on speed", () => {
    assert.equal(Q.speedGrade({ correct: true, ms: 100, type: "choice", firstView: true }), G.good);
    assert.equal(Q.speedGrade({ correct: true, ms: 40000, type: "choice", firstView: true }), G.good);
    for (const ms of [null, undefined, NaN, -5, Infinity, Q.INTERRUPTED_MS + 1, 10 * 60_000]) {
      assert.equal(Q.speedGrade({ correct: true, ms, type: "type" }), G.good, String(ms));
    }
    assert.equal(Q.speedGrade({ correct: true, ms: Q.INTERRUPTED_MS, type: "type" }), G.hard, "a long but plausible answer is still slow");
  });

  it("a slow right answer never counts as a lapse", () => {
    const card = srs.newCard({ id: "x", deck: "d", front: "x", back: "x" }, T0);
    const after = srs.review(card, Q.speedGrade({ correct: true, ms: 30000, type: "choice" }), T0);
    assert.equal(after.lapses, 0);
    assert.equal(after.reps, 1);
  });

  it("rejects an unknown type", () => {
    assert.throws(() => Q.speedGrade({ correct: true, ms: 1, type: "speed" }), RangeError);
  });
});

describe("quiz: typed answers", () => {
  const ok = (input, id) => Q.checkTyped(input, wordById[id], words).correct;

  it("normalizes case, accents, punctuation, spacing and leading words", () => {
    assert.equal(Q.normalizeAnswer("  The   Book! "), "book");
    assert.equal(Q.normalizeAnswer("To go"), "go");
    assert.equal(Q.normalizeAnswer("Café"), "cafe");
    assert.equal(Q.normalizeAnswer(null), "");
    assert.equal(Q.normalizeAnswer("   "), "");
    assert.equal(Q.normalizeAnswer("مرحبا"), "", "typing Arabic matches nothing");
  });

  it("accepts every listed meaning, with or without the bracketed note", () => {
    assert.ok(ok("book", "kitab") && ok("BOOK", "kitab") && ok("  Book. ", "kitab"));
    assert.ok(ok("long", "tawil") && ok("tall", "tawil") && ok("long, tall", "tawil"));
    assert.ok(ok("no", "la") && ok("not", "la") && ok("no, not", "la"));
    assert.ok(ok("this", "hadha") && ok("this masculine", "hadha") && ok("this (masculine)", "hadha"));
    assert.ok(ok("thank you", "shukran") && ok("thank-you", "shukran"));
    assert.ok(ok("I", "ana") && ok("i", "ana"));
    assert.ok(ok("he went", "dhahaba") && ok("went", "dhahaba"));
    assert.ok(ok("he worked", "amila") && ok("did", "amila"));
  });

  it("every word accepts its own meaning exactly as written", () => {
    for (const w of words) assert.ok(Q.checkTyped(w.en, w, words).correct, `${w.id}: ${w.en}`);
  });

  it("rejects wrong answers, empty answers and other words' meanings", () => {
    assert.equal(ok("table", "kitab"), false);
    const empty = Q.checkTyped("   ", wordById.kitab, words);
    assert.deepEqual([empty.correct, empty.empty], [false, true]);
    const other = Q.checkTyped("water", wordById.kitab, words);
    assert.equal(other.correct, false);
    assert.equal(other.otherWord.id, "maa", "tells which word the typed meaning belongs to");
  });

  it("forgives one slip in longer answers only", () => {
    const r = Q.checkTyped("beutiful", wordById.jamil, words);
    assert.deepEqual([r.correct, r.typo], [true, true]);
    assert.ok(ok("begutiful", "jamil"), "extra letter");
    assert.ok(ok("beaitiful", "jamil"), "wrong letter");
    assert.equal(ok("hosue", "bayt"), false, "5-letter answers must be exact: one letter apart is often a different word (house/mouse)");
    assert.equal(ok("mouse", "bayt"), false);
    assert.ok(ok("mohter", "umm"), "swapped letters");
    assert.equal(ok("colt", "barid"), false);
    assert.equal(ok("hat", "harr"), false, "short answers must be exact");
    assert.equal(ok("beautifull!!", "jamil"), true);
    assert.equal(ok("beatiful x", "jamil"), false, "more than one slip");
  });

  it("typo tolerance never turns another word's exact meaning into a right answer", () => {
    // 'father' and 'mother' differ by one letter, but typing 'mother' for father is wrong.
    const r = Q.checkTyped("mother", wordById.ab, words);
    assert.equal(r.correct, false);
    assert.equal(r.otherWord.id, "umm");
    assert.equal(Q.checkTyped("father", wordById.umm, words).correct, false);
  });

  it("an exact meaning shared by two words is right for either", () => {
    assert.ok(ok("this", "hadha") && ok("this", "hadhihi"));
  });
});

describe("quiz: building questions", () => {
  const build = (card, over = {}) => (rng) => Q.buildQuizQuestion({ card, letters, words, rng, ...over });

  it("a card never seen before is always plain multiple choice", () => {
    for (const card of [letterCard("beh"), letterCard("beh", "sound"), wordCard("kitab"), wordCard("kitab", "en2ar")]) {
      const counts = countTypes(build(card, { hasVoice: true }));
      assert.deepEqual(counts, { choice: 400, listen: 0, type: 0 }, card.id);
    }
  });

  it("without a voice there are no listening questions", () => {
    for (const card of [seenCard(letterCard("beh")), seenCard(wordCard("kitab"))]) {
      assert.equal(countTypes(build(card, { hasVoice: false })).listen, 0, card.id);
    }
  });

  it("seen letter name cards can be listening questions; sound and form cards cannot", () => {
    assert.ok(countTypes(build(seenCard(letterCard("beh")), { hasVoice: true })).listen > 0);
    assert.equal(countTypes(build(seenCard(letterCard("beh", "sound")), { hasVoice: true })).listen, 0);
    assert.equal(countTypes(build(seenCard(letterCard("beh", "form")), { hasVoice: true })).listen, 0);
    assert.equal(countTypes(build(seenCard(letterCard("beh")), { hasVoice: true })).type, 0, "letters never ask for typing");
  });

  it("seen Arabic-to-meaning word cards can be choice, listen or type; meaning-to-Arabic cards only choice", () => {
    const counts = countTypes(build(seenCard(wordCard("kitab")), { hasVoice: true }), 2000);
    assert.ok(counts.choice > 0 && counts.listen > 0 && counts.type > 0, JSON.stringify(counts));
    assert.ok(counts.choice / 2000 > 0.5 && counts.choice / 2000 < 0.7, "mostly multiple choice");
    assert.equal(countTypes(build(seenCard(wordCard("kitab")), { hasVoice: false })).listen, 0);
    assert.ok(countTypes(build(seenCard(wordCard("kitab")), { hasVoice: false })).type > 0, "typing needs no voice");
    assert.deepEqual(countTypes(build(seenCard(wordCard("kitab", "en2ar")), { hasVoice: true })), { choice: 400, listen: 0, type: 0 });
  });

  it("shapes: listening letter question", () => {
    const q = Q.buildQuizQuestion({ card: seenCard(letterCard("beh")), letters, words, hasVoice: true, rng: () => 0.9 });
    // rng 0.9 of weights 6+2 lands on the listening type
    assert.equal(q.type, "listen");
    assert.equal(q.prompt, null);
    assert.equal(q.speakText, letters.find((l) => l.id === "beh").name);
    assert.equal(q.answerText, "ب");
    assert.equal(q.answerId, "beh");
    assert.ok(q.choices.every((c) => [...c.text].length === 1) && q.choicesAreArabic);
  });

  it("shapes: listening word question and typed word question", () => {
    const card = seenCard(wordCard("kitab"));
    const listen = Q.buildQuizQuestion({ card, letters, words, hasVoice: true, rng: () => 0.7 }); // 0.7*10 = 7: past choice (6), inside listen (6-8)
    assert.equal(listen.type, "listen");
    assert.equal(listen.speakText, wordById.kitab.ar);
    assert.equal(listen.prompt, null);
    assert.equal(listen.answerText, "book");
    assert.ok(listen.choices.some((c) => c.id === "kitab"));
    const typed = Q.buildQuizQuestion({ card, letters, words, hasVoice: true, rng: () => 0.95 });
    assert.equal(typed.type, "type");
    assert.equal(typed.choices, null);
    assert.equal(typed.prompt, wordById.kitab.ar);
    assert.equal(typed.promptIsArabic, true);
    assert.equal(typed.answerText, "book");
    assert.equal(typed.speakText, null);
    assert.equal(typed.speakAfter, wordById.kitab.ar);
  });

  it("every card builds a valid question: 4 distinct options with exactly one right", () => {
    const all = [...letters.flatMap((l) => A.cardsForLetter(l, T0)), ...V.cardsForSet(words, 1, T0), ...V.cardsForSet(words, 5, T0)];
    for (const base of all) {
      for (const card of [base, seenCard(base)]) {
        for (const seed of [1, 2, 3]) {
          const q = Q.buildQuizQuestion({ card, letters, words, hasVoice: true, rng: A.seededRng(seed) });
          assert.ok(Q.TYPES.includes(q.type));
          assert.equal(q.cardId, card.id);
          assert.ok(q.instruction && q.speakAfter);
          if (q.type === "type") {
            assert.equal(q.choices, null);
          } else {
            assert.equal(q.choices.length, 4);
            assert.equal(new Set(q.choices.map((c) => c.text)).size, 4);
            assert.equal(q.choices.filter((c) => c.id === q.answerId).length, 1);
          }
          if (q.type === "listen") assert.ok(q.speakText && q.prompt === null);
          else assert.equal(q.speakText, null);
        }
      }
    }
  });

  it("uses the supplied pool of letters for wrong answers", () => {
    const pool = letters.slice(0, 6);
    for (let s = 0; s < 30; s++) {
      const q = Q.buildQuizQuestion({ card: letterCard("beh"), letters, words, rng: A.seededRng(s), letterPool: pool });
      assert.ok(q.choices.every((c) => pool.some((l) => l.id === c.id)));
    }
  });

  it("validates input", () => {
    assert.throws(() => Q.buildQuizQuestion({ card: null, letters, words }), TypeError);
    assert.throws(() => Q.buildQuizQuestion({ card: { id: "x", deck: "other", extra: {} }, letters, words }), RangeError);
    assert.throws(() => Q.buildQuizQuestion({ card: { id: "x", deck: "vocab", extra: { kind: "ar2en", wordId: "nope" } }, letters, words }), RangeError);
    assert.throws(() => Q.buildQuizQuestion({ card: { id: "x", deck: "alphabet", extra: { kind: "name", letterId: "nope" } }, letters, words }), RangeError);
  });

  it("instructions use calm wording and none of the forbidden pacing words", () => {
    const forbidden = /\b(due|overdue|locked|unlock|unlocked|streak|daily|expires|deadline|behind|penalty|tomorrow|later|wait|missed|timer|seconds|quick|fast|slow|hurry)\b/i;
    for (const [k, text] of Object.entries(Q.INSTRUCTIONS)) assert.ok(!forbidden.test(text), `${k}: ${text}`);
  });
});

describe("quiz: feedback", () => {
  it("explains a wrong letter and a wrong word, and a typed meaning of another word", () => {
    const lq = Q.buildQuizQuestion({ card: letterCard("beh"), letters, words, rng: A.seededRng(1) });
    const lines = Q.explain({ question: lq, letters, words, chosenId: "teh" });
    assert.equal(lines.length, 2);
    assert.ok(lines[1].startsWith("Not ت"));
    assert.equal(Q.explain({ question: lq, letters, words }).length, 1);

    const wq = Q.buildQuizQuestion({ card: wordCard("ab"), letters, words, rng: A.seededRng(1) });
    const wl = Q.explain({ question: wq, letters, words, chosenId: "umm" });
    assert.equal(wl.length, 2);
    assert.ok(wl[1].includes("mother"));
    assert.equal(Q.explain({ question: wq, letters, words, chosenId: "nope-not-a-word" }).length, 1);
    assert.throws(() => Q.explain({ question: null, letters, words }), TypeError);
    const all = [...lines, ...wl].join(" ");
    assert.ok(!/wrong|incorrect|fail/i.test(all));
  });
});

describe("quiz: choosing the cards", () => {
  it("seeds the suggested group and set so a quiz is never empty", () => {
    const seeds = Q.seedForQuiz({ cards: [], letters, words, now: T0 });
    assert.equal(seeds.length, 18 + 20);
    assert.equal(new Set(seeds.map((c) => c.id)).size, 38);
    assert.ok(seeds.some((c) => c.deck === "alphabet") && seeds.some((c) => c.deck === "vocab"));
  });

  it("moves on with the learner's progress", () => {
    const learned = A.cardsForGroup(letters, 1, T0).map((c) => ({ ...c, reps: 3 }));
    const seeds = Q.seedForQuiz({ cards: learned, letters, words, now: T0 });
    assert.ok(seeds.some((c) => c.extra.group === 2));
    assert.ok(!seeds.some((c) => c.extra.group === 1));
  });

  const pool = [...A.cardsForGroup(letters, 1, T0), ...V.cardsForSet(words, 1, T0)];

  it("interleaves letters and words, and fills the round", () => {
    const picked = Q.pickQuizCards({ cards: pool, now: T0 });
    assert.equal(picked.length, Q.QUIZ_SIZE);
    assert.equal(new Set(picked.map((c) => c.id)).size, Q.QUIZ_SIZE);
    assert.equal(picked.filter((c) => c.deck === "alphabet").length, 5);
    assert.equal(picked.filter((c) => c.deck === "vocab").length, 5);
    assert.deepEqual(picked.slice(0, 4).map((c) => c.deck), ["alphabet", "vocab", "alphabet", "vocab"]);
  });

  it("with only one kind of card, that kind fills the whole round", () => {
    const onlyWords = Q.pickQuizCards({ cards: V.cardsForSet(words, 1, T0), now: T0 });
    assert.equal(onlyWords.length, 10);
    assert.ok(onlyWords.every((c) => c.deck === "vocab"));
    const onlyLetters = Q.pickQuizCards({ cards: A.cardsForGroup(letters, 1, T0), now: T0 });
    assert.equal(onlyLetters.length, 10);
    assert.ok(onlyLetters.every((c) => c.deck === "alphabet"));
  });

  it("a small pool returns everything; nothing is hidden by the clock", () => {
    assert.equal(Q.pickQuizCards({ cards: pool.slice(0, 3), now: T0 }).length, 3);
    assert.deepEqual(Q.pickQuizCards({ cards: [], now: T0 }), []);
    const future = pool.map((c) => ({ ...c, due: T0 + 30 * srs.DAY_MS }));
    assert.equal(Q.pickQuizCards({ cards: future, now: T0 }).length, 10, "cards scheduled far ahead are still served");
  });

  it("serves the weakest first within each kind, and does not change its input", () => {
    const weak = { ...pool.find((c) => c.deck === "vocab"), due: T0 + 9 * srs.DAY_MS, ease: 1.4, lapses: 3 };
    const rest = pool.filter((c) => c.id !== weak.id).map((c) => ({ ...c, due: T0 + 5 * srs.DAY_MS, ease: 2.6, reps: 4 }));
    const input = [weak, ...rest];
    const before = input.map((c) => c.id);
    const picked = Q.pickQuizCards({ cards: input, now: T0 });
    assert.equal(picked[1].id, weak.id, "the weakest word comes first among the words");
    assert.deepEqual(input.map((c) => c.id), before);
  });

  it("supports other sizes and rejects bad ones", () => {
    assert.equal(Q.pickQuizCards({ cards: pool, now: T0, size: 4 }).length, 4);
    assert.deepEqual(Q.pickQuizCards({ cards: pool, now: T0, size: 0 }), []);
    for (const bad of [-1, 2.5, "3", NaN]) assert.throws(() => Q.pickQuizCards({ cards: pool, now: T0, size: bad }), RangeError);
  });
});

describe("quiz: stays pure", () => {
  it("has no DOM, storage, clock or timer in it", () => {
    const code = read("quiz.js").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/\b(document|window|localStorage|indexedDB|setTimeout|setInterval|requestAnimationFrame)\b|Date\.now|new Date/.test(code));
    assert.ok(!/import .* from "\.\/(db|tts)\.js"/.test(code));
  });
});
