// Texts module: graded short reading texts for the Read tab. Pure logic: no DOM, no storage, no clock.
//
// PACING RULES (see CLAUDE.md section 1): every text is open from the start. A level is only a label
// ("Level 1" is one sentence, "Level 3" is a short passage) and never blocks anything. "Up next" is only
// a suggestion (the first text the learner has not opened yet). The comprehension question is not graded,
// does not touch scheduling, shows no score, and a wrong answer costs nothing: it shows the right answer
// with a short note.

// Invisible and direction-control characters must never be in the data (they make text fragile).
const INVISIBLE = new RegExp("[\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff\\u00a0]");
// Vowel marks (tashkeel): beginner text must carry them.
const TASHKEEL = new RegExp("[\\u064b-\\u0652]");

/** How many sentences each level holds (inclusive). Levels are labels for how much there is to read. */
export const LEVELS = Object.freeze({ 1: [1, 1], 2: [2, 3], 3: [4, 6] });

/** Validate raw texts.json content and return the texts array. Throws TypeError on bad data. */
export function parseTexts(raw) {
  if (!raw || !Array.isArray(raw.texts) || raw.texts.length === 0) {
    throw new TypeError("texts.json: expected a non-empty `texts` array");
  }
  const ids = new Set();
  const titles = new Set();
  let lastLevel = 1;
  for (const [i, t] of raw.texts.entries()) {
    const at = `texts[${i}]`;
    for (const key of ["id", "title"]) {
      if (typeof t[key] !== "string" || t[key] === "") throw new TypeError(`${at}.${key} must be a non-empty string`);
    }
    if (!/^[a-z0-9_]+$/.test(t.id)) throw new TypeError(`${at}.id must be lowercase letters, digits or _`);
    if (ids.has(t.id)) throw new TypeError(`${at}.id is a duplicate: ${t.id}`);
    if (titles.has(t.title)) throw new TypeError(`${at}.title is a duplicate: ${t.title}`);
    ids.add(t.id);
    titles.add(t.title);
    if (!Object.hasOwn(LEVELS, t.level)) throw new TypeError(`${at}.level must be 1, 2 or 3`);
    if (t.level < lastLevel) throw new TypeError(`${at}: texts must be in order, easiest level first`);
    lastLevel = t.level;
    if (!Array.isArray(t.sentences)) throw new TypeError(`${at}.sentences must be an array`);
    const [min, max] = LEVELS[t.level];
    if (t.sentences.length < min || t.sentences.length > max) {
      throw new TypeError(`${at}: level ${t.level} needs ${min === max ? min : `${min} to ${max}`} sentence(s), found ${t.sentences.length}`);
    }
    for (const [j, s] of t.sentences.entries()) {
      const sat = `${at}.sentences[${j}]`;
      for (const key of ["ar", "tr", "en"]) {
        if (typeof s[key] !== "string" || s[key] === "") throw new TypeError(`${sat}.${key} must be a non-empty string`);
        if (INVISIBLE.test(s[key])) throw new TypeError(`${sat}.${key} contains an invisible character`);
      }
      if (!TASHKEEL.test(s.ar)) throw new TypeError(`${sat}.ar needs vowel marks`);
    }
    const q = t.question;
    if (!q || typeof q.prompt !== "string" || q.prompt === "") throw new TypeError(`${at}.question.prompt must be a non-empty string`);
    if (typeof q.note !== "string" || q.note === "") throw new TypeError(`${at}.question.note must be a non-empty string`);
    if (!Array.isArray(q.options) || q.options.length < 3 || q.options.length > 4) {
      throw new TypeError(`${at}.question.options needs 3 or 4 options`);
    }
    for (const o of q.options) if (typeof o !== "string" || o === "") throw new TypeError(`${at}.question.options must be non-empty strings`);
    if (new Set(q.options).size !== q.options.length) throw new TypeError(`${at}.question.options has a duplicate`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) {
      throw new TypeError(`${at}.question.answer must be the index of one option`);
    }
  }
  return raw.texts;
}

export async function loadTexts(url = new URL("texts.json", import.meta.url), fetchFn = globalThis.fetch) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Could not load texts (${res.status})`);
  return parseTexts(await res.json());
}

/** The text with this id, or null (callers fall back to the list). */
export const findText = (texts, id) => texts.find((t) => t.id === id) ?? null;

/** A quiet label for a level. It describes how much there is to read; it is never a gate. */
export const levelLabel = (level) => `Level ${level}`;

/** The texts grouped by level, in order: [{ level, texts }]. */
export function byLevel(texts) {
  const out = [];
  for (const t of texts) {
    const last = out[out.length - 1];
    if (last && last.level === t.level) last.texts.push(t);
    else out.push({ level: t.level, texts: [t] });
  }
  return out;
}

/**
 * The suggested text: the first one the learner has not opened yet. Once every one has been opened it
 * starts over at the first, so there is always something suggested. Never blocks anything.
 * `opened` is any list of text ids (unknown ids are ignored).
 */
export function suggestedText(texts, opened = []) {
  const seen = new Set(Array.isArray(opened) ? opened : []);
  return texts.find((t) => !seen.has(t.id)) ?? texts[0] ?? null;
}

/** Add an id to the opened list without duplicates; unknown ids and bad input are ignored. */
export function markOpened(texts, opened, id) {
  const list = Array.isArray(opened) ? opened.filter((x) => texts.some((t) => t.id === x)) : [];
  if (texts.some((t) => t.id === id) && !list.includes(id)) list.push(id);
  return list;
}

/** What "Hear whole text" says, in order: the Arabic of each sentence. */
export const hearAllTexts = (text) => text.sentences.map((s) => s.ar);

/**
 * The comprehension question with its options in a shuffled order (the file lists the right one
 * first, which must never show). Each option keeps its original index as `id`.
 */
export function buildQuestion(text, rng = Math.random) {
  const options = text.question.options.map((label, id) => ({ id, text: label }));
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { prompt: text.question.prompt, options, answerId: text.question.answer };
}

/**
 * Check an answer. Always returns the right answer and the short note, so a wrong answer is
 * instructive and a right one is confirmed the same way. Nothing is scored.
 */
export function checkAnswer(text, chosenId) {
  const q = text.question;
  if (!Number.isInteger(chosenId) || chosenId < 0 || chosenId >= q.options.length) {
    throw new RangeError("that option is not part of this question");
  }
  return { correct: chosenId === q.answer, answer: q.options[q.answer], note: q.note };
}
