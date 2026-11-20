// Vocabulary module: word data validation, spaced-repetition cards, a suggested path
// through sets of words, and multiple-choice question building.
// Pure logic: no DOM, no storage.
//
// PACING RULE (see CLAUDE.md section 1): progress here only ever produces SUGGESTIONS
// ("up next", a gentle heads-up). Nothing in this file may block access to any set or word.

import { newCard } from "./srs.js";
import { farAhead } from "./alphabet.js";

export { farAhead };
export const DECK = "vocab";
export const KINDS = Object.freeze(["ar2en", "en2ar"]);
export const SET_SIZE = 10;

// ---- loading and validation ----

/** Validate raw vocab.json content and return the words array. Throws TypeError on bad data. */
export function parseVocab(raw) {
  if (!raw || !Array.isArray(raw.words) || raw.words.length === 0) {
    throw new TypeError("vocab.json: expected a non-empty `words` array");
  }
  const ids = new Set();
  const ar = new Set();
  const en = new Set();
  for (const [i, w] of raw.words.entries()) {
    const at = `words[${i}]`;
    for (const key of ["id", "ar", "tr", "en", "pos"]) {
      if (typeof w[key] !== "string" || w[key] === "") throw new TypeError(`${at}.${key} must be a non-empty string`);
    }
    if (!/^[a-z0-9_]+$/.test(w.id)) throw new TypeError(`${at}.id must be lowercase letters, digits or _`);
    // Unique ids, Arabic and meanings: no two answer choices may look identical.
    for (const [set, key] of [[ids, "id"], [ar, "ar"], [en, "en"]]) {
      if (set.has(w[key])) throw new TypeError(`${at}.${key} is a duplicate: ${w[key]}`);
      set.add(w[key]);
    }
  }
  return raw.words;
}

export async function loadVocab(url = new URL("vocab.json", import.meta.url), fetchFn = globalThis.fetch) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Could not load vocabulary (${res.status})`);
  return parseVocab(await res.json());
}

// ---- sets (consecutive words in teaching order; all open) ----

export const setCount = (words) => Math.ceil(words.length / SET_SIZE);

/** Words in one set (1-based). */
export function wordsOfSet(words, set) {
  if (!Number.isInteger(set) || set < 1) return [];
  return words.slice((set - 1) * SET_SIZE, set * SET_SIZE);
}

export const setOf = (words, word) => Math.floor(words.findIndex((w) => w.id === word.id) / SET_SIZE) + 1;

// ---- cards ----

export function cardsForWord(word, now, kinds = KINDS, set = 1) {
  for (const k of kinds) if (!KINDS.includes(k)) throw new RangeError(`unknown card kind: ${k}`);
  return kinds.map((kind) =>
    newCard({
      id: `${DECK}:${word.id}:${kind}`,
      deck: DECK,
      front: kind === "ar2en" ? word.ar : word.en,
      back: kind === "ar2en" ? word.en : word.ar,
      extra: { kind, wordId: word.id, set },
    }, now));
}

export function cardsForSet(words, set, now, kinds = KINDS) {
  return wordsOfSet(words, set).flatMap((w) => cardsForWord(w, now, kinds, set));
}

// ---- suggested path (information only; never a gate) ----

/** [{ set, total, learned, ratio }] per set. A card is learned after `minReps` correct answers in a row. */
export function setMastery(storedCards, words, { minReps = 2, kinds = KINDS } = {}) {
  const byId = new Map(storedCards.map((c) => [c.id, c]));
  return Array.from({ length: setCount(words) }, (_, i) => {
    const set = i + 1;
    const expected = cardsForSet(words, set, 0, kinds);
    const learned = expected.filter((c) => (byId.get(c.id)?.reps ?? 0) >= minReps).length;
    return { set, total: expected.length, learned, ratio: expected.length === 0 ? 0 : learned / expected.length };
  });
}

/** First set not yet learned to `threshold`; the last set once all are. Only a suggestion. */
export function suggestedSet(storedCards, words, { threshold = 0.8, minReps = 2, kinds = KINDS } = {}) {
  if (!(threshold > 0 && threshold <= 1)) throw new RangeError("threshold must be in (0, 1]");
  const mastery = setMastery(storedCards, words, { minReps, kinds });
  const next = mastery.find((m) => m.ratio < threshold);
  return next ? next.set : mastery.length;
}

// ---- feedback ----

/** Calm, short lines after an answer. Returns an array of lines. */
export function mistakeNote({ word, chosen = null }) {
  if (!word || !word.id) throw new TypeError("mistakeNote requires a word");
  const lines = [`${word.ar} (${word.tr}) means "${word.en}".`];
  if (chosen && chosen.id !== word.id) lines.push(`Not ${chosen.ar} (${chosen.tr}): it means "${chosen.en}".`);
  return lines;
}

// ---- questions ----

function shuffle(items, rng) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const answerText = { ar2en: (w) => w.en, en2ar: (w) => w.ar };

/**
 * One multiple-choice question.
 *   ar2en : show the Arabic word, choose its meaning
 *   en2ar : show the meaning, choose the Arabic word
 * Wrong choices come from the same set and part of speech first, then the same set,
 * then any other word, so the choices are plausible.
 */
export function buildQuestion({ word, kind, words, rng = Math.random, choiceCount = 4 }) {
  if (!KINDS.includes(kind)) throw new RangeError(`unknown question kind: ${kind}`);
  if (!Number.isInteger(choiceCount) || choiceCount < 2) throw new RangeError("choiceCount must be an integer >= 2");
  if (!words.some((w) => w.id === word.id)) throw new RangeError("word is not in the word list");
  if (words.length < 2) throw new RangeError("need at least 2 words to build a question");

  const text = answerText[kind];
  const set = setOf(words, word);
  const others = words.filter((w) => w.id !== word.id);
  const sameSet = (w) => setOf(words, w) === set;
  const tiers = [
    others.filter((w) => sameSet(w) && w.pos === word.pos),
    others.filter((w) => sameSet(w) && w.pos !== word.pos),
    others.filter((w) => !sameSet(w) && w.pos === word.pos),
    others.filter((w) => !sameSet(w) && w.pos !== word.pos),
  ];

  const taken = new Set([text(word)]);
  const distractors = [];
  for (const tier of tiers) {
    for (const w of shuffle(tier, rng)) {
      if (distractors.length >= choiceCount - 1) break;
      if (taken.has(text(w))) continue;
      taken.add(text(w));
      distractors.push(w);
    }
  }

  const choices = shuffle([word, ...distractors], rng).map((w) => ({ id: w.id, text: text(w) }));
  return {
    kind,
    wordId: word.id,
    prompt: kind === "ar2en" ? word.ar : word.en,
    promptIsArabic: kind === "ar2en",
    choicesAreArabic: kind === "en2ar",
    choices,
    answerId: word.id,
  };
}
