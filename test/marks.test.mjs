// Marks ("Read it" lessons) logic tests: validation (incl. the decodable rule), cards, suggested
// lesson, feedback and question building. Pure logic; no DOM.
// Never paste invisible characters here; use explicit code points.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WWW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../www");
const read = (f) => fs.readFileSync(path.join(WWW, f), "utf8");
const M = await import(path.join(WWW, "marks.js"));
const A = await import(path.join(WWW, "alphabet.js"));

const letters = A.parseLetters(JSON.parse(read("letters.json")));
const raw = () => JSON.parse(read("marks.json"));
const lessons = M.parseMarks(raw(), letters);
const T0 = 1_700_000_000_000;
const FATHA = "َ";
const KASRA = "ِ";
const SUKUN = "ْ";
const BA = "ب";
const THA = "ث";
const SEEN = "س";
const TA_MARBUTA = "ة";
const HAMZA = "ء";
const PACING_WORDS = /\b(due|overdue|locked|unlock|unlocked|streak|daily|expires|deadline|behind|penalty|tomorrow|later|wait|missed)\b/i;

/** Parse a tweaked copy of the real data; `edit` receives the lessons array. */
const parseWith = (edit) => {
  const r = raw();
  edit(r.lessons);
  return M.parseMarks(r, letters);
};
const item = (id, ar, tr, kind = "sound", en) => ({ id, kind, ar, tr, ...(en ? { en } : {}) });

describe("marks: the real data", () => {
  it("loads, in teaching order, after the groups the plan says", () => {
    assert.deepEqual(lessons.map((l) => [l.id, l.afterGroup]),
      [["short_vowels", 1], ["sukun", 3], ["shadda", 4], ["tanwin", 5], ["ta_marbuta", 7], ["long_vowels", 8]]);
    assert.equal(lessons.reduce((n, l) => n + l.items.length, 0), 57);
    assert.ok(lessons.every((l) => l.items.length >= 8 && l.items.length <= 12));
  });

  it("is flagged unreviewed and carries no invisible characters", () => {
    assert.equal(raw().reviewed, false);
    const text = read("marks.json");
    const bad = new RegExp("[\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff\\u00a0]");
    assert.ok(!bad.test(text), "invisible character in marks.json");
  });

  it("uses no pacing-pressure wording in anything the learner reads", () => {
    for (const l of lessons) {
      const all = [l.title, l.reminder, ...l.intro, ...l.items.flatMap((i) => [i.tr, i.en ?? ""])].join(" ");
      assert.ok(!PACING_WORDS.test(all), `${l.id}: ${all.match(PACING_WORDS)?.[0]}`);
    }
  });

  it("writes transliteration with the app's letters only", () => {
    for (const l of lessons) for (const i of l.items) {
      assert.match(i.tr, /^[a-zāīūḥṣḍṭẓʿʾ]+$/, `${l.id}/${i.id}: ${i.tr}`);
    }
  });

  it("every lesson really uses the marks it says it teaches", () => {
    for (const l of lessons) for (const m of l.marks) {
      assert.ok(l.items.some((i) => i.ar.includes(M.MARKS[m].char)), `${l.id} does not use ${m}`);
    }
  });

  it("each lesson's cards, ids and choices are unique", () => {
    const cards = lessons.flatMap((l) => M.cardsForLesson(l, T0));
    assert.equal(cards.length, 57 * 2);
    assert.equal(new Set(cards.map((c) => c.id)).size, cards.length);
  });
});

describe("marks: lookup helpers", () => {
  it("finds lessons by id and by the group they follow", () => {
    assert.equal(M.findLesson(lessons, "shadda").afterGroup, 4);
    assert.equal(M.findLesson(lessons, "nope"), null);
    assert.deepEqual(M.lessonsAfterGroup(lessons, 3).map((l) => l.id), ["sukun"]);
    assert.deepEqual(M.lessonsAfterGroup(lessons, 2), []);
  });

  it("round-trips an item key", () => {
    const l = lessons[0];
    const i = l.items[0];
    const found = M.findItem(lessons, M.itemKey(l, i));
    assert.equal(found.lesson.id, l.id);
    assert.equal(found.item.id, i.id);
    assert.equal(M.findItem(lessons, "short_vowels:nope"), null);
    assert.equal(M.findItem(lessons, "garbage"), null);
  });

  it("strips marks and shows a mark on a dotted circle", () => {
    assert.equal(M.stripMarks(BA + FATHA + THA + KASRA), BA + THA);
    assert.equal(M.stripMarks(BA), BA);
    assert.equal(M.markGlyph("fatha"), "◌" + FATHA);
    assert.throws(() => M.markGlyph("nope"), RangeError);
  });
});

describe("marks: validation (the decodable rule)", () => {
  it("rejects empty or malformed files", () => {
    assert.throws(() => M.parseMarks(null, letters), TypeError);
    assert.throws(() => M.parseMarks({ lessons: [] }, letters), TypeError);
    assert.throws(() => M.parseMarks(raw(), []), TypeError);
  });

  it("rejects a letter from a group the learner has not reached", () => {
    // seen is group 4; short_vowels follows group 1
    assert.throws(() => parseWith((ls) => { ls[0].items[0].ar = SEEN + FATHA; }), /later group/);
  });

  it("rejects a mark that has not been taught yet", () => {
    assert.throws(() => parseWith((ls) => { ls[0].items[0].ar = BA + SUKUN; }), /mark not taught yet/);
  });

  it("rejects a special letter before its lesson introduces it", () => {
    assert.throws(() => parseWith((ls) => { ls[0].items[0].ar = BA + FATHA + TA_MARBUTA; }), /not taught yet/);
    assert.throws(() => parseWith((ls) => { ls[4].items[0].ar = BA + FATHA + HAMZA; }), /not taught yet/);
  });

  it("rejects stray characters, spaces and invisible joiners", () => {
    assert.throws(() => parseWith((ls) => { ls[0].items[0].ar = BA + FATHA + " "; }), /not taught yet/);
    assert.throws(() => parseWith((ls) => { ls[0].items[0].ar = BA + FATHA + String.fromCharCode(0x200d); }), /invisible/);
    assert.throws(() => parseWith((ls) => { ls[0].items[0].tr = "ba" + String.fromCharCode(0x200e); }), /invisible/);
  });

  it("rejects a mark that a lesson claims but never uses, and an item with no vowel marks", () => {
    assert.throws(() => parseWith((ls) => { ls[1].marks = ["sukun", "shadda"]; }), /no item uses shadda/);
    assert.throws(() => parseWith((ls) => { ls[0].items[0].ar = BA; }), /needs vowel marks/);
    assert.throws(() => parseWith((ls) => { ls[0].marks = ["bogus"]; }), /known mark names/);
  });

  it("rejects duplicate ids, Arabic or transliteration inside a lesson", () => {
    assert.throws(() => parseWith((ls) => { ls[0].items[1].id = ls[0].items[0].id; }), /duplicate/);
    assert.throws(() => parseWith((ls) => { ls[0].items[1].ar = ls[0].items[0].ar; }), /duplicate/);
    assert.throws(() => parseWith((ls) => { ls[0].items[1].tr = ls[0].items[0].tr; }), /duplicate/);
    assert.throws(() => parseWith((ls) => { ls[1].id = ls[0].id; }), /duplicate/);
  });

  it("requires a meaning for words only, and at least 4 items", () => {
    assert.throws(() => parseWith((ls) => { delete ls[0].items.find((i) => i.kind === "word").en; }), /meaning/);
    assert.throws(() => parseWith((ls) => { ls[0].items.find((i) => i.kind === "sound").en = "x"; }), /absent for a sound/);
    assert.throws(() => parseWith((ls) => { ls[0].items = ls[0].items.slice(0, 3); }), /at least 4/);
  });

  it("rejects bad lesson fields and a path that goes backwards", () => {
    assert.throws(() => parseWith((ls) => { ls[0].afterGroup = 9; }), /afterGroup/);
    assert.throws(() => parseWith((ls) => { ls[2].afterGroup = 2; }), /backwards/);
    assert.throws(() => parseWith((ls) => { ls[0].intro = []; }), /intro/);
    assert.throws(() => parseWith((ls) => { ls[0].id = "Bad Id"; }), /id must be/);
    assert.throws(() => parseWith((ls) => { ls[0].reminder = ""; }), /reminder/);
  });
});

describe("marks: cards", () => {
  it("builds read and hear cards with stable ids", () => {
    const l = lessons[0];
    const i = l.items[0];
    const [r, h] = M.cardsForItem(l, i, T0);
    assert.equal(r.id, "marks:short_vowels:ba:read");
    assert.equal(h.id, "marks:short_vowels:ba:hear");
    assert.equal(r.deck, "marks");
    assert.deepEqual([r.extra.kind, h.extra.kind], ["read", "hear"]);
    assert.equal(r.extra.afterGroup, 1);
    assert.equal(r.front, i.ar);
    assert.equal(r.back, i.tr);
    assert.equal(r.due, T0);
    assert.equal(r.reps, 0);
  });

  it("can build one kind only and rejects unknown kinds", () => {
    assert.equal(M.cardsForLesson(lessons[0], T0, ["read"]).length, lessons[0].items.length);
    assert.throws(() => M.cardsForItem(lessons[0], lessons[0].items[0], T0, ["spell"]), RangeError);
  });
});

describe("marks: suggested lesson (a suggestion, never a gate)", () => {
  const learn = (l, reps = 2) => M.cardsForLesson(l, T0).map((c) => ({ ...c, reps }));

  it("starts at the first lesson with no progress", () => {
    assert.equal(M.suggestedLesson([], lessons), "short_vowels");
  });

  it("moves on once a lesson is learned to the threshold", () => {
    assert.equal(M.suggestedLesson(learn(lessons[0]), lessons), "sukun");
    const nearly = learn(lessons[0]);
    for (const c of nearly.slice(0, 2)) c.reps = 0; // 22 of 24 still clears 0.8
    assert.equal(M.suggestedLesson(nearly, lessons), "sukun");
    for (const c of nearly.slice(0, 8)) c.reps = 0; // 16 of 24 does not
    assert.equal(M.suggestedLesson(nearly, lessons), "short_vowels");
  });

  it("stays on the last lesson once all are learned, never empty", () => {
    const all = lessons.flatMap((l) => learn(l));
    assert.equal(M.suggestedLesson(all, lessons), "long_vowels");
  });

  it("counts cards that were never created as not learned, and checks the threshold", () => {
    const m = M.lessonMastery([], lessons);
    assert.ok(m.every((x) => x.learned === 0 && x.ratio === 0 && x.total > 0));
    assert.throws(() => M.suggestedLesson([], lessons, { threshold: 0 }), RangeError);
    assert.throws(() => M.suggestedLesson([], lessons, { threshold: 1.5 }), RangeError);
  });
});

describe("marks: suggested step (one Up next across groups and Read it lessons)", () => {
  const GROUPS = A.groupsOf(letters).length;
  // Mastery lists with every group and lesson at `ratio`, then specific ones overridden.
  const gm = (ratio = 0, over = {}) => A.groupMastery([], letters).map((g) => ({ ...g, ratio: over[g.group] ?? ratio }));
  const lm = (ratio = 0, over = {}) => M.lessonMastery([], lessons).map((m) => ({ ...m, ratio: over[m.lesson] ?? ratio }));
  const step = (g, l, ls = lessons, opts) => M.suggestedStep(g, l, ls, opts);

  it("starts at group 1 for a brand-new learner", () => {
    assert.deepEqual(step(gm(), lm()), { type: "group", group: 1 });
  });

  it("follows the path: group 1, its Read it lesson, group 2, group 3, its lesson", () => {
    assert.deepEqual(step(gm(0, { 1: 1 }), lm()), { type: "lesson", lesson: "short_vowels" });
    assert.deepEqual(step(gm(0, { 1: 1 }), lm(0, { short_vowels: 1 })), { type: "group", group: 2 });
    assert.deepEqual(step(gm(0, { 1: 1, 2: 1 }), lm(0, { short_vowels: 1 })), { type: "group", group: 3 });
    assert.deepEqual(step(gm(0, { 1: 1, 2: 1, 3: 1 }), lm(0, { short_vowels: 1 })), { type: "lesson", lesson: "sukun" });
  });

  it("is exactly one step, and the first one below the threshold (0.8 clears, just under does not)", () => {
    assert.deepEqual(step(gm(0, { 1: 0.8 }), lm(0, { short_vowels: 0.79 })), { type: "lesson", lesson: "short_vowels" });
    assert.deepEqual(step(gm(0, { 1: 0.8 }), lm(0, { short_vowels: 0.8 })), { type: "group", group: 2 });
  });

  it("goes back to an earlier unfinished step, not where the learner has jumped to", () => {
    // Group 5 and its lesson done, but group 2 is not: group 2 is the suggestion.
    const g = gm(1, { 2: 0.1 });
    assert.deepEqual(step(g, lm(1)), { type: "group", group: 2 });
  });

  it("stays on the last step once everything is learned, never empty", () => {
    const last = step(gm(1), lm(1));
    assert.deepEqual(last, { type: "lesson", lesson: lessons[lessons.length - 1].id });
    assert.ok(lessons[lessons.length - 1].afterGroup === GROUPS || lessons[lessons.length - 1].afterGroup < GROUPS);
  });

  it("falls back to a groups-only path when the lessons are missing", () => {
    assert.deepEqual(step(gm(0, { 1: 1 }), [], []), { type: "group", group: 2 });
    assert.deepEqual(step(gm(1), [], []), { type: "group", group: GROUPS });
    assert.deepEqual(M.suggestedStep(gm(0, { 1: 1 }), undefined, undefined), { type: "group", group: 2 });
  });

  it("treats a lesson with no mastery entry as not learned", () => {
    assert.deepEqual(step(gm(0, { 1: 1 }), [], lessons), { type: "lesson", lesson: "short_vowels" });
  });

  it("checks its inputs", () => {
    assert.throws(() => step(gm(), lm(), lessons, { threshold: 0 }), RangeError);
    assert.throws(() => step(gm(), lm(), lessons, { threshold: 1.5 }), RangeError);
    assert.throws(() => step([], lm()), TypeError);
  });
});

describe("marks: feedback", () => {
  const l = lessons[0];
  const [ba, bi] = l.items;

  it("says what the item is and ends with the lesson reminder", () => {
    const lines = M.mistakeNote({ lesson: l, item: ba });
    assert.equal(lines.length, 2);
    assert.match(lines[0], /is read "ba"/);
    assert.equal(lines.at(-1), l.reminder);
  });

  it("names what the wrong pick was, and says when only the mark differs", () => {
    const lines = M.mistakeNote({ lesson: l, item: ba, chosen: bi });
    assert.equal(lines.length, 3);
    assert.match(lines[1], /read "bi"/);
    assert.match(lines[1], /only the mark differs/);
    const other = M.mistakeNote({ lesson: l, item: ba, chosen: l.items.find((i) => i.id === "ta") });
    assert.ok(!/only the mark differs/.test(other[1]));
  });

  it("includes a word's meaning and ignores a pick equal to the answer", () => {
    const word = l.items.find((i) => i.kind === "word");
    assert.match(M.mistakeNote({ lesson: l, item: word })[0], /\(door\)/);
    assert.equal(M.mistakeNote({ lesson: l, item: ba, chosen: ba }).length, 2);
  });

  it("needs a lesson and an item", () => {
    assert.throws(() => M.mistakeNote({ lesson: l }), TypeError);
    assert.throws(() => M.mistakeNote({ item: ba }), TypeError);
  });

  it("never uses pacing-pressure wording", () => {
    for (const lesson of lessons) for (const it of lesson.items) {
      for (const chosen of [null, lesson.items[0]]) {
        assert.ok(!PACING_WORDS.test(M.mistakeNote({ lesson, item: it, chosen }).join(" ")));
      }
    }
  });
});

describe("marks: questions", () => {
  const rng = () => A.seededRng(11);
  const q = (lesson, it, kind, extra = {}) => M.buildQuestion({ lesson, item: it, kind, lessons, rng: rng(), ...extra });

  it("read: shows the Arabic and offers sounds, answer included, no repeats", () => {
    const l = lessons[0];
    const out = q(l, l.items[0], "read");
    assert.equal(out.prompt, l.items[0].ar);
    assert.equal(out.promptIsArabic, true);
    assert.equal(out.choicesAreArabic, false);
    assert.equal(out.choices.length, 4);
    assert.ok(out.choices.some((c) => c.id === out.answerId && c.text === "ba"));
    assert.equal(new Set(out.choices.map((c) => c.text)).size, 4);
  });

  it("hear: no text prompt, speaks the item, offers Arabic choices", () => {
    const l = lessons[0];
    const out = q(l, l.items[0], "hear");
    assert.equal(out.prompt, null);
    assert.equal(out.speak, l.items[0].ar);
    assert.equal(out.choicesAreArabic, true);
    assert.ok(out.choices.some((c) => c.id === out.answerId && c.text === l.items[0].ar));
  });

  it("puts look-alikes (same letters, other mark) among the wrong choices first", () => {
    const l = lessons[0];
    for (let seed = 1; seed <= 20; seed++) {
      const out = M.buildQuestion({ lesson: l, item: l.items[0], kind: "hear", lessons, rng: A.seededRng(seed) });
      const texts = out.choices.map((c) => c.text);
      assert.ok(texts.includes(l.items[1].ar) && texts.includes(l.items[2].ar), `seed ${seed}`);
    }
  });

  it("never offers an item from a later lesson", () => {
    for (const [idx, l] of lessons.entries()) for (const it of l.items) for (const kind of M.KINDS) {
      const out = q(l, it, kind);
      for (const c of out.choices) {
        const found = M.findItem(lessons, c.id);
        assert.ok(found && lessons.indexOf(found.lesson) <= idx, `${l.id}/${it.id}: ${c.id}`);
      }
      assert.equal(out.choices.length, 4, `${l.id}/${it.id}`);
    }
  });

  it("is repeatable with a seed and honours choiceCount", () => {
    const l = lessons[1];
    assert.deepEqual(q(l, l.items[0], "read"), q(l, l.items[0], "read"));
    assert.equal(q(l, l.items[0], "read", { choiceCount: 2 }).choices.length, 2);
  });

  it("rejects bad input", () => {
    const l = lessons[0];
    assert.throws(() => q(l, l.items[0], "spell"), RangeError);
    assert.throws(() => q(l, l.items[0], "read", { choiceCount: 1 }), RangeError);
    assert.throws(() => q({ ...l, id: "ghost" }, l.items[0], "read"), RangeError);
    assert.throws(() => q(l, lessons[1].items[0], "read"), RangeError);
  });
});
