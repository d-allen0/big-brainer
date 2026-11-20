// Phrases module: common phrases and short sentences as sets of 10, with spaced-repetition
// cards, a suggested path and multiple-choice questions. Same shape as vocab.js.
// Pure logic: no DOM, no storage.
//
// PACING RULE (see CLAUDE.md section 1): progress here only ever produces SUGGESTIONS
// ("up next", a gentle heads-up). Nothing in this file may block access to any set or phrase.

import { newCard } from "./srs.js";
import { farAhead } from "./alphabet.js";

export { farAhead };
export const DECK = "phrase";
export const KINDS = Object.freeze(["ar2en", "en2ar"]);
export const SET_SIZE = 10;

// ---- loading and validation ----

// Invisible and direction-control characters must never be in the data (they make text fragile).
const INVISIBLE = new RegExp("[\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff\\u00a0]");

/** Validate raw phrases.json content and return the phrases array. Throws TypeError on bad data. */
export function parsePhrases(raw) {
  if (!raw || !Array.isArray(raw.phrases) || raw.phrases.length === 0) {
    throw new TypeError("phrases.json: expected a non-empty `phrases` array");
  }
  const ids = new Set();
  const ar = new Set();
  const en = new Set();
  for (const [i, p] of raw.phrases.entries()) {
    const at = `phrases[${i}]`;
    for (const key of ["id", "ar", "tr", "en"]) {
      if (typeof p[key] !== "string" || p[key] === "") throw new TypeError(`${at}.${key} must be a non-empty string`);
      if (INVISIBLE.test(p[key])) throw new TypeError(`${at}.${key} contains an invisible character`);
    }
    if (!/^[a-z0-9_]+$/.test(p.id)) throw new TypeError(`${at}.id must be lowercase letters, digits or _`);
    // Unique ids, Arabic and meanings: no two answer choices may look identical.
    for (const [set, key] of [[ids, "id"], [ar, "ar"], [en, "en"]]) {
      if (set.has(p[key])) throw new TypeError(`${at}.${key} is a duplicate: ${p[key]}`);
      set.add(p[key]);
    }
  }
  for (const [i, p] of raw.phrases.entries()) {
    if (p.reply !== undefined && (!ids.has(p.reply) || p.reply === p.id)) {
      throw new TypeError(`phrases[${i}].reply must be the id of a different phrase`);
    }
  }
  return raw.phrases;
}

export async function loadPhrases(url = new URL("phrases.json", import.meta.url), fetchFn = globalThis.fetch) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Could not load phrases (${res.status})`);
  return parsePhrases(await res.json());
}

// ---- sets (consecutive phrases in teaching order; all open) ----

export const setCount = (phrases) => Math.ceil(phrases.length / SET_SIZE);

/** Phrases in one set (1-based). */
export function phrasesOfSet(phrases, set) {
  if (!Number.isInteger(set) || set < 1) return [];
  return phrases.slice((set - 1) * SET_SIZE, set * SET_SIZE);
}

export const setOf = (phrases, phrase) => Math.floor(phrases.findIndex((p) => p.id === phrase.id) / SET_SIZE) + 1;

/** The phrase people usually answer with, or null. */
export function replyTo(phrases, phrase) {
  return (phrase.reply && phrases.find((p) => p.id === phrase.reply)) || null;
}

// ---- cards ----

export function cardsForPhrase(phrase, now, kinds = KINDS, set = 1) {
  for (const k of kinds) if (!KINDS.includes(k)) throw new RangeError(`unknown card kind: ${k}`);
  return kinds.map((kind) =>
    newCard({
      id: `${DECK}:${phrase.id}:${kind}`,
      deck: DECK,
      front: kind === "ar2en" ? phrase.ar : phrase.en,
      back: kind === "ar2en" ? phrase.en : phrase.ar,
      extra: { kind, phraseId: phrase.id, set },
    }, now));
}

export function cardsForSet(phrases, set, now, kinds = KINDS) {
  return phrasesOfSet(phrases, set).flatMap((p) => cardsForPhrase(p, now, kinds, set));
}

// ---- suggested path (information only; never a gate) ----

/** [{ set, total, learned, ratio }] per set. A card is learned after `minReps` correct answers in a row. */
export function setMastery(storedCards, phrases, { minReps = 2, kinds = KINDS } = {}) {
  const byId = new Map(storedCards.map((c) => [c.id, c]));
  return Array.from({ length: setCount(phrases) }, (_, i) => {
    const set = i + 1;
    const expected = cardsForSet(phrases, set, 0, kinds);
    const learned = expected.filter((c) => (byId.get(c.id)?.reps ?? 0) >= minReps).length;
    return { set, total: expected.length, learned, ratio: expected.length === 0 ? 0 : learned / expected.length };
  });
}

/** First set not yet learned to `threshold`; the last set once all are. Only a suggestion. */
export function suggestedSet(storedCards, phrases, { threshold = 0.8, minReps = 2, kinds = KINDS } = {}) {
  if (!(threshold > 0 && threshold <= 1)) throw new RangeError("threshold must be in (0, 1]");
  const mastery = setMastery(storedCards, phrases, { minReps, kinds });
  const next = mastery.find((m) => m.ratio < threshold);
  return next ? next.set : mastery.length;
}

// ---- feedback ----

/** Calm, short lines after an answer. Returns an array of lines. */
export function mistakeNote({ phrase, chosen = null }) {
  if (!phrase || !phrase.id) throw new TypeError("mistakeNote requires a phrase");
  const lines = [`${phrase.ar} (${phrase.tr}) means "${phrase.en}".`];
  if (chosen && chosen.id !== phrase.id) lines.push(`Not ${chosen.ar} (${chosen.tr}): it means "${chosen.en}".`);
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

const answerText = { ar2en: (p) => p.en, en2ar: (p) => p.ar };

/**
 * One multiple-choice question.
 *   ar2en : show the Arabic phrase, choose its meaning
 *   en2ar : show the meaning, choose the Arabic phrase
 * Wrong choices come from the same set first, then any other set, so they are plausible.
 */
export function buildQuestion({ phrase, kind, phrases, rng = Math.random, choiceCount = 4 }) {
  if (!KINDS.includes(kind)) throw new RangeError(`unknown question kind: ${kind}`);
  if (!Number.isInteger(choiceCount) || choiceCount < 2) throw new RangeError("choiceCount must be an integer >= 2");
  if (!phrases.some((p) => p.id === phrase.id)) throw new RangeError("phrase is not in the phrase list");
  if (phrases.length < 2) throw new RangeError("need at least 2 phrases to build a question");

  const text = answerText[kind];
  const set = setOf(phrases, phrase);
  const others = phrases.filter((p) => p.id !== phrase.id);
  const tiers = [others.filter((p) => setOf(phrases, p) === set), others.filter((p) => setOf(phrases, p) !== set)];

  const taken = new Set([text(phrase)]);
  const distractors = [];
  for (const tier of tiers) {
    for (const p of shuffle(tier, rng)) {
      if (distractors.length >= choiceCount - 1) break;
      if (taken.has(text(p))) continue;
      taken.add(text(p));
      distractors.push(p);
    }
  }

  const choices = shuffle([phrase, ...distractors], rng).map((p) => ({ id: p.id, text: text(p) }));
  return {
    kind,
    phraseId: phrase.id,
    prompt: kind === "ar2en" ? phrase.ar : phrase.en,
    promptIsArabic: kind === "ar2en",
    choicesAreArabic: kind === "en2ar",
    choices,
    answerId: phrase.id,
  };
}
