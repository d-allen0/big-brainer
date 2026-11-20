// Quiz module: mixed letter and word quizzes with three question types (choose, listen and
// pick, type the answer), typed-answer checking and silent answer-speed grading.
// Pure logic: no DOM, no storage, no clock (callers pass `now` and measured milliseconds).
//
// PACING RULES (CLAUDE.md section 1):
//  - Answer speed is used ONLY to pick a grade for scheduling. It is never shown, never
//    limited, and never blocks anything. Nothing here has a timer.
//  - A quiz is never empty: it seeds the suggested group and set like practice does.
//  - Mistakes cost nothing: the caller shows the right answer and the item returns later.

import * as srs from "./srs.js";
import * as alphabet from "./alphabet.js";
import * as vocab from "./vocab.js";

export const QUIZ_SIZE = 10;
export const TYPES = Object.freeze(["choice", "listen", "type"]);

// How likely each type is when several are allowed.
const WEIGHTS = { choice: 6, listen: 2, type: 2 };

// ---- silent answer-speed grading ----

/** Milliseconds: at or under `fast` earns "easy", at or over `slow` earns "hard". */
export const SPEED = Object.freeze({
  choice: Object.freeze({ fast: 3000, slow: 12000 }),
  listen: Object.freeze({ fast: 4000, slow: 14000 }),
  type: Object.freeze({ fast: 8000, slow: 25000 }),
});
/** A pause longer than this (a phone call, a break) says nothing about the card, so it grades "good". */
export const INTERRUPTED_MS = 60_000;

/**
 * Pick the scheduling grade for an answer.
 * A wrong answer is "again". A right answer is "good" unless it was clearly quick ("easy")
 * or clearly slow ("hard"). The very first time a card is seen, and any unknown or
 * interrupted time, always grades "good".
 */
export function speedGrade({ correct, ms = null, type, firstView = false }) {
  if (!TYPES.includes(type)) throw new RangeError(`unknown question type: ${type}`);
  if (!correct) return srs.GRADES.again;
  if (firstView || !Number.isFinite(ms) || ms < 0 || ms > INTERRUPTED_MS) return srs.GRADES.good;
  const { fast, slow } = SPEED[type];
  if (ms <= fast) return srs.GRADES.easy;
  if (ms >= slow) return srs.GRADES.hard;
  return srs.GRADES.good;
}

// ---- typed answers ----

/** Lowercase, no accents or punctuation, single spaces, no leading "to/the/a/an". */
export function normalizeAnswer(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(to|the|an|a) (?=\S)/, "");
}

/** Every normalized form that counts as right for a word's meaning ("long, tall" accepts both). */
export function acceptedAnswers(word) {
  const out = new Set();
  const add = (s) => {
    const n = normalizeAnswer(s);
    if (n) out.add(n);
  };
  add(word.en);
  for (const part of word.en.split(",")) {
    add(part);
    add(part.replace(/\([^)]*\)/g, ""));
    const n = normalizeAnswer(part.replace(/\([^)]*\)/g, ""));
    if (/^he \S/.test(n)) add(n.slice(3)); // "he went" also accepts "went"
  }
  return out;
}

function withinOneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // one letter different
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // two swapped
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  return shorter.slice(i) === longer.slice(i + 1); // one letter missing
}

/**
 * Check a typed meaning for `word`. Returns { correct, typo, empty, otherWord }.
 * A longer answer (6+ letters) with one slip still counts (typo: true). An answer that is
 * exactly another word's meaning is never accepted by typo tolerance, and `otherWord` names it
 * so the feedback can say what was typed.
 */
export function checkTyped(input, word, allWords = []) {
  const typed = normalizeAnswer(input);
  if (!typed) return { correct: false, typo: false, empty: true, otherWord: null };
  const accepted = acceptedAnswers(word);
  if (accepted.has(typed)) return { correct: true, typo: false, empty: false, otherWord: null };

  const other = allWords.find((w) => w.id !== word.id && acceptedAnswers(w).has(typed)) ?? null;
  if (other) return { correct: false, typo: false, empty: false, otherWord: other };

  const typo = [...accepted].some((a) => a.length >= 6 && withinOneEdit(typed, a));
  return { correct: typo, typo, empty: false, otherWord: null };
}

// ---- choosing what to ask ----

/** Cards to add so a quiz is never empty: the suggested letter group and word set. Never overwrites progress. */
export function seedForQuiz({ cards, letters, words, now }) {
  const alpha = cards.filter((c) => c.deck === alphabet.DECK);
  const vocabCards = cards.filter((c) => c.deck === vocab.DECK);
  return [
    ...alphabet.cardsForGroup(letters, alphabet.suggestedGroup(alpha, letters), now),
    ...vocab.cardsForSet(words, vocab.suggestedSet(vocabCards, words), now),
  ];
}

/**
 * The cards for one quiz: letters and words interleaved, each deck weakest-first
 * (see srs.practiceOrder). If one deck has too few, the other fills the round.
 */
export function pickQuizCards({ cards, now, size = QUIZ_SIZE }) {
  if (!Number.isInteger(size) || size < 0) throw new RangeError("size must be a non-negative integer");
  const lists = [alphabet.DECK, vocab.DECK].map((deck) => srs.practiceOrder(cards, now, { deck, limit: size }));
  const out = [];
  for (let i = 0; out.length < size && (i < lists[0].length || i < lists[1].length); i++) {
    for (const list of lists) if (list[i] && out.length < size) out.push(list[i]);
  }
  return out;
}

const INSTRUCTION = {
  name: "What is this letter called?",
  sound: "What sound does this letter make?",
  form: "Which letter is this? It is shown joined to its neighbors.",
  ar2en: "What does this word mean?",
  en2ar: "Which Arabic word means this?",
  listenLetter: "Press the speaker button, then choose the letter you hear.",
  listenWord: "Press the speaker button, then choose what the word means.",
  type: "Type what this word means.",
};
export const INSTRUCTIONS = Object.freeze({ ...INSTRUCTION });

function pickType(allowed, rng) {
  const total = allowed.reduce((s, t) => s + WEIGHTS[t], 0);
  let roll = rng() * total;
  for (const t of allowed) {
    roll -= WEIGHTS[t];
    if (roll < 0) return t;
  }
  return allowed[allowed.length - 1];
}

/**
 * Build one quiz question for a stored card.
 *  - A card never seen before is always plain multiple choice (introduce first, test later).
 *  - "listen" (hear it, then pick) is only offered when `hasVoice` is true.
 *  - "type" (type the meaning) is for words only.
 * The returned question is the same shape for every type:
 *   { type, cardId, deck, itemId, kind, instruction, prompt, promptIsArabic,
 *     choices (null for "type"), choicesAreArabic, answerId, answerText,
 *     speakText (what the speaker button says, "listen" only), speakAfter (spoken after answering) }
 */
export function buildQuizQuestion({ card, letters, words, hasVoice = false, rng = Math.random, letterPool = letters, choiceCount = 4 }) {
  if (!card || !card.extra) throw new TypeError("buildQuizQuestion requires a card");
  const seen = card.lastReviewed != null;
  const base = { cardId: card.id, deck: card.deck, kind: card.extra.kind };

  if (card.deck === alphabet.DECK) {
    const letter = letters.find((l) => l.id === card.extra.letterId);
    if (!letter) throw new RangeError(`unknown letter: ${card.extra.letterId}`);
    const allowed = ["choice"];
    if (seen && hasVoice && card.extra.kind === "name") allowed.push("listen");
    const type = pickType(allowed, rng);
    const pool = letterPool.some((l) => l.id === letter.id) && letterPool.length >= 2 ? letterPool : letters;

    if (type === "listen") {
      const q = alphabet.buildQuestion({ letter, kind: "shape", letters: pool, rng, choiceCount });
      return {
        ...base, type, itemId: letter.id, instruction: INSTRUCTION.listenLetter,
        prompt: null, promptIsArabic: false, choices: q.choices, choicesAreArabic: true,
        answerId: q.answerId, answerText: letter.char, speakText: letter.name, speakAfter: letter.name,
      };
    }
    const q = alphabet.buildQuestion({
      letter, kind: card.extra.kind, position: card.extra.position ?? null, letters: pool, rng, choiceCount,
    });
    return {
      ...base, type, itemId: letter.id, instruction: INSTRUCTION[card.extra.kind],
      prompt: q.prompt, promptIsArabic: q.promptIsArabic, choices: q.choices, choicesAreArabic: false,
      answerId: q.answerId, answerText: q.choices.find((c) => c.id === q.answerId).text,
      speakText: null, speakAfter: letter.name,
    };
  }

  if (card.deck === vocab.DECK) {
    const word = words.find((w) => w.id === card.extra.wordId);
    if (!word) throw new RangeError(`unknown word: ${card.extra.wordId}`);
    const allowed = ["choice"];
    if (seen && card.extra.kind === "ar2en") {
      if (hasVoice) allowed.push("listen");
      allowed.push("type");
    }
    const type = pickType(allowed, rng);

    if (type === "type") {
      return {
        ...base, type, itemId: word.id, instruction: INSTRUCTION.type,
        prompt: word.ar, promptIsArabic: true, choices: null, choicesAreArabic: false,
        answerId: word.id, answerText: word.en, speakText: null, speakAfter: word.ar,
      };
    }
    if (type === "listen") {
      const q = vocab.buildQuestion({ word, kind: "ar2en", words, rng, choiceCount });
      return {
        ...base, type, itemId: word.id, instruction: INSTRUCTION.listenWord,
        prompt: null, promptIsArabic: false, choices: q.choices, choicesAreArabic: false,
        answerId: q.answerId, answerText: word.en, speakText: word.ar, speakAfter: word.ar,
      };
    }
    const q = vocab.buildQuestion({ word, kind: card.extra.kind, words, rng, choiceCount });
    return {
      ...base, type, itemId: word.id, instruction: INSTRUCTION[card.extra.kind],
      prompt: q.prompt, promptIsArabic: q.promptIsArabic, choices: q.choices, choicesAreArabic: q.choicesAreArabic,
      answerId: q.answerId, answerText: q.choices.find((c) => c.id === q.answerId).text,
      speakText: null, speakAfter: word.ar,
    };
  }

  throw new RangeError(`unknown deck: ${card.deck}`);
}

/**
 * Calm feedback lines after an answer. `chosenId` is the id of the item the learner picked or
 * typed (null if they typed something that matches nothing).
 */
export function explain({ question, letters, words, chosenId = null }) {
  if (!question) throw new TypeError("explain requires a question");
  if (question.deck === alphabet.DECK) {
    const letter = letters.find((l) => l.id === question.itemId);
    const chosen = chosenId ? letters.find((l) => l.id === chosenId) ?? null : null;
    return alphabet.mistakeNote({ letter, chosen });
  }
  const word = words.find((w) => w.id === question.itemId);
  const chosen = chosenId ? words.find((w) => w.id === chosenId) ?? null : null;
  return vocab.mistakeNote({ word, chosen });
}
