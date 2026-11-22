// Marks module: the "Read it" lessons that follow the letter groups. Each one adds a vowel mark or
// a reading rule (short vowels, sukun, shadda, tanwin, round ta, long vowels) and practises it on
// syllables and real words. Same shape as alphabet.js, vocab.js and phrases.js.
// Pure logic: no DOM, no storage.
//
// PACING RULE (see CLAUDE.md section 1): progress here only ever produces SUGGESTIONS
// ("up next"). Nothing in this file may block access to any lesson or item.
//
// DECODABLE RULE: an item may only use letters from groups up to its lesson's `afterGroup`,
// marks taught in that lesson or an earlier one, and special letters (like round ta) introduced
// so far. `parseMarks` enforces it, so reading material never contains something unknown.

import { newCard } from "./srs.js";

export const DECK = "marks";
export const KINDS = Object.freeze(["read", "hear"]);
export const ITEM_KINDS = Object.freeze(["sound", "word"]);

/** The vowel marks and what each one does. Written as code points, never pasted. */
export const MARKS = Object.freeze({
  fatha: Object.freeze({ char: "َ", label: "fatha", sound: "a" }),
  kasra: Object.freeze({ char: "ِ", label: "kasra", sound: "i" }),
  damma: Object.freeze({ char: "ُ", label: "damma", sound: "u" }),
  sukun: Object.freeze({ char: "ْ", label: "sukun", sound: "no vowel" }),
  shadda: Object.freeze({ char: "ّ", label: "shadda", sound: "doubles the letter" }),
  fathatan: Object.freeze({ char: "ً", label: "tanwin fatha", sound: "-an" }),
  dammatan: Object.freeze({ char: "ٌ", label: "tanwin damma", sound: "-un" }),
  kasratan: Object.freeze({ char: "ٍ", label: "tanwin kasra", sound: "-in" }),
});

/** Letters outside the 28 that lessons introduce one by one: round ta, alif maqsura, hamza and its seats. */
export const SPECIALS = Object.freeze(["ة", "ى", "ء", "أ", "إ", "آ", "ؤ", "ئ"]);

const MARK_BY_CHAR = new Map(Object.entries(MARKS).map(([name, m]) => [m.char, name]));
const TASHKEEL = /[ً-ْ]/;
const TASHKEEL_ALL = /[ً-ْ]/g;
// Invisible and direction-control characters must never be in the data (they make text fragile).
const INVISIBLE = new RegExp("[\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff\\u00a0]");

/** The mark on its own, shown on a dotted circle so it is visible. */
export const markGlyph = (name) => {
  if (!MARKS[name]) throw new RangeError(`unknown mark: ${name}`);
  return "◌" + MARKS[name].char;
};

/** An Arabic string without its vowel marks (so look-alike items can be told apart). */
export const stripMarks = (s) => s.replace(TASHKEEL_ALL, "");

// ---- loading and validation ----

const nonEmpty = (v) => typeof v === "string" && v !== "";

/**
 * Validate raw marks.json against the letters list and return the lessons array.
 * Throws TypeError on bad data, including any item that is not decodable at its place in the path.
 */
export function parseMarks(raw, letters) {
  if (!raw || !Array.isArray(raw.lessons) || raw.lessons.length === 0) {
    throw new TypeError("marks.json: expected a non-empty `lessons` array");
  }
  if (!Array.isArray(letters) || letters.length === 0) throw new TypeError("parseMarks needs the letters list");
  const groupOf = new Map(letters.map((l) => [l.char, l.group]));
  const maxGroup = Math.max(...letters.map((l) => l.group));

  const lessonIds = new Set();
  const knownMarks = new Set();
  const knownSpecials = new Set();
  let lastAfter = 0;

  for (const [i, lesson] of raw.lessons.entries()) {
    const at = `lessons[${i}]`;
    for (const key of ["id", "title", "reminder"]) {
      if (!nonEmpty(lesson[key])) throw new TypeError(`${at}.${key} must be a non-empty string`);
      if (INVISIBLE.test(lesson[key])) throw new TypeError(`${at}.${key} contains an invisible character`);
    }
    if (!/^[a-z0-9_]+$/.test(lesson.id)) throw new TypeError(`${at}.id must be lowercase letters, digits or _`);
    if (lessonIds.has(lesson.id)) throw new TypeError(`${at}.id is a duplicate: ${lesson.id}`);
    lessonIds.add(lesson.id);

    if (!Number.isInteger(lesson.afterGroup) || lesson.afterGroup < 1 || lesson.afterGroup > maxGroup) {
      throw new TypeError(`${at}.afterGroup must be an integer from 1 to ${maxGroup}`);
    }
    if (lesson.afterGroup < lastAfter) throw new TypeError(`${at}.afterGroup must not go backwards`);
    lastAfter = lesson.afterGroup;

    if (!Array.isArray(lesson.intro) || lesson.intro.length < 1 || lesson.intro.length > 4 ||
        !lesson.intro.every((s) => nonEmpty(s) && !INVISIBLE.test(s))) {
      throw new TypeError(`${at}.intro must be 1 to 4 non-empty strings`);
    }
    if (!Array.isArray(lesson.marks) || !lesson.marks.every((m) => MARKS[m])) {
      throw new TypeError(`${at}.marks must list known mark names`);
    }
    if (!Array.isArray(lesson.introduces) || !lesson.introduces.every((c) => SPECIALS.includes(c))) {
      throw new TypeError(`${at}.introduces must list known special letters`);
    }
    for (const m of lesson.marks) knownMarks.add(m);
    for (const c of lesson.introduces) knownSpecials.add(c);

    if (!Array.isArray(lesson.items) || lesson.items.length < 4) {
      throw new TypeError(`${at}.items needs at least 4 items`);
    }
    const ids = new Set();
    const ar = new Set();
    const tr = new Set();
    for (const [j, item] of lesson.items.entries()) {
      const iat = `${at}.items[${j}]`;
      for (const key of ["id", "ar", "tr"]) {
        if (!nonEmpty(item[key])) throw new TypeError(`${iat}.${key} must be a non-empty string`);
        if (INVISIBLE.test(item[key])) throw new TypeError(`${iat}.${key} contains an invisible character`);
      }
      if (!/^[a-z0-9_]+$/.test(item.id)) throw new TypeError(`${iat}.id must be lowercase letters, digits or _`);
      if (!ITEM_KINDS.includes(item.kind)) throw new TypeError(`${iat}.kind must be "sound" or "word"`);
      if (item.kind === "word") {
        if (!nonEmpty(item.en) || INVISIBLE.test(item.en)) throw new TypeError(`${iat}.en (the meaning) is required for a word`);
      } else if (item.en !== undefined && item.en !== null) {
        throw new TypeError(`${iat}.en must be absent for a sound`);
      }
      // Unique within a lesson so no two answer choices look identical.
      for (const [set, key] of [[ids, "id"], [ar, "ar"], [tr, "tr"]]) {
        if (set.has(item[key])) throw new TypeError(`${iat}.${key} is a duplicate: ${item[key]}`);
        set.add(item[key]);
      }
      // Decodable: every character must already be taught at this point in the path.
      for (const ch of item.ar) {
        if (TASHKEEL.test(ch)) {
          const name = MARK_BY_CHAR.get(ch);
          if (!name || !knownMarks.has(name)) throw new TypeError(`${iat}.ar uses a mark not taught yet: ${item.id}`);
        } else if (groupOf.has(ch)) {
          if (groupOf.get(ch) > lesson.afterGroup) throw new TypeError(`${iat}.ar uses a letter from a later group: ${item.id}`);
        } else if (!(SPECIALS.includes(ch) && knownSpecials.has(ch))) {
          throw new TypeError(`${iat}.ar uses a character not taught yet: ${item.id}`);
        }
      }
      if (!TASHKEEL.test(item.ar)) throw new TypeError(`${iat}.ar needs vowel marks`);
    }
    // What a lesson says it teaches must really appear in its items.
    for (const m of lesson.marks) {
      if (!lesson.items.some((it) => it.ar.includes(MARKS[m].char))) throw new TypeError(`${at}: no item uses ${m}`);
    }
    for (const c of lesson.introduces) {
      if (!lesson.items.some((it) => it.ar.includes(c))) throw new TypeError(`${at}: no item uses an introduced letter`);
    }
  }
  return raw.lessons;
}

/** Fetch and validate marks.json (relative to this file). Needs the parsed letters. */
export async function loadMarks(letters, url = new URL("marks.json", import.meta.url), fetchFn = globalThis.fetch) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Could not load the reading lessons (${res.status})`);
  return parseMarks(await res.json(), letters);
}

// ---- lookup ----

export const findLesson = (lessons, id) => lessons.find((l) => l.id === id) ?? null;

/** The lessons that follow a letter group (usually zero or one), in order. */
export const lessonsAfterGroup = (lessons, group) => lessons.filter((l) => l.afterGroup === group);

/** A key that names one item anywhere in the list: "<lesson id>:<item id>". */
export const itemKey = (lesson, item) => `${lesson.id}:${item.id}`;

/** Find { lesson, item } from an item key, or null. */
export function findItem(lessons, key) {
  const [lessonId, itemId] = String(key).split(":");
  const lesson = findLesson(lessons, lessonId);
  const item = lesson?.items.find((it) => it.id === itemId);
  return item ? { lesson, item } : null;
}

// ---- cards ----

/** SRS cards for one item: `read` (see it, give the sound) and `hear` (listen, pick the writing). */
export function cardsForItem(lesson, item, now, kinds = KINDS) {
  for (const k of kinds) if (!KINDS.includes(k)) throw new RangeError(`unknown card kind: ${k}`);
  return kinds.map((kind) =>
    newCard({
      id: `${DECK}:${lesson.id}:${item.id}:${kind}`,
      deck: DECK,
      front: item.ar,
      back: item.tr,
      extra: { kind, lessonId: lesson.id, itemId: item.id, afterGroup: lesson.afterGroup },
    }, now));
}

export function cardsForLesson(lesson, now, kinds = KINDS) {
  return lesson.items.flatMap((item) => cardsForItem(lesson, item, now, kinds));
}

// ---- suggested path (information only; never a gate) ----

/** [{ lesson, total, learned, ratio }] per lesson. A card is learned after `minReps` correct answers in a row. */
export function lessonMastery(storedCards, lessons, { minReps = 2, kinds = KINDS } = {}) {
  const byId = new Map(storedCards.map((c) => [c.id, c]));
  return lessons.map((l) => {
    const expected = cardsForLesson(l, 0, kinds);
    const learned = expected.filter((c) => (byId.get(c.id)?.reps ?? 0) >= minReps).length;
    return { lesson: l.id, total: expected.length, learned, ratio: expected.length === 0 ? 0 : learned / expected.length };
  });
}

/** First lesson not yet learned to `threshold`; the last lesson once all are. Only a suggestion. */
export function suggestedLesson(storedCards, lessons, { threshold = 0.8, minReps = 2, kinds = KINDS } = {}) {
  if (!(threshold > 0 && threshold <= 1)) throw new RangeError("threshold must be in (0, 1]");
  const mastery = lessonMastery(storedCards, lessons, { minReps, kinds });
  const next = mastery.find((m) => m.ratio < threshold);
  return next ? next.lesson : mastery[mastery.length - 1].lesson;
}

// ---- feedback ----

/**
 * Calm, short lines after an answer: what the item says, what the learner's pick was if it
 * was different (noting when only the mark differs), and the lesson's one-line reminder.
 */
export function mistakeNote({ lesson, item, chosen = null }) {
  if (!lesson || !lesson.id || !item || !item.id) throw new TypeError("mistakeNote requires a lesson and an item");
  const meaning = item.en ? ` (${item.en})` : "";
  const lines = [`${item.ar} is read "${item.tr}"${meaning}.`];
  if (chosen && chosen.id !== item.id) {
    const sameLetters = stripMarks(chosen.ar) === stripMarks(item.ar);
    lines.push(`Not ${chosen.ar}, which is read "${chosen.tr}".${sameLetters ? " The letters match; only the mark differs." : ""}`);
  }
  lines.push(lesson.reminder);
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

const answerText = { read: (it) => it.tr, hear: (it) => it.ar };

/**
 * One multiple-choice question.
 *   read : show the Arabic, choose how it is read
 *   hear : the learner listens (`speak` is the text to say), then chooses the writing
 * Wrong choices come from items with the same letters (differing only by mark) first, then the
 * rest of the lesson, then earlier lessons. Later lessons are never used, so nothing unknown appears.
 */
export function buildQuestion({ lesson, item, kind, lessons, rng = Math.random, choiceCount = 4 }) {
  if (!KINDS.includes(kind)) throw new RangeError(`unknown question kind: ${kind}`);
  if (!Number.isInteger(choiceCount) || choiceCount < 2) throw new RangeError("choiceCount must be an integer >= 2");
  const at = lessons.findIndex((l) => l.id === lesson?.id);
  if (at === -1) throw new RangeError("lesson is not in the lessons list");
  if (!lesson.items.some((it) => it.id === item?.id)) throw new RangeError("item is not in the lesson");

  const text = answerText[kind];
  const pool = lessons.slice(0, at + 1).flatMap((l) => l.items.map((it) => ({ lesson: l, item: it })));
  const others = pool.filter((p) => !(p.lesson.id === lesson.id && p.item.id === item.id));
  const same = others.filter((p) => p.lesson.id === lesson.id);
  const base = stripMarks(item.ar);
  const tiers = [
    same.filter((p) => stripMarks(p.item.ar) === base),
    same.filter((p) => stripMarks(p.item.ar) !== base),
    others.filter((p) => p.lesson.id !== lesson.id),
  ];

  const taken = new Set([text(item)]);
  const distractors = [];
  for (const tier of tiers) {
    for (const p of shuffle(tier, rng)) {
      if (distractors.length >= choiceCount - 1) break;
      if (taken.has(text(p.item))) continue; // never show two identical-looking options
      taken.add(text(p.item));
      distractors.push(p);
    }
  }

  const answerId = itemKey(lesson, item);
  const choices = shuffle([{ lesson, item }, ...distractors], rng).map((p) => ({ id: itemKey(p.lesson, p.item), text: text(p.item) }));
  return {
    kind,
    lessonId: lesson.id,
    itemId: item.id,
    prompt: kind === "read" ? item.ar : null,
    promptIsArabic: kind === "read",
    speak: item.ar,
    choicesAreArabic: kind === "hear",
    choices,
    answerId,
  };
}
