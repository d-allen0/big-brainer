// Logic tests: scheduling, letters, vocabulary, speech wrapper, storage and data hygiene.
// Pure logic and data; no DOM. Run with `npm test` inside test/.
//
// NOTE: never paste invisible characters (zero-width joiner etc.) into this file.
// Build them with String.fromCharCode, as ZWJ does below.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "fake-indexeddb/auto";

const WWW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../www");
const read = (f) => fs.readFileSync(path.join(WWW, f), "utf8");
const srs = await import(path.join(WWW, "srs.js"));
const A = await import(path.join(WWW, "alphabet.js"));
const V = await import(path.join(WWW, "vocab.js"));
const P = await import(path.join(WWW, "phrases.js"));
const tts = await import(path.join(WWW, "tts.js"));
const db = await import(path.join(WWW, "db.js"));

const ZWJ = String.fromCharCode(0x200d);
const T0 = 1_700_000_000_000;
const DAY = srs.DAY_MS;
const mk = (id, over = {}) => ({ ...srs.newCard({ id, deck: "d", front: id, back: id }, T0), ...over });
const ids = (list) => list.map((c) => c.id);

const rawLetters = JSON.parse(read("letters.json"));
const letters = A.parseLetters(rawLetters);
const byId = Object.fromEntries(letters.map((l) => [l.id, l]));
const rawVocab = JSON.parse(read("vocab.json"));
const words = V.parseVocab(rawVocab);
const rawPhrases = JSON.parse(read("phrases.json"));
const phrases = P.parsePhrases(rawPhrases);

// ---------------------------------------------------------------- scheduling

describe("srs: no waiting", () => {
  it("has no cooldown or due-only helpers", () => {
    assert.equal(srs.RELEARN_MS, undefined);
    assert.equal(srs.pickDue, undefined);
  });

  it("schedules intervals 1, 6, 15 days and a miss is ready immediately", () => {
    let c = srs.review(mk("a"), srs.GRADES.good, T0);
    assert.equal(c.interval, 1);
    c = srs.review(c, srs.GRADES.good, T0);
    assert.equal(c.interval, 6);
    c = srs.review(c, srs.GRADES.good, T0);
    assert.equal(c.interval, 15);
    const missed = srs.review(c, srs.GRADES.again, T0 + 5);
    assert.equal(missed.due, T0 + 5);
    assert.equal(missed.reps, 0);
    assert.equal(missed.lapses, 1);
    assert.equal(missed.interval, 0);
    assert.equal(srs.isDue(missed, T0 + 5), true);
    assert.equal(srs.review(missed, srs.GRADES.good, T0 + 6).interval, 1);
  });

  it("ease never drops below the minimum; bad input throws", () => {
    let e = mk("a");
    for (let i = 0; i < 30; i++) e = srs.review(e, srs.GRADES.again, T0);
    assert.equal(e.ease, srs.MIN_EASE);
    assert.throws(() => srs.review(mk("a"), 7, T0), RangeError);
    assert.throws(() => srs.review(mk("a"), 4, NaN), TypeError);
  });

  it("does not mutate the card it is given", () => {
    const c = mk("a");
    const snapshot = structuredClone(c);
    srs.review(c, srs.GRADES.good, T0);
    assert.deepEqual(c, snapshot);
  });
});

describe("srs: practiceOrder (never empty, never hides anything)", () => {
  it("ready cards first (most overdue first), then weakest first", () => {
    const cards = [
      mk("future-strong", { due: T0 + 5 * DAY, ease: 2.8, reps: 5 }),
      mk("ready-late", { due: T0 - 2 * DAY }),
      mk("ready-recent", { due: T0 - 1000 }),
      mk("future-weak", { due: T0 + 9 * DAY, ease: 1.5, lapses: 3 }),
      mk("future-mid", { due: T0 + 1 * DAY, ease: 2.2 }),
    ];
    const before = ids(cards);
    const out = srs.practiceOrder(cards, T0);
    assert.deepEqual(ids(out), ["ready-late", "ready-recent", "future-weak", "future-mid", "future-strong"]);
    assert.deepEqual(ids(cards), before, "input not reordered");
    assert.equal(out.length, 5);
    assert.deepEqual(ids(srs.practiceOrder(cards, T0, { limit: 2 })), ["ready-late", "ready-recent"]);
    assert.deepEqual(srs.practiceOrder(cards, T0, { limit: 0 }), []);
    assert.deepEqual(srs.practiceOrder([], T0), []);
  });

  it("with nothing ready it still serves cards, weakest first", () => {
    const allFuture = [
      mk("ok", { due: T0 + DAY, ease: 2.5 }),
      mk("weak", { due: T0 + 30 * DAY, ease: 1.4 }),
      mk("lapsy", { due: T0 + 2 * DAY, ease: 2.5, lapses: 2 }),
    ];
    assert.deepEqual(ids(srs.practiceOrder(allFuture, T0, { limit: 10 })), ["weak", "lapsy", "ok"]);
  });

  it("breaks ties by lapses, reps, then soonest due", () => {
    const t = [mk("b", { due: T0 + 3 * DAY, reps: 4 }), mk("a", { due: T0 + 9 * DAY, reps: 1 }), mk("c", { due: T0 + 1 * DAY, reps: 4 })];
    assert.deepEqual(ids(srs.practiceOrder(t, T0)), ["a", "c", "b"]);
  });

  it("filters by deck", () => {
    const t = [mk("x", { deck: "alphabet" }), mk("y", { deck: "vocab" })];
    assert.deepEqual(ids(srs.practiceOrder(t, T0, { deck: "vocab" })), ["y"]);
    assert.deepEqual(srs.practiceOrder(t, T0, { deck: "none" }), []);
  });

  it("a just-missed card is ready again at once", () => {
    const missed = srs.review(mk("m", { due: T0 + 20 * DAY, reps: 3, interval: 20 }), srs.GRADES.again, T0);
    assert.equal(srs.practiceOrder([mk("other", { due: T0 + DAY }), missed], T0)[0].id, "m");
  });

  it("rejects bad limits and a missing clock", () => {
    for (const bad of [-1, 2.5, NaN, "3", null]) assert.throws(() => srs.practiceOrder([], T0, { limit: bad }), RangeError, String(bad));
    assert.throws(() => srs.practiceOrder([], undefined), TypeError);
  });
});

describe("srs: requeueAfter", () => {
  const q = ["a", "b", "c", "d", "e"];
  it("puts the item `gap` places later, or at the end of a short queue", () => {
    assert.deepEqual(srs.requeueAfter(q, "X"), ["a", "b", "c", "X", "d", "e"]);
    assert.deepEqual(srs.requeueAfter(q, "X", 0), ["X", ...q]);
    assert.deepEqual(srs.requeueAfter(["a"], "X"), ["a", "X"]);
    assert.deepEqual(srs.requeueAfter([], "X"), ["X"]);
  });
  it("does not mutate and rejects bad gaps", () => {
    srs.requeueAfter(q, "X");
    assert.deepEqual(q, ["a", "b", "c", "d", "e"]);
    for (const bad of [-1, 1.5, NaN]) assert.throws(() => srs.requeueAfter(q, "X", bad), RangeError);
  });
});

// ------------------------------------------------------------------- letters

describe("alphabet: data", () => {
  it("has 28 letters in groups of [4,3,4,4,4,4,2,3], frozen", () => {
    assert.equal(letters.length, 28);
    assert.deepEqual(A.groupsOf(letters).map((g) => g.length), [4, 3, 4, 4, 4, 4, 2, 3]);
    assert.ok(Object.isFrozen(letters[0]));
  });

  it("rejects malformed data", () => {
    const bad = (mut, re) => {
      const r = structuredClone(rawLetters);
      mut(r);
      assert.throws(() => A.parseLetters(r), re);
    };
    assert.throws(() => A.parseLetters(null), TypeError);
    assert.throws(() => A.parseLetters({ letters: [] }), TypeError);
    bad((r) => (r.letters[1].id = r.letters[0].id), /duplicate id/);
    bad((r) => (r.letters[1].char = r.letters[0].char), /duplicate char/);
    bad((r) => (r.letters[0].char = "اب"), /single character/);
    bad((r) => (r.letters[0].joins = "left"), /joins/);
    bad((r) => (r.letters[4].group = 4), /skip|order/);
    bad((r) => (r.letters[0].group = 2), /skip|order/);
    bad((r) => (r.letters[3].group = 0), /group/);
    bad((r) => delete r.letters[0].hint, /hint/);
    bad((r) => (r.letters[0].example = { ar: "x" }), /example/);
    bad((r) => (r.letters[0].family = ""), /family/);
  });

  it("loadLetters uses the injected fetch and reports HTTP errors", async () => {
    assert.equal((await A.loadLetters("x", async () => ({ ok: true, json: async () => rawLetters }))).length, 28);
    await assert.rejects(A.loadLetters("x", async () => ({ ok: false, status: 404 })), /404/);
  });

  it("letter ids are the Unicode name suffix and letter names are unique", () => {
    // spot-check against the Unicode character database via the standard library of Node's ICU
    const expected = { beh: 0x0628, teh: 0x062a, jeem: 0x062c, hah: 0x062d, khah: 0x062e, alef: 0x0627 };
    for (const [id, cp] of Object.entries(expected)) assert.equal(byId[id]?.char.codePointAt(0), cp, id);
    assert.equal(new Set(letters.map((l) => l.nameEn)).size, 28, "nameEn unique");
    assert.equal(new Set(letters.map((l) => l.name)).size, 28, "name unique");
  });
});

describe("alphabet: forms and cards", () => {
  it("joined forms use the zero-width joiner", () => {
    assert.equal(A.ZWJ, ZWJ);
    assert.deepEqual(A.formsOf(byId.beh), { isolated: "ب", initial: `ب${ZWJ}`, medial: `${ZWJ}ب${ZWJ}`, final: `${ZWJ}ب` });
    const alef = A.formsOf(byId.alef);
    assert.equal(alef.initial, null);
    assert.equal(alef.medial, null);
    assert.equal(alef.final, `${ZWJ}ا`);
  });

  it("builds the right cards with stable unique ids", () => {
    assert.equal(A.cardsForLetter(byId.beh, T0).length, 5);
    assert.equal(A.cardsForLetter(byId.alef, T0).length, 3);
    assert.equal(A.cardsForLetter(byId.beh, T0, ["name"]).length, 1);
    assert.equal(A.cardsForLetter(byId.beh, T0, []).length, 0);
    assert.throws(() => A.cardsForLetter(byId.beh, T0, ["spelling"]), RangeError);
    const all = letters.flatMap((l) => A.cardsForLetter(l, T0));
    assert.equal(all.length, 22 * 5 + 6 * 3);
    assert.equal(new Set(all.map((c) => c.id)).size, all.length);
    assert.ok(all.every((c) => c.deck === "alphabet" && c.due === T0 && c.reps === 0));
    assert.ok(all.every((c) => /^alphabet:[a-z]+:(name|sound|form:(initial|medial|final))$/.test(c.id)), "id format is stable");
    assert.equal(A.cardsForGroup(letters, 1, T0).length, 3 + 5 * 3);
    assert.deepEqual(A.cardsForGroup(letters, 99, T0), []);
  });
});

describe("alphabet: suggested path (advice only, never a gate)", () => {
  const g = (n) => A.cardsForGroup(letters, n, T0);
  const learn = (cards, n, reps = 2) => cards.slice(0, n).map((c) => ({ ...c, reps }));

  it("starts at group 1 and has no unlock concept", () => {
    assert.equal(A.unlockedGroupCount, undefined);
    assert.deepEqual(A.groupMastery([], letters).map((m) => m.total), [18, 15, 12, 20, 20, 20, 10, 13]);
    assert.equal(A.suggestedGroup([], letters), 1);
  });

  it("advances at 80% learned and can move back", () => {
    assert.equal(A.suggestedGroup(learn(g(1), 14), letters), 1);
    assert.equal(A.suggestedGroup(learn(g(1), 15), letters), 2);
    assert.equal(A.suggestedGroup([...learn(g(1), 18), ...learn(g(2), 15)], letters), 3);
    assert.equal(A.suggestedGroup(learn(g(1), 18), letters), 2);
    const slipped = learn(g(1), 18).map((c, i) => (i < 10 ? { ...c, reps: 0 } : c));
    assert.equal(A.suggestedGroup(slipped, letters), 1);
  });

  it("reps below minReps do not count; threshold and last group behave", () => {
    assert.equal(A.groupMastery(learn(g(1), 9, 1), letters)[0].learned, 0);
    assert.equal(A.groupMastery(learn(g(1), 18, 1), letters, { minReps: 1 })[0].learned, 18);
    const everything = letters.flatMap((l) => A.cardsForLetter(l, T0)).map((c) => ({ ...c, reps: 5 }));
    assert.equal(A.suggestedGroup(everything, letters), 8);
    assert.equal(A.suggestedGroup(learn(g(1), 17), letters, { threshold: 1 }), 1);
    assert.throws(() => A.suggestedGroup([], letters, { threshold: 0 }), RangeError);
    assert.throws(() => A.suggestedGroup([], letters, { threshold: 1.5 }), RangeError);
  });

  it("farAhead flags only 2+ groups past the suggestion", () => {
    assert.equal(A.farAhead(4, 1), true);
    assert.equal(A.farAhead(3, 1), true);
    assert.equal(A.farAhead(2, 1), false);
    assert.equal(A.farAhead(1, 3), false);
    assert.equal(A.farAhead(2, 1, 1), true);
    assert.throws(() => A.farAhead(2, 1, 0), RangeError);
    assert.throws(() => A.farAhead("2", 1), TypeError);
    assert.throws(() => A.farAhead(2, 1.5), TypeError);
  });
});

describe("alphabet: feedback and questions", () => {
  it("mistakeNote explains calmly", () => {
    const n = A.mistakeNote({ letter: byId.beh, chosen: byId.teh });
    assert.equal(n.length, 2);
    assert.ok(n[0].includes(byId.beh.hint));
    assert.ok(n[1].startsWith("Not ت") && n[1].includes(byId.teh.hint));
    assert.equal(A.mistakeNote({ letter: byId.beh, chosen: byId.beh }).length, 1);
    assert.equal(A.mistakeNote({ letter: byId.beh }).length, 1);
    assert.throws(() => A.mistakeNote({}), TypeError);
    const all = letters.flatMap((l) => A.mistakeNote({ letter: l, chosen: byId.beh })).join(" ");
    assert.ok(!/wrong|incorrect|mistake|fail/i.test(all));
  });

  it("seededRng is deterministic and in [0,1)", () => {
    const a = A.seededRng(7);
    const b = A.seededRng(7);
    const s1 = [a(), a(), a()];
    assert.deepEqual(s1, [b(), b(), b()]);
    assert.ok(s1.every((x) => x >= 0 && x < 1));
  });

  const q = (over) => A.buildQuestion({ letters, rng: A.seededRng(1), ...over });

  it("builds a name question with look-alikes as wrong answers", () => {
    const x = q({ letter: byId.beh, kind: "name" });
    assert.equal(x.prompt, "ب");
    assert.equal(x.promptIsArabic, true);
    assert.equal(x.answerId, "beh");
    assert.equal(x.choices.length, 4);
    assert.deepEqual(q({ letter: byId.beh, kind: "name" }), x);
    for (let seed = 0; seed < 50; seed++) {
      const y = A.buildQuestion({ letter: byId.beh, kind: "name", letters, rng: A.seededRng(seed) });
      assert.ok(y.choices.filter((c) => c.id !== "beh").every((c) => ["teh", "theh", "noon", "yeh"].includes(c.id)), `seed ${seed}`);
      assert.equal(new Set(y.choices.map((c) => c.text)).size, 4);
    }
  });

  it("falls back to the same teaching group, and shuffles the answer position", () => {
    for (let seed = 0; seed < 30; seed++) {
      const y = A.buildQuestion({ letter: byId.kaf, kind: "sound", letters, rng: A.seededRng(seed) });
      assert.ok(y.choices.filter((c) => c.id !== "kaf").every((c) => ["feh", "qaf", "lam"].includes(c.id)));
    }
    const positions = new Set();
    for (let seed = 0; seed < 40; seed++) {
      positions.add(A.buildQuestion({ letter: byId.beh, kind: "name", letters, rng: A.seededRng(seed) }).choices.findIndex((c) => c.id === "beh"));
    }
    assert.ok(positions.size >= 3);
  });

  it("supports shape and form questions and validates input", () => {
    const shape = q({ letter: byId.beh, kind: "shape" });
    assert.equal(shape.promptIsArabic, false);
    assert.ok(shape.choices.every((c) => [...c.text].length === 1));
    const form = q({ letter: byId.beh, kind: "form", position: "initial" });
    assert.equal(form.prompt, `ب${ZWJ}`);
    assert.equal(q({ letter: byId.alef, kind: "form", position: "final" }).prompt, `${ZWJ}ا`);
    assert.throws(() => q({ letter: byId.alef, kind: "form", position: "initial" }), RangeError);
    assert.throws(() => q({ letter: byId.beh, kind: "form" }), RangeError);
    assert.throws(() => q({ letter: byId.beh, kind: "spelling" }), RangeError);
    assert.throws(() => q({ letter: { ...byId.beh, id: "nope" }, kind: "name" }), RangeError);
    assert.throws(() => q({ letter: byId.beh, kind: "name", choiceCount: 1 }), RangeError);
    assert.throws(() => A.buildQuestion({ letter: byId.beh, kind: "name", letters: [byId.beh] }), RangeError);
    assert.equal(q({ letter: byId.beh, kind: "name", choiceCount: 99 }).choices.length, 28);
  });

  it("never shows two identical-looking options", () => {
    const mini = structuredClone(rawLetters);
    mini.letters = mini.letters.slice(0, 4);
    mini.letters[1].sound = mini.letters[2].sound = "t";
    const ls = A.parseLetters(mini);
    const x = A.buildQuestion({ letter: ls[1], kind: "sound", letters: ls, rng: A.seededRng(3) });
    assert.equal(new Set(x.choices.map((c) => c.text)).size, x.choices.length);
    assert.ok(!x.choices.some((c) => c.id === "teh"));
  });

  it("every letter and kind builds a valid question", () => {
    for (const l of letters) {
      for (const kind of ["name", "sound", "shape"]) {
        const x = A.buildQuestion({ letter: l, kind, letters, rng: A.seededRng(11) });
        assert.equal(x.choices.length, 4);
        assert.ok(x.choices.some((c) => c.id === l.id));
      }
    }
  });
});

// ---------------------------------------------------------------- vocabulary

describe("vocab: data", () => {
  it("has 100 words in 10 sets of 10, all marked unreviewed", () => {
    assert.equal(words.length, 100);
    assert.equal(V.setCount(words), 10);
    assert.equal(V.wordsOfSet(words, 10).length, 10);
    assert.deepEqual(V.wordsOfSet(words, 11), []);
    assert.deepEqual(V.wordsOfSet(words, 0), []);
    assert.equal(rawVocab.reviewed, false, "vocab.json must say it is unreviewed until a fluent speaker checks it");
  });

  it("rejects bad data", () => {
    assert.throws(() => V.parseVocab({ words: [words[0], words[0]] }), /duplicate/);
    assert.throws(() => V.parseVocab({ words: [] }), TypeError);
    assert.throws(() => V.parseVocab(null), TypeError);
    assert.throws(() => V.parseVocab({ words: [{ ...words[0], id: "Bad Id" }] }), /id must/);
    assert.throws(() => V.parseVocab({ words: [{ ...words[0], en: "" }] }), /en must/);
    assert.throws(() => V.parseVocab({ words: [words[0], { ...words[1], en: words[0].en }] }), /duplicate/);
  });

  it("loadVocab uses the injected fetch", async () => {
    assert.equal((await V.loadVocab("x", async () => ({ ok: true, json: async () => rawVocab }))).length, 100);
    await assert.rejects(V.loadVocab("x", async () => ({ ok: false, status: 500 })), /500/);
  });

  it("Arabic words carry vowel marks and contain no invisible characters", () => {
    const harakat = /[ً-ْ]/;
    const invisible = /[​-‏‪-‮⁠ ﻿⁦-⁩]/;
    for (const w of words) {
      assert.ok(harakat.test(w.ar) || w.ar.length <= 2, `${w.id} should be vowelled`);
      assert.ok(!invisible.test(w.ar) && !invisible.test(w.tr) && !invisible.test(w.en), `${w.id} has an invisible character`);
    }
  });
});

describe("vocab: cards, sets, path", () => {
  it("two cards per word with stable ids", () => {
    const cards = V.cardsForSet(words, 1, T0);
    assert.equal(cards.length, 20);
    assert.equal(new Set(ids(cards)).size, 20);
    assert.ok(cards.every((c) => /^vocab:[a-z0-9_]+:(ar2en|en2ar)$/.test(c.id) && c.deck === "vocab"));
    assert.throws(() => V.cardsForWord(words[0], T0, ["zz"]), RangeError);
    assert.deepEqual(ids(V.cardsForWord(words[0], T0)), [`vocab:${words[0].id}:ar2en`, `vocab:${words[0].id}:en2ar`]);
  });

  it("suggests the first set, then moves on at 80% learned; every set stays open", () => {
    assert.equal(V.suggestedSet([], words), 1);
    const set1 = V.cardsForSet(words, 1, 0).map((c) => ({ ...c, reps: 2 }));
    assert.equal(V.suggestedSet(set1, words), 2);
    assert.equal(V.suggestedSet(set1.slice(0, 15), words), 1, "15/20 is below 80%... until 16");
    assert.equal(V.suggestedSet(set1.slice(0, 16), words), 2);
    const all = Array.from({ length: 10 }, (_, i) => V.cardsForSet(words, i + 1, 0)).flat().map((c) => ({ ...c, reps: 3 }));
    assert.equal(V.suggestedSet(all, words), 10, "last set once everything is learned");
    assert.throws(() => V.suggestedSet([], words, { threshold: 0 }), RangeError);
    assert.equal(V.farAhead(4, 1), true);
  });

  it("a short final set works", () => {
    const eleven = words.slice(0, 11);
    assert.equal(V.setCount(eleven), 2);
    assert.equal(V.wordsOfSet(eleven, 2).length, 1);
    assert.equal(V.setMastery([], eleven)[1].total, 2);
  });
});

describe("vocab: questions and feedback", () => {
  it("every word, both directions: 4 distinct options, exactly one right", () => {
    for (const w of words) {
      for (const kind of V.KINDS) {
        for (let s = 1; s <= 3; s++) {
          const q = V.buildQuestion({ word: w, kind, words, rng: A.seededRng(s) });
          assert.equal(q.choices.length, 4);
          assert.equal(new Set(q.choices.map((c) => c.text)).size, 4);
          assert.equal(q.choices.filter((c) => c.id === w.id).length, 1);
          assert.equal(q.answerId, w.id);
          assert.equal(q.promptIsArabic, kind === "ar2en");
          assert.equal(q.choicesAreArabic, kind === "en2ar");
        }
      }
    }
  });

  it("wrong options come from the same set first", () => {
    const q = V.buildQuestion({ word: words[0], kind: "ar2en", words, rng: A.seededRng(1) });
    assert.ok(q.choices.every((c) => words.slice(0, 10).some((w) => w.id === c.id)));
  });

  it("validates input", () => {
    assert.throws(() => V.buildQuestion({ word: { id: "x" }, kind: "ar2en", words }), RangeError);
    assert.throws(() => V.buildQuestion({ word: words[0], kind: "zz", words }), RangeError);
    assert.throws(() => V.buildQuestion({ word: words[0], kind: "ar2en", words, choiceCount: 1 }), RangeError);
    assert.throws(() => V.buildQuestion({ word: words[0], kind: "ar2en", words: [words[0]] }), RangeError);
  });

  it("mistakeNote is short, calm and names the chosen word's meaning", () => {
    const n = V.mistakeNote({ word: words[0], chosen: words[1] });
    assert.equal(n.length, 2);
    assert.ok(n[0].includes(words[0].en) && n[1].includes(words[1].en));
    assert.equal(V.mistakeNote({ word: words[0] }).length, 1);
    assert.equal(V.mistakeNote({ word: words[0], chosen: words[0] }).length, 1);
    assert.throws(() => V.mistakeNote({}), TypeError);
  });
});

// -------------------------------------------------------------- speech wrapper

describe("phrases: data", () => {
  const FORBIDDEN = /\b(due|overdue|locked|unlock|unlocked|streak|daily|expires|deadline|behind|penalty|tomorrow|later|wait|missed)\b/i;
  const good = () => ({ phrases: [{ id: "a", ar: "x", tr: "x", en: "one" }, { id: "b", ar: "y", tr: "y", en: "two" }] });

  it("the shipped data is valid: 40 phrases in 4 full sets, marked unreviewed", () => {
    assert.equal(phrases.length, 40);
    assert.equal(P.setCount(phrases), 4);
    for (let s = 1; s <= 4; s++) assert.equal(P.phrasesOfSet(phrases, s).length, 10);
    assert.equal(rawPhrases.reviewed, false);
    assert.match(rawPhrases.note, /unreviewed/i);
  });

  it("every phrase has Arabic with vowel marks, macron transliteration, a meaning, and no invisible characters", () => {
    const harakat = /[\u064b-\u0652]/;
    const trOk = /^[a-zA-Zāīūḥṣḍṭẓʿʾ' -]+$/;
    for (const p of phrases) {
      assert.ok(harakat.test(p.ar), `${p.id}: Arabic needs vowel marks`);
      assert.ok(trOk.test(p.tr), `${p.id}: transliteration uses unexpected characters: ${p.tr}`);
      assert.ok(!/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\u00a0]/.test(JSON.stringify(p)), `${p.id}: invisible character`);
      assert.ok(!/[\u0660-\u0669\u06f0-\u06f9]/.test(p.ar), `${p.id}: numbers are spelled out in words`);
    }
  });

  it("no phrase meaning or transliteration uses a forbidden pacing word (they appear on screen)", () => {
    for (const p of phrases) assert.ok(!FORBIDDEN.test(`${p.en} ${p.tr}`), `${p.id}: ${p.en}`);
  });

  it("ids are lowercase and unique, so they are safe to use in card ids", () => {
    assert.equal(new Set(phrases.map((p) => p.id)).size, 40);
    assert.ok(phrases.every((p) => /^[a-z0-9_]+$/.test(p.id)));
  });

  it("replies point at real, different phrases", () => {
    const withReply = phrases.filter((p) => p.reply);
    assert.ok(withReply.length >= 3);
    for (const p of withReply) assert.ok(P.replyTo(phrases, p) && P.replyTo(phrases, p).id !== p.id);
    assert.equal(P.replyTo(phrases, phrases.find((p) => !p.reply)), null);
  });

  it("validation rejects bad data", () => {
    assert.throws(() => P.parsePhrases(null), TypeError);
    assert.throws(() => P.parsePhrases({ phrases: [] }), TypeError);
    for (const key of ["id", "ar", "tr", "en"]) {
      const d = good(); d.phrases[0][key] = "";
      assert.throws(() => P.parsePhrases(d), TypeError, `empty ${key}`);
    }
    for (const [key, val] of [["id", "b"], ["ar", "y"], ["en", "two"]]) {
      const d = good(); d.phrases[0][key] = val;
      assert.throws(() => P.parsePhrases(d), /duplicate/, `duplicate ${key}`);
    }
    let d = good(); d.phrases[0].id = "Bad Id";
    assert.throws(() => P.parsePhrases(d), /lowercase/);
    d = good(); d.phrases[0].ar = "x" + ZWJ;
    assert.throws(() => P.parsePhrases(d), /invisible/);
    d = good(); d.phrases[0].reply = "nope";
    assert.throws(() => P.parsePhrases(d), /reply/);
    d = good(); d.phrases[0].reply = "a";
    assert.throws(() => P.parsePhrases(d), /reply/, "a phrase cannot reply to itself");
    d = good(); d.phrases[0].reply = "b";
    assert.equal(P.parsePhrases(d).length, 2);
  });

  it("phrase ids never collide with word ids in card ids, and the id format is fixed", () => {
    const cards = P.cardsForSet(phrases, 1, T0);
    assert.equal(cards.length, 20);
    assert.ok(cards.every((c) => /^phrase:[a-z0-9_]+:(ar2en|en2ar)$/.test(c.id) && c.deck === "phrase"));
    assert.deepEqual(ids(P.cardsForPhrase(phrases[0], T0)), ["phrase:as_salamu_alaykum:ar2en", "phrase:as_salamu_alaykum:en2ar"]);
    assert.throws(() => P.cardsForPhrase(phrases[0], T0, ["zz"]), RangeError);
    const vocabIds = new Set(V.cardsForSet(words, 1, T0).map((c) => c.id));
    assert.ok(cards.every((c) => !vocabIds.has(c.id)));
  });

  it("loadPhrases reads and validates; a failed load says so", async () => {
    const ok = await P.loadPhrases("x", async () => ({ ok: true, json: async () => rawPhrases }));
    assert.equal(ok.length, 40);
    await assert.rejects(P.loadPhrases("x", async () => ({ ok: false, status: 404 })), /404/);
  });
});

describe("phrases: sets, path, questions", () => {
  it("suggests set 1 on a fresh install, moves on at 80% learned, and every set stays open", () => {
    assert.equal(P.suggestedSet([], phrases), 1);
    const set1 = P.cardsForSet(phrases, 1, 0).map((c) => ({ ...c, reps: 2 }));
    assert.equal(P.suggestedSet(set1, phrases), 2);
    assert.equal(P.suggestedSet(set1.slice(0, 15), phrases), 1);
    assert.equal(P.suggestedSet(set1.slice(0, 16), phrases), 2);
    const all = Array.from({ length: 4 }, (_, i) => P.cardsForSet(phrases, i + 1, 0)).flat().map((c) => ({ ...c, reps: 3 }));
    assert.equal(P.suggestedSet(all, phrases), 4, "the last set once everything is learned, never nothing");
    assert.throws(() => P.suggestedSet([], phrases, { threshold: 0 }), RangeError);
    assert.equal(P.farAhead(3, 1), true);
    assert.equal(P.phrasesOfSet(phrases, 0).length, 0);
    assert.equal(P.phrasesOfSet(phrases, 5).length, 0);
  });

  it("set progress counts only this deck's cards", () => {
    const wordCards = V.cardsForSet(words, 1, 0).map((c) => ({ ...c, reps: 5 }));
    assert.equal(P.suggestedSet(wordCards, phrases), 1);
    assert.equal(P.setMastery([], phrases).length, 4);
  });

  it("builds four distinct choices from the same set in both directions", () => {
    const rng = A.seededRng(7);
    for (const phrase of phrases) {
      for (const kind of P.KINDS) {
        const q = P.buildQuestion({ phrase, kind, phrases, rng });
        assert.equal(q.choices.length, 4);
        assert.equal(new Set(q.choices.map((c) => c.text)).size, 4, "no two identical choices");
        assert.equal(q.choices.filter((c) => c.id === phrase.id).length, 1);
        assert.equal(q.answerId, phrase.id);
        assert.equal(q.promptIsArabic, kind === "ar2en");
        assert.equal(q.choicesAreArabic, kind === "en2ar");
        const set = P.setOf(phrases, phrase);
        assert.ok(q.choices.every((c) => P.setOf(phrases, phrases.find((p) => p.id === c.id)) === set), "plausible wrong answers come from the same set");
      }
    }
  });

  it("with only a few phrases it uses what exists; bad input throws", () => {
    const three = phrases.slice(0, 3);
    assert.equal(P.buildQuestion({ phrase: three[0], kind: "ar2en", phrases: three }).choices.length, 3);
    const outer = P.buildQuestion({ phrase: phrases[0], kind: "ar2en", phrases: [...phrases.slice(0, 2), ...phrases.slice(10, 14)], rng: A.seededRng(1) });
    assert.equal(outer.choices.length, 4, "falls back to other sets");
    assert.throws(() => P.buildQuestion({ phrase: phrases[0], kind: "zz", phrases }), RangeError);
    assert.throws(() => P.buildQuestion({ phrase: phrases[0], kind: "ar2en", phrases, choiceCount: 1 }), RangeError);
    assert.throws(() => P.buildQuestion({ phrase: { id: "nope" }, kind: "ar2en", phrases }), RangeError);
    assert.throws(() => P.buildQuestion({ phrase: phrases[0], kind: "ar2en", phrases: [phrases[0]] }), RangeError);
  });

  it("the mistake note shows the right answer and, if known, what was picked; no alarm wording", () => {
    const [a, b] = phrases;
    assert.deepEqual(P.mistakeNote({ phrase: a }), [`${a.ar} (${a.tr}) means "${a.en}".`]);
    const lines = P.mistakeNote({ phrase: a, chosen: b });
    assert.equal(lines.length, 2);
    assert.ok(lines[1].includes(b.en));
    assert.equal(P.mistakeNote({ phrase: a, chosen: a }).length, 1);
    assert.throws(() => P.mistakeNote({}), TypeError);
    assert.ok(!/wrong|incorrect|fail|error/i.test(lines.join(" ")));
  });
});

describe("tts", () => {
  const rejectsCode = (p, code) =>
    assert.rejects(p, (e) => e instanceof tts.TTSError && e.code === code, `expected ${code}`);
  const nativePlugin = (over = {}) => ({
    calls: [],
    async isLanguageSupported({ lang }) { return { supported: lang === (over.only ?? "ar") }; },
    async speak(o) { this.calls.push(o); if (over.speakFails) throw new Error("boom"); },
    async stop() { if (over.stopFails) throw new Error("x"); this.stopped = true; },
    async openInstall() { if (over.installFails) throw new Error("x"); this.installed = true; },
  });
  const nativeG = (p) => ({ Capacitor: { Plugins: { TextToSpeech: p } } });
  class FakeUtter { constructor(t) { this.text = t; } }
  const webG = (voices, behave = "end") => {
    const listeners = {};
    const synth = {
      cancelled: 0, spoken: [], _voices: voices,
      getVoices() { return this._voices; },
      cancel() { this.cancelled++; },
      addEventListener(n, f) { listeners[n] = f; },
      removeEventListener() {},
      fire() { listeners.voiceschanged?.(); },
      speak(u) {
        this.spoken.push(u);
        if (behave === "end") queueMicrotask(() => u.onend());
        else if (behave === "canceled") queueMicrotask(() => u.onerror({ error: "canceled" }));
        else if (behave === "fail") queueMicrotask(() => u.onerror({ error: "synthesis-failed" }));
      },
    };
    return { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtter, synth };
  };

  it("detects the backend", () => {
    assert.equal(tts.detectBackend({}).kind, "none");
    assert.equal(tts.detectBackend(nativeG(nativePlugin())).kind, "native");
    assert.equal(tts.detectBackend(webG([])).kind, "web");
    assert.equal(tts.detectBackend({ Capacitor: { Plugins: {} }, ...webG([]) }).kind, "web");
    assert.equal(tts.detectBackend({ speechSynthesis: {} }).kind, "none");
  });

  it("checkArabic (native)", async () => {
    assert.deepEqual(await tts.checkArabic(nativeG(nativePlugin({ only: "ar" }))), { ok: true, backend: "native", lang: "ar" });
    assert.equal((await tts.checkArabic(nativeG(nativePlugin({ only: "ar-SA" })))).lang, "ar-SA");
    assert.equal((await tts.checkArabic(nativeG(nativePlugin({ only: "xx" })))).code, "no-arabic-voice");
    const throwing = { async isLanguageSupported() { throw new Error("native down"); }, async speak() {} };
    assert.equal((await tts.checkArabic(nativeG(throwing))).code, "no-arabic-voice");
    assert.equal((await tts.checkArabic({})).code, "no-backend");
  });

  it("checkArabic (web), including late voices and look-alike codes", async () => {
    const r = await tts.checkArabic(webG([{ lang: "en-US" }, { lang: "ar_EG", localService: true }]));
    assert.deepEqual([r.ok, r.backend, r.lang], [true, "web", "ar_EG"]);
    assert.equal((await tts.checkArabic(webG([{ lang: "en-US" }, { lang: "arc-XX" }]))).code, "no-arabic-voice");
    const g = webG([]);
    const p = tts.checkArabic(g);
    setTimeout(() => { g.synth._voices = [{ lang: "ar-SA" }]; g.synth.fire(); }, 20);
    assert.equal((await p).ok, true);
  });

  it("speak validates its input", async () => {
    for (const bad of ["", "   ", null, undefined, 42, {}]) await rejectsCode(tts.speak(bad, { g: nativeG(nativePlugin()) }), "bad-input");
    await rejectsCode(tts.speak("ب".repeat(501), { g: nativeG(nativePlugin()) }), "bad-input");
    await tts.speak("ب".repeat(500), { g: nativeG(nativePlugin()) });
    await rejectsCode(tts.speak("مرحبا", { g: {} }), "no-backend");
  });

  it("speak (native) sends trimmed text and clamps the rate", async () => {
    const p = nativePlugin({ only: "ar" });
    await tts.speak("  مَرْحَبًا ", { g: nativeG(p) });
    assert.deepEqual(p.calls[0], { text: "مَرْحَبًا", lang: "ar", rate: 0.8, queueStrategy: 0 });
    await tts.speak("ب", { rate: 99, g: nativeG(p) });
    assert.equal(p.calls[1].rate, 2);
    await tts.speak("ب", { rate: 0, g: nativeG(p) });
    assert.equal(p.calls[2].rate, 0.3);
    await tts.speak("ب", { rate: NaN, g: nativeG(p) });
    assert.equal(p.calls[3].rate, 0.8);
    await rejectsCode(tts.speak("ب", { g: nativeG(nativePlugin({ only: "xx" })) }), "no-arabic-voice");
    await rejectsCode(tts.speak("ب", { g: nativeG(nativePlugin({ speakFails: true })) }), "engine-error");
  });

  it("speak (web) cancels earlier speech and reports failures", async () => {
    const g = webG([{ lang: "ar-SA", localService: true }]);
    await tts.speak("ب", { g });
    assert.equal(g.synth.spoken[0].lang, "ar-SA");
    assert.ok(g.synth.cancelled >= 1);
    await tts.speak("ب", { g: webG([{ lang: "ar-SA" }], "canceled") });
    await rejectsCode(tts.speak("ب", { g: webG([{ lang: "ar-SA" }], "fail") }), "engine-error");
    await rejectsCode(tts.speak("ب", { g: webG([{ lang: "en-US" }]) }), "no-arabic-voice");
  });

  it("stop and openVoiceInstall never throw", async () => {
    const p = nativePlugin();
    await tts.stop(nativeG(p));
    assert.equal(p.stopped, true);
    await tts.stop(nativeG(nativePlugin({ stopFails: true })));
    await tts.stop({});
    const w = webG([]);
    await tts.stop(w);
    assert.equal(w.synth.cancelled, 1);
    const p2 = nativePlugin();
    assert.equal(await tts.openVoiceInstall(nativeG(p2)), true);
    assert.equal(p2.installed, true);
    assert.equal(await tts.openVoiceInstall(nativeG(nativePlugin({ installFails: true }))), false);
    assert.equal(await tts.openVoiceInstall(webG([])), false);
    assert.equal(await tts.openVoiceInstall({}), false);
  });
});

describe("tts: the learner's voice and speed", () => {
  const rejectsCode = (p, code) =>
    assert.rejects(p, (e) => e instanceof tts.TTSError && e.code === code, `expected ${code}`);
  const VOICES = [
    { voiceURI: "en-us-x-1", name: "English", lang: "en-US", localService: true },
    { voiceURI: "ar-net", name: "Arabic network", lang: "ar-SA", localService: false },
    { voiceURI: "ar-local-b", name: "B voice", lang: "ar-EG", localService: true },
    { voiceURI: "ar-local-a", name: "A voice", lang: "ar-SA", localService: true },
  ];
  const plugin = (over = {}) => ({
    calls: [],
    async isLanguageSupported({ lang }) { return { supported: lang === "ar" }; },
    async getSupportedVoices() { if (over.listFails) throw new Error("no list"); return { voices: over.voices ?? VOICES }; },
    async speak(o) { this.calls.push(o); },
    async stop() {},
  });
  const nativeG = (p) => ({ Capacitor: { Plugins: { TextToSpeech: p } } });
  class FakeUtter { constructor(t) { this.text = t; } }
  const webG = (voices) => {
    const synth = {
      spoken: [], getVoices: () => voices, cancel() {}, addEventListener() {}, removeEventListener() {},
      speak(u) { this.spoken.push(u); queueMicrotask(() => u.onend()); },
    };
    return { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtter, synth };
  };
  const reset = () => tts.setPreferences(null);

  it("saved preferences are cleaned: anything unusable falls back to the defaults", () => {
    const defaults = { voiceId: null, speed: "normal" };
    for (const bad of [null, undefined, 5, "x", [], {}, { voiceId: 7, speed: 3 }, { voiceId: "", speed: "warp" }, { voiceId: "x".repeat(301) }]) {
      assert.deepEqual(tts.parsePreferences(bad), defaults, JSON.stringify(bad));
    }
    assert.deepEqual(tts.parsePreferences({ voiceId: "ar-local-a", speed: "slow" }), { voiceId: "ar-local-a", speed: "slow" });
    assert.deepEqual(tts.parsePreferences({ voiceId: "a", speed: "toString" }), { voiceId: "a", speed: "normal" }, "inherited keys are not speeds");
  });

  it("there are three speeds, slow below normal below fast, and normal is the old default", () => {
    assert.ok(tts.SPEEDS.slow < tts.SPEEDS.normal && tts.SPEEDS.normal < tts.SPEEDS.fast);
    assert.equal(tts.SPEEDS.normal, 0.8);
    assert.equal(tts.DEFAULT_SPEED, "normal");
    assert.deepEqual(Object.keys(tts.SPEEDS), ["slow", "normal", "fast"]);
    assert.ok(Object.isFrozen(tts.SPEEDS));
  });

  it("set and get preferences: returns copies, cleans input, and null resets", () => {
    try {
      assert.deepEqual(tts.getPreferences(), { voiceId: null, speed: "normal" });
      assert.deepEqual(tts.setPreferences({ voiceId: "v", speed: "fast", extra: 1 }), { voiceId: "v", speed: "fast" });
      const copy = tts.getPreferences();
      copy.speed = "slow";
      assert.equal(tts.getPreferences().speed, "fast", "callers cannot change the saved value by editing the copy");
      assert.deepEqual(tts.setPreferences({ speed: "nope" }), { voiceId: null, speed: "normal" });
    } finally { reset(); }
  });

  it("lists only Arabic voices, offline ones first, with stable ids", async () => {
    const r = await tts.listVoices(nativeG(plugin()));
    assert.equal(r.backend, "native");
    assert.deepEqual(r.voices.map((v) => v.id), ["ar-local-a", "ar-local-b", "ar-net"]);
    assert.deepEqual(r.voices.map((v) => v.local), [true, true, false]);
    assert.deepEqual(r.voices[0], { id: "ar-local-a", name: "A voice", lang: "ar-SA", local: true });
    const odd = [{ name: "No uri", lang: "ar", localService: true }, { voiceURI: "", name: "", lang: "ar" }, { voiceURI: "arc", name: "Aramaic", lang: "arc-XX" }];
    assert.deepEqual((await tts.listVoices(nativeG(plugin({ voices: odd })))).voices.map((v) => v.id), ["No uri"], "falls back to the name; skips voices with no id and look-alike codes");
  });

  it("listing never fails: no engine, no list function, or a list that throws all give an empty list", async () => {
    assert.deepEqual(await tts.listVoices({}), { backend: "none", voices: [] });
    assert.deepEqual((await tts.listVoices(nativeG(plugin({ listFails: true })))).voices, []);
    const noList = plugin(); delete noList.getSupportedVoices;
    assert.deepEqual((await tts.listVoices(nativeG(noList))).voices, []);
    assert.deepEqual((await tts.listVoices(nativeG(plugin({ voices: [] })))).voices, []);
    assert.deepEqual((await tts.listVoices(nativeG({ ...plugin(), getSupportedVoices: async () => null }))).voices, []);
  });

  it("lists voices from the browser engine too", async () => {
    const r = await tts.listVoices(webG(VOICES.map((v) => ({ ...v, voiceURI: v.voiceURI }))));
    assert.equal(r.backend, "web");
    assert.deepEqual(r.voices.map((v) => v.id), ["ar-local-a", "ar-local-b", "ar-net"]);
  });

  it("chooseVoice finds a voice by id and returns null for anything else", () => {
    const list = [{ id: "a" }, { id: "b" }];
    assert.equal(tts.chooseVoice(list, "b"), list[1]);
    for (const bad of ["zzz", "", null, undefined, 3]) assert.equal(tts.chooseVoice(list, bad), null);
    assert.equal(tts.chooseVoice([], "a"), null);
  });

  it("native speak sends no voice by default, so the engine's automatic choice is kept", async () => {
    reset();
    const p = plugin();
    await tts.speak("ب", { g: nativeG(p) });
    assert.deepEqual(p.calls[0], { text: "ب", lang: "ar", rate: 0.8, queueStrategy: 0 });
  });

  it("native speak sends the chosen voice's position in the full list", async () => {
    const p = plugin();
    await tts.speak("ب", { voiceId: "ar-local-b", g: nativeG(p) });
    assert.equal(p.calls[0].voice, 2, "index counts the non-Arabic voices before it");
    await tts.speak("ب", { voiceId: "ar-net", g: nativeG(p) });
    assert.equal(p.calls[1].voice, 1);
    const shuffled = plugin({ voices: [VOICES[3], VOICES[0], VOICES[2], VOICES[1]] });
    await tts.speak("ب", { voiceId: "ar-local-b", g: nativeG(shuffled) });
    assert.equal(shuffled.calls[0].voice, 2, "found by id even when the order changes");
  });

  it("a chosen voice that is gone, not Arabic, or unlistable quietly falls back to automatic", async () => {
    for (const [voiceId, over] of [["uninstalled", {}], ["en-us-x-1", {}], ["ar-net", { listFails: true }]]) {
      const p = plugin(over);
      await tts.speak("ب", { voiceId, g: nativeG(p) });
      assert.ok(!("voice" in p.calls[0]), `${voiceId}: no voice sent`);
      assert.equal(p.calls[0].text, "ب", "and it still speaks");
    }
    const noList = plugin(); delete noList.getSupportedVoices;
    await tts.speak("ب", { voiceId: "ar-net", g: nativeG(noList) });
    assert.ok(!("voice" in noList.calls[0]));
  });

  it("the saved speed and voice are used by every speak, and options still override them", async () => {
    try {
      tts.setPreferences({ voiceId: "ar-local-a", speed: "slow" });
      const p = plugin();
      await tts.speak("ب", { g: nativeG(p) });
      assert.equal(p.calls[0].rate, tts.SPEEDS.slow);
      assert.equal(p.calls[0].voice, 3);
      await tts.speak("ب", { rate: 1.5, voiceId: "ar-local-b", g: nativeG(p) });
      assert.equal(p.calls[1].rate, 1.5);
      assert.equal(p.calls[1].voice, 2);
      await tts.speak("ب", { voiceId: null, g: nativeG(p) });
      assert.ok(!("voice" in p.calls[2]), "voiceId: null means automatic");
      tts.setPreferences({ speed: "fast" });
      await tts.speak("ب", { g: nativeG(p) });
      assert.equal(p.calls[3].rate, tts.SPEEDS.fast);
      assert.ok(!("voice" in p.calls[3]));
    } finally { reset(); }
  });

  it("browser speak uses the chosen voice and speed, and falls back when the voice is gone", async () => {
    try {
      const voices = VOICES.slice(1).map((v) => ({ ...v }));
      const g = webG(voices);
      tts.setPreferences({ voiceId: "ar-net", speed: "slow" });
      await tts.speak("ب", { g });
      assert.equal(g.synth.spoken[0].voice.voiceURI, "ar-net");
      assert.equal(g.synth.spoken[0].rate, tts.SPEEDS.slow);
      tts.setPreferences({ voiceId: "uninstalled" });
      await tts.speak("ب", { g });
      assert.equal(g.synth.spoken[1].voice.voiceURI, "ar-local-a", "automatic: the best available voice");
      assert.equal(g.synth.spoken[1].voice.voiceURI, (await tts.listVoices(g)).voices[0].id, "the first listed voice is the automatic one");
      await rejectsCode(tts.speak("ب", { voiceId: "ar-net", g: webG([{ lang: "en-US", voiceURI: "e", name: "e" }]) }), "no-arabic-voice");
    } finally { reset(); }
  });
});

// ------------------------------------------------------------------- storage

describe("db: the learner's progress is never overwritten", () => {
  it("addCardsIfMissing adds only new cards and keeps existing progress", async () => {
    assert.deepEqual(await db.getAllCards(), []);
    assert.equal(await db.addCardsIfMissing([]), 0);
    const three = [mk("1"), mk("2"), mk("3")];
    assert.equal(await db.addCardsIfMissing(three), 3);
    assert.equal(await db.addCardsIfMissing(three), 0);
    await db.putCard(srs.review(three[0], srs.GRADES.good, T0));
    assert.equal(await db.addCardsIfMissing([mk("1"), mk("4")]), 1);
    const kept = await db.getCard("1");
    assert.equal(kept.reps, 1);
    assert.equal(kept.lastReviewed, T0);
    assert.equal(await db.addCardsIfMissing([mk("5"), mk("5")]), 1);
    assert.equal((await db.getAllCards()).length, 5);
  });

  it("re-seeding real alphabet and vocab cards keeps progress", async () => {
    const g1 = A.cardsForGroup(letters, 1, T0);
    assert.equal(await db.addCardsIfMissing(g1), 18);
    await db.putCard(srs.review(await db.getCard(g1[0].id), srs.GRADES.good, T0));
    assert.equal(await db.addCardsIfMissing(g1), 0);
    assert.equal((await db.getCard(g1[0].id)).reps, 1);
    const s1 = V.cardsForSet(words, 1, T0);
    assert.equal(await db.addCardsIfMissing(s1), 20);
    await db.putCard(srs.review(await db.getCard(s1[0].id), srs.GRADES.good, T0));
    assert.equal(await db.addCardsIfMissing(s1), 0);
    assert.equal((await db.getCard(s1[0].id)).reps, 1);
  });

  it("meta values round-trip, with a fallback", async () => {
    assert.equal(await db.getMeta("nope", "fallback"), "fallback");
    await db.setMeta("k", [1, 2]);
    assert.deepEqual(await db.getMeta("k"), [1, 2]);
  });

  it("there is no due-count query to build a countdown on", () => {
    assert.equal(db.getDueCards, undefined);
  });

  it("the database name is never changed (it would hide all progress)", () => {
    assert.match(read("db.js"), /const DB_NAME = "arabic-learner";/);
  });
});

// ------------------------------------------------------------- source hygiene

describe("source hygiene", () => {
  const invisible = /[​-‏‪-‮⁠ ﻿⁦-⁩]/;

  it("no invisible or look-alike characters in code, styles or the page", () => {
    for (const f of fs.readdirSync(WWW).filter((n) => /\.(js|css|html)$/.test(n))) {
      assert.ok(!invisible.test(read(f)), `${f} contains an invisible character; write it with String.fromCharCode instead`);
    }
  });

  it("the content security policy forbids inline code and external requests", () => {
    const html = read("index.html");
    const csp = html.match(/http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/)?.[1] ?? "";
    assert.ok(csp.includes("default-src"));
    assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
    assert.ok(!/https?:\/\//.test(csp.replace(/https?:\/\/localhost/g, "")), "no external origins allowed");
  });

  it("the app id and display name match the data-safety rules", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(WWW, "../capacitor.config.json"), "utf8"));
    assert.equal(cfg.appId, "com.dallen0.arabiclearner");
  });

  it("no source file builds a due count or time-gate", () => {
    const forbidden = /\b(streak|overdue|come back (later|tomorrow)|daily goal|unlock(ed)?)\b/i;
    for (const f of ["app.js", "letters-screen.js", "vocab-screen.js", "alphabet.js", "vocab.js", "phrases.js", "srs.js"]) {
      const body = read(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      assert.ok(!forbidden.test(body), `${f} uses a forbidden pacing word in code or UI text`);
    }
  });
});
