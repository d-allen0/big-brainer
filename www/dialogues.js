// Dialogues module: short two-person conversations for the Read tab.
// Pure logic: no DOM, no storage, no clock.
//
// PACING RULE (see CLAUDE.md section 1): every dialogue is open from the start. "Up next" is only
// a suggestion (the first one the learner has not opened yet) and never blocks anything.

// Invisible and direction-control characters must never be in the data (they make text fragile).
const INVISIBLE = new RegExp("[\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff\\u00a0]");
const WHO = Object.freeze(["a", "b"]);

/** Validate raw dialogues.json content and return the dialogues array. Throws TypeError on bad data. */
export function parseDialogues(raw) {
  if (!raw || !Array.isArray(raw.dialogues) || raw.dialogues.length === 0) {
    throw new TypeError("dialogues.json: expected a non-empty `dialogues` array");
  }
  const ids = new Set();
  const titles = new Set();
  for (const [i, d] of raw.dialogues.entries()) {
    const at = `dialogues[${i}]`;
    for (const key of ["id", "title"]) {
      if (typeof d[key] !== "string" || d[key] === "") throw new TypeError(`${at}.${key} must be a non-empty string`);
    }
    if (!/^[a-z0-9_]+$/.test(d.id)) throw new TypeError(`${at}.id must be lowercase letters, digits or _`);
    if (ids.has(d.id)) throw new TypeError(`${at}.id is a duplicate: ${d.id}`);
    if (titles.has(d.title)) throw new TypeError(`${at}.title is a duplicate: ${d.title}`);
    ids.add(d.id);
    titles.add(d.title);
    if (!d.speakers || WHO.some((w) => typeof d.speakers[w] !== "string" || d.speakers[w] === "")) {
      throw new TypeError(`${at}.speakers must name both a and b`);
    }
    if (d.speakers.a === d.speakers.b) throw new TypeError(`${at}.speakers must be two different names`);
    if (!Array.isArray(d.lines) || d.lines.length < 2) throw new TypeError(`${at}.lines needs at least 2 lines`);
    for (const [j, l] of d.lines.entries()) {
      const lat = `${at}.lines[${j}]`;
      if (!WHO.includes(l.who)) throw new TypeError(`${lat}.who must be "a" or "b"`);
      for (const key of ["ar", "tr", "en"]) {
        if (typeof l[key] !== "string" || l[key] === "") throw new TypeError(`${lat}.${key} must be a non-empty string`);
        if (INVISIBLE.test(l[key])) throw new TypeError(`${lat}.${key} contains an invisible character`);
      }
    }
    if (new Set(d.lines.map((l) => l.who)).size < 2) throw new TypeError(`${at}: both speakers must talk`);
  }
  return raw.dialogues;
}

export async function loadDialogues(url = new URL("dialogues.json", import.meta.url), fetchFn = globalThis.fetch) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Could not load dialogues (${res.status})`);
  return parseDialogues(await res.json());
}

/** The dialogue with this id, or null (callers fall back to the list). */
export const findDialogue = (dialogues, id) => dialogues.find((d) => d.id === id) ?? null;

/**
 * The suggested dialogue: the first one the learner has not opened yet. Once every one has been
 * opened it starts over at the first, so there is always something suggested. Never blocks anything.
 * `opened` is any list of dialogue ids (unknown ids are ignored).
 */
export function suggestedDialogue(dialogues, opened = []) {
  const seen = new Set(Array.isArray(opened) ? opened : []);
  return dialogues.find((d) => !seen.has(d.id)) ?? dialogues[0] ?? null;
}

/** Add an id to the opened list without duplicates; unknown ids and bad input are ignored. */
export function markOpened(dialogues, opened, id) {
  const list = Array.isArray(opened) ? opened.filter((x) => dialogues.some((d) => d.id === x)) : [];
  if (dialogues.some((d) => d.id === id) && !list.includes(id)) list.push(id);
  return list;
}

/** What "Hear whole dialogue" says, in order: the Arabic of each line. */
export const hearAllTexts = (dialogue) => dialogue.lines.map((l) => l.ar);

/** The speaker's display name for a line. */
export const speakerName = (dialogue, line) => dialogue.speakers[line.who];
