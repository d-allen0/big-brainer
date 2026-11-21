// Texts logic tests: validation, the shipped data, the suggested text, and the question.
// Pure logic; no DOM. Never paste invisible characters here; use String.fromCharCode.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WWW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../www");
const read = (f) => fs.readFileSync(path.join(WWW, f), "utf8");
const X = await import(path.join(WWW, "texts.js"));
const A = await import(path.join(WWW, "alphabet.js"));

const raw = JSON.parse(read("texts.json"));
const texts = X.parseTexts(raw);
const ZWJ = String.fromCharCode(0x200d);
const copy = () => structuredClone(raw);
const bad = (mutate, pattern) => {
  const r = copy();
  mutate(r.texts);
  assert.throws(() => X.parseTexts(r), pattern);
};

describe("texts: the shipped data", () => {
  it("has 12 texts in 3 levels, easiest first, 4 per level", () => {
    assert.equal(texts.length, 12);
    assert.deepEqual(texts.map((t) => t.level), [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
  });

  it("is marked unreviewed, since Claude wrote it", () => {
    assert.equal(raw.reviewed, false);
    assert.match(raw.note, /unreviewed/i);
  });

  it("every sentence has vowel marks, a transliteration and a meaning, and no invisible characters", () => {
    for (const t of texts) for (const s of t.sentences) {
      assert.match(s.ar, /[ً-ْ]/, s.ar);
      assert.ok(s.tr.length > 0 && s.en.length > 0);
    }
    assert.ok(!/[​-‏‪-‮⁦-⁩﻿ ]/.test(read("texts.json")), "no invisible characters in the file");
    assert.ok(!read("texts.json").includes(ZWJ));
  });

  it("Arabic sentences contain only Arabic letters, marks, spaces and . ، ؟", () => {
    for (const t of texts) for (const s of t.sentences) assert.match(s.ar, /^[ء-يً-ْٰ .،؟]+$/, s.ar);
  });

  it("the right option is listed first in the file and every question has 3 or 4 different options", () => {
    for (const t of texts) {
      assert.equal(t.question.answer, 0);
      assert.ok(t.question.options.length >= 3 && new Set(t.question.options).size === t.question.options.length);
      assert.ok(t.question.note.length > 0);
    }
  });

  it("does not use the forbidden wording anywhere a learner can see it", () => {
    const words = /\b(due|overdue|locked|unlock|streak|daily|expires|deadline|behind|missed|penalty|tomorrow|later|wait)\b/i;
    for (const t of texts) {
      const shown = [t.title, t.question.prompt, t.question.note, ...t.question.options, ...t.sentences.map((s) => s.en)].join(" ");
      assert.ok(!words.test(shown), t.id);
    }
  });
});

describe("texts: validation", () => {
  it("accepts the shipped data and refuses an empty or missing list", () => {
    assert.equal(X.parseTexts(copy()).length, 12);
    assert.throws(() => X.parseTexts(null), TypeError);
    assert.throws(() => X.parseTexts({ texts: [] }), TypeError);
    assert.throws(() => X.parseTexts({}), TypeError);
  });

  it("refuses duplicate ids and titles, bad ids and a missing title", () => {
    bad((t) => { t[1].id = t[0].id; }, /duplicate/);
    bad((t) => { t[1].title = t[0].title; }, /duplicate/);
    bad((t) => { t[0].id = "Bad Id"; }, /lowercase/);
    bad((t) => { t[0].title = ""; }, /title/);
  });

  it("refuses the wrong number of sentences for a level, and a bad level", () => {
    bad((t) => { t[0].sentences.push({ ...t[0].sentences[0] }); }, /level 1 needs 1/);
    bad((t) => { t[4].sentences = [t[4].sentences[0]]; }, /level 2 needs 2 to 3/);
    bad((t) => { t[8].sentences = t[8].sentences.slice(0, 3); }, /level 3 needs 4 to 6/);
    bad((t) => { t[0].level = 9; }, /level must be/);
  });

  it("refuses texts out of order (hard before easy)", () => {
    bad((t) => { [t[0], t[11]] = [t[11], t[0]]; }, /easiest level first/);
  });

  it("refuses a sentence with no vowel marks, an empty field or an invisible character", () => {
    bad((t) => { t[0].sentences[0].ar = "هذا بيت كبير."; }, /vowel marks/);
    bad((t) => { t[0].sentences[0].tr = ""; }, /tr must be/);
    bad((t) => { t[0].sentences[0].en = "A big" + String.fromCharCode(0x200e) + " house."; }, /invisible/);
    bad((t) => { t[0].sentences[0].ar += ZWJ; }, /invisible/);
  });

  it("refuses a question with too few options, a duplicate option, or an answer outside the options", () => {
    bad((t) => { t[0].question.options = ["a", "b"]; }, /3 or 4/);
    bad((t) => { t[0].question.options = ["a", "b", "c", "d", "e"]; }, /3 or 4/);
    bad((t) => { t[0].question.options = ["a", "a", "c"]; }, /duplicate/);
    bad((t) => { t[0].question.answer = 4; }, /answer/);
    bad((t) => { t[0].question.answer = -1; }, /answer/);
    bad((t) => { t[0].question.prompt = ""; }, /prompt/);
    bad((t) => { t[0].question.note = ""; }, /note/);
    bad((t) => { delete t[0].question; }, /question/);
  });
});

describe("texts: lookup, levels and the suggested text", () => {
  it("findText returns the text, or null for an unknown id", () => {
    assert.equal(X.findText(texts, "my_family").title, "My family");
    assert.equal(X.findText(texts, "nope"), null);
    assert.equal(X.findText(texts, undefined), null);
  });

  it("byLevel groups in order and levelLabel is only a label", () => {
    const groups = X.byLevel(texts);
    assert.deepEqual(groups.map((g) => [g.level, g.texts.length]), [[1, 4], [2, 4], [3, 4]]);
    assert.equal(X.levelLabel(2), "Level 2");
    assert.deepEqual(X.byLevel([]), []);
  });

  it("suggests the first unopened text, starts over when all are opened, and is never empty", () => {
    assert.equal(X.suggestedText(texts, []).id, texts[0].id);
    assert.equal(X.suggestedText(texts, [texts[0].id, texts[1].id]).id, texts[2].id);
    assert.equal(X.suggestedText(texts, ["nope"]).id, texts[0].id);
    assert.equal(X.suggestedText(texts, texts.map((t) => t.id)).id, texts[0].id);
    assert.equal(X.suggestedText(texts, null).id, texts[0].id);
    assert.equal(X.suggestedText(texts, "garbage").id, texts[0].id);
    assert.equal(X.suggestedText([], []), null);
  });

  it("any text can be opened first: opening a level 3 text moves only the marker", () => {
    const opened = X.markOpened(texts, [], "new_book");
    assert.deepEqual(opened, ["new_book"]);
    assert.equal(X.suggestedText(texts, opened).id, texts[0].id);
  });

  it("markOpened adds without duplicates and ignores unknown ids and bad input", () => {
    assert.deepEqual(X.markOpened(texts, ["big_house"], "big_house"), ["big_house"]);
    assert.deepEqual(X.markOpened(texts, ["big_house", "gone"], "cold_water"), ["big_house", "cold_water"]);
    assert.deepEqual(X.markOpened(texts, null, "nope"), []);
    assert.deepEqual(X.markOpened(texts, undefined, "big_house"), ["big_house"]);
  });

  it("hearAllTexts is the Arabic of each sentence, in order", () => {
    const t = X.findText(texts, "ahmad_man");
    assert.deepEqual(X.hearAllTexts(t), t.sentences.map((s) => s.ar));
    assert.equal(X.hearAllTexts(t).length, 3);
  });
});

describe("texts: the comprehension question", () => {
  it("buildQuestion keeps every option, tracks the answer by id, and the right one is not always first", () => {
    const t = X.findText(texts, "big_house");
    const firsts = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const q = X.buildQuestion(t, A.seededRng(seed));
      assert.equal(q.options.length, t.question.options.length);
      assert.deepEqual(q.options.map((o) => o.id).sort(), t.question.options.map((_, i) => i));
      assert.equal(q.options.find((o) => o.id === q.answerId).text, t.question.options[t.question.answer]);
      firsts.add(q.options[0].id);
    }
    assert.ok(firsts.size > 1, "the order changes between rounds");
  });

  it("does not change the text it was built from", () => {
    const t = structuredClone(X.findText(texts, "boy_house"));
    X.buildQuestion(t, A.seededRng(3));
    assert.deepEqual(t, X.findText(texts, "boy_house"));
  });

  it("checkAnswer confirms a right answer and, for a wrong one, still gives the answer and the note", () => {
    const t = X.findText(texts, "cold_water");
    const right = X.checkAnswer(t, 0);
    assert.deepEqual(right, { correct: true, answer: "Cold water", note: t.question.note });
    const wrong = X.checkAnswer(t, 1);
    assert.equal(wrong.correct, false);
    assert.equal(wrong.answer, "Cold water");
    assert.equal(wrong.note, t.question.note);
  });

  it("checkAnswer refuses an option that is not part of the question", () => {
    const t = X.findText(texts, "cold_water");
    assert.throws(() => X.checkAnswer(t, 4), RangeError);
    assert.throws(() => X.checkAnswer(t, -1), RangeError);
    assert.throws(() => X.checkAnswer(t, "0"), RangeError);
    assert.throws(() => X.checkAnswer(t, undefined), RangeError);
  });
});

describe("texts: loading and staying pure", () => {
  it("loadTexts reads and validates, and reports a failed fetch", async () => {
    const ok = await X.loadTexts("x", async () => ({ ok: true, json: async () => copy() }));
    assert.equal(ok.length, 12);
    await assert.rejects(X.loadTexts("x", async () => ({ ok: false, status: 404 })), /404/);
    await assert.rejects(X.loadTexts("x", async () => ({ ok: true, json: async () => ({ texts: [] }) })), TypeError);
  });

  it("texts.js does not touch the DOM, storage, the clock or randomness by itself", () => {
    const src = read("texts.js");
    assert.ok(!/\b(document|window|localStorage|indexedDB|Date\.now|new Date)\b/.test(src));
    assert.ok(!/Math\.random\(\)/.test(src.replace(/rng = Math\.random/, "")), "randomness only comes in through rng");
  });
});
