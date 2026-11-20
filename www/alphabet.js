// Alphabet module: letter data validation, joined forms, spaced-repetition cards,
// unlock progression and multiple-choice question building.
// Pure logic: no DOM, no storage. The screen that uses this comes in a later task.

import { newCard } from "./srs.js";

export const ZWJ = "‍"; // zero-width joiner: makes a letter render in its joined form
export const DECK = "alphabet";
export const KINDS = Object.freeze(["name", "sound", "form"]);
export const POSITIONS = Object.freeze(["initial", "medial", "final"]);
export const QUESTION_KINDS = Object.freeze(["name", "sound", "shape", "form"]);

// ---- loading and validation ----

/** Validate raw letters.json content and return the letters array. Throws TypeError on bad data. */
export function parseLetters(raw) {
  if (!raw || !Array.isArray(raw.letters) || raw.letters.length === 0) {
    throw new TypeError("letters.json: expected a non-empty `letters` array");
  }
  const ids = new Set();
  const chars = new Set();
  let lastGroup = 0;

  for (const [i, l] of raw.letters.entries()) {
    const at = `letters[${i}]`;
    for (const key of ["id", "char", "name", "nameEn", "sound", "hint"]) {
      if (typeof l[key] !== "string" || l[key] === "") throw new TypeError(`${at}.${key} must be a non-empty string`);
    }
    if ([...l.char].length !== 1) throw new TypeError(`${at}.char must be a single character`);
    if (l.joins !== "dual" && l.joins !== "right") throw new TypeError(`${at}.joins must be "dual" or "right"`);
    if (!Number.isInteger(l.group) || l.group < 1) throw new TypeError(`${at}.group must be an integer >= 1`);
    if (l.group < lastGroup || l.group > lastGroup + 1) {
      throw new TypeError(`${at}.group must stay in order and not skip (got ${l.group} after ${lastGroup})`);
    }
    lastGroup = l.group;
    if (l.family !== null && (typeof l.family !== "string" || l.family === "")) {
      throw new TypeError(`${at}.family must be a string or null`);
    }
    const ex = l.example;
    if (!ex || !ex.ar || !ex.tr || !ex.en) throw new TypeError(`${at}.example needs ar, tr and en`);
    if (ids.has(l.id)) throw new TypeError(`duplicate id: ${l.id}`);
    if (chars.has(l.char)) throw new TypeError(`duplicate char: ${l.char}`);
    ids.add(l.id);
    chars.add(l.char);
  }
  return raw.letters.map((l) => Object.freeze({ ...l }));
}

/** Fetch and validate letters.json (relative to this file). */
export async function loadLetters(url = new URL("letters.json", import.meta.url), fetchFn = globalThis.fetch) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Could not load letters (${res.status})`);
  return parseLetters(await res.json());
}

// ---- forms and groups ----

/** The four written forms of a letter. Right-joining letters have no initial/medial form (null). */
export function formsOf(letter) {
  const dual = letter.joins === "dual";
  return {
    isolated: letter.char,
    initial: dual ? letter.char + ZWJ : null,
    medial: dual ? ZWJ + letter.char + ZWJ : null,
    final: ZWJ + letter.char,
  };
}

/** Letters split into teaching groups, in order: [[g1 letters], [g2 letters], ...]. */
export function groupsOf(letters) {
  const out = [];
  for (const l of letters) (out[l.group - 1] ??= []).push(l);
  return out;
}

// ---- cards ----

/** SRS cards for one letter. `kinds` limits which exercises are created. */
export function cardsForLetter(letter, now, kinds = KINDS) {
  for (const k of kinds) if (!KINDS.includes(k)) throw new RangeError(`unknown card kind: ${k}`);
  const base = { deck: DECK };
  const tag = (extra) => ({ kind: extra.kind, letterId: letter.id, group: letter.group, ...extra });
  const cards = [];

  if (kinds.includes("name")) {
    cards.push(newCard({ ...base, id: `${DECK}:${letter.id}:name`, front: letter.char,
      back: `${letter.name} (${letter.nameEn})`, extra: tag({ kind: "name" }) }, now));
  }
  if (kinds.includes("sound")) {
    cards.push(newCard({ ...base, id: `${DECK}:${letter.id}:sound`, front: letter.char,
      back: letter.sound, extra: tag({ kind: "sound", hint: letter.hint }) }, now));
  }
  if (kinds.includes("form")) {
    const forms = formsOf(letter);
    for (const position of POSITIONS) {
      if (!forms[position]) continue;
      cards.push(newCard({ ...base, id: `${DECK}:${letter.id}:form:${position}`, front: forms[position],
        back: `${letter.name} (${letter.nameEn})`, extra: tag({ kind: "form", position }) }, now));
    }
  }
  return cards;
}

/** All cards for one teaching group (1-based). */
export function cardsForGroup(letters, group, now, kinds = KINDS) {
  return letters.filter((l) => l.group === group).flatMap((l) => cardsForLetter(l, now, kinds));
}

// ---- progression ----

/**
 * How many groups are open. Group 1 always is. The next group opens once at least
 * `threshold` of the newest open group's cards have been answered correctly `minReps`
 * times in a row. Unseen cards count as not learned.
 */
export function unlockedGroupCount(storedCards, letters, { threshold = 0.8, minReps = 2, kinds = KINDS } = {}) {
  if (!(threshold > 0 && threshold <= 1)) throw new RangeError("threshold must be in (0, 1]");
  const totalGroups = groupsOf(letters).length;
  const byId = new Map(storedCards.map((c) => [c.id, c]));
  let open = 1;
  while (open < totalGroups) {
    const expected = cardsForGroup(letters, open, 0, kinds);
    const learned = expected.filter((c) => (byId.get(c.id)?.reps ?? 0) >= minReps).length;
    if (expected.length === 0 || learned / expected.length < threshold) break;
    open++;
  }
  return open;
}

// ---- questions ----

/** Small seedable RNG so tests and "replay this lesson" are deterministic. */
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, rng) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const answerText = {
  name: (l) => `${l.name} (${l.nameEn})`,
  sound: (l) => l.sound,
  shape: (l) => l.char,
  form: (l) => `${l.name} (${l.nameEn})`,
};

/**
 * Build one multiple-choice question.
 *   name  : show the letter, choose its name
 *   sound : show the letter, choose its sound
 *   shape : show the name, choose the letter
 *   form  : show a joined form (needs `position`), choose the letter's name
 * Wrong choices come from look-alike letters first (same family), then the same teaching
 * group, then anything else, so questions test the real confusions.
 */
export function buildQuestion({ letter, kind, letters, position = null, rng = Math.random, choiceCount = 4 }) {
  if (!QUESTION_KINDS.includes(kind)) throw new RangeError(`unknown question kind: ${kind}`);
  if (!Number.isInteger(choiceCount) || choiceCount < 2) throw new RangeError("choiceCount must be an integer >= 2");
  if (!letters.some((l) => l.id === letter.id)) throw new RangeError("letter is not in the letters list");
  if (letters.length < 2) throw new RangeError("need at least 2 letters to build a question");

  let prompt;
  let promptIsArabic;
  if (kind === "form") {
    const forms = formsOf(letter);
    if (!POSITIONS.includes(position) || !forms[position]) {
      throw new RangeError(`letter ${letter.id} has no "${position}" form`);
    }
    prompt = forms[position];
    promptIsArabic = true;
  } else if (kind === "shape") {
    prompt = `${letter.name} (${letter.nameEn})`;
    promptIsArabic = false;
  } else {
    prompt = letter.char;
    promptIsArabic = true;
  }

  const text = answerText[kind];
  const taken = new Set([text(letter)]);
  const others = letters.filter((l) => l.id !== letter.id);
  const tiers = [
    others.filter((l) => letter.family && l.family === letter.family),
    others.filter((l) => l.group === letter.group && !(letter.family && l.family === letter.family)),
    others.filter((l) => l.group !== letter.group && !(letter.family && l.family === letter.family)),
  ];

  const distractors = [];
  for (const tier of tiers) {
    for (const l of shuffle(tier, rng)) {
      if (distractors.length >= choiceCount - 1) break;
      if (taken.has(text(l))) continue; // never show two identical-looking options
      taken.add(text(l));
      distractors.push(l);
    }
  }

  const choices = shuffle([letter, ...distractors], rng).map((l) => ({ id: l.id, text: text(l) }));
  return { kind, letterId: letter.id, prompt, promptIsArabic, choices, answerId: letter.id };
}
