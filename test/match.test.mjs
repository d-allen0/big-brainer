// Match logic tests: picking, layout, pages, and a whole round as plain data.
// Pure logic; no DOM. Never paste invisible characters here; use String.fromCharCode.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WWW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../www");
const read = (f) => fs.readFileSync(path.join(WWW, f), "utf8");
const M = await import(path.join(WWW, "match.js"));
const srs = await import(path.join(WWW, "srs.js"));
const A = await import(path.join(WWW, "alphabet.js"));
const V = await import(path.join(WWW, "vocab.js"));
const P = await import(path.join(WWW, "phrases.js"));

const letters = A.parseLetters(JSON.parse(read("letters.json")));
const words = V.parseVocab(JSON.parse(read("vocab.json")));
const phrases = P.parsePhrases(JSON.parse(read("phrases.json")));
const T0 = 1_700_000_000_000;

const allCards = [
  ...A.cardsForGroup(letters, 1, T0), ...V.cardsForSet(words, 1, T0), ...P.cardsForSet(phrases, 1, T0),
];
const rng = () => A.seededRng(7);
const byDeck = (cards) => cards.reduce((m, c) => ({ ...m, [c.deck]: (m[c.deck] ?? 0) + 1 }), {});

describe("match: which cards can be matched", () => {
  it("letters use the name card, words and phrases the Arabic-to-English card", () => {
    const ok = allCards.filter(M.isMatchable);
    assert.ok(ok.every((c) => (c.deck === "alphabet" ? c.extra.kind === "name" : c.extra.kind === "ar2en")));
    assert.ok(!M.isMatchable(allCards.find((c) => c.deck === "alphabet" && c.extra.kind === "sound")));
    assert.ok(!M.isMatchable(allCards.find((c) => c.deck === "vocab" && c.extra.kind === "en2ar")));
    assert.ok(!M.isMatchable(allCards.find((c) => c.deck === "phrase" && c.extra.kind === "en2ar")));
    assert.ok(!M.isMatchable(null) && !M.isMatchable({ deck: "other", extra: { kind: "name" } }));
  });

  it("toItem puts the Arabic on one side and the meaning on the other", () => {
    const card = allCards.find((c) => c.deck === "vocab" && c.extra.kind === "ar2en");
    assert.deepEqual(M.toItem(card), { id: card.id, deck: "vocab", ar: card.front, meaning: card.back });
  });
});

describe("match: picking the round", () => {
  it("picks 10 cards, about 4 letters, 3 words and 3 phrases", () => {
    const picked = M.pickMatchCards({ cards: allCards, now: T0 });
    assert.equal(picked.length, 10);
    assert.deepEqual(byDeck(picked), { alphabet: 4, vocab: 3, phrase: 3 });
    assert.ok(picked.every(M.isMatchable));
  });

  it("no two picks share Arabic or a meaning", () => {
    const picked = M.pickMatchCards({ cards: allCards, now: T0 });
    assert.equal(new Set(picked.map((c) => c.front)).size, 10);
    assert.equal(new Set(picked.map((c) => c.back)).size, 10);
    const dupe = { ...allCards.find((c) => c.deck === "vocab" && c.extra.kind === "ar2en"), id: "vocab:copy:ar2en" };
    const again = M.pickMatchCards({ cards: [dupe, ...allCards], now: T0 });
    assert.equal(new Set(again.map((c) => c.back)).size, again.length, "a card with a repeated meaning is skipped");
  });

  it("takes the weakest cards first inside each deck", () => {
    const weakWord = allCards.find((c) => c.deck === "vocab" && c.extra.kind === "ar2en" && c.extra.wordId === words[9].id);
    const cards = allCards.map((c) => (c === weakWord ? { ...c, ease: 1.3, lapses: 5, reps: 0, lastReviewed: T0, due: T0 + 9e9 } : { ...c, due: T0 + 9e9, lastReviewed: T0, ease: 2.5, reps: 3 }));
    const picked = M.pickMatchCards({ cards, now: T0 });
    assert.ok(picked.some((c) => c.id === weakWord.id), "the weakest word is in the round even though nothing is scheduled");
  });

  it("tops up from the other decks when one is short, and is never empty while anything can be matched", () => {
    const onlyPhrases = P.cardsForSet(phrases, 1, T0);
    assert.equal(M.pickMatchCards({ cards: onlyPhrases, now: T0 }).length, 10);
    assert.equal(M.pickMatchCards({ cards: onlyPhrases.slice(0, 4), now: T0 }).length, 2, "4 cards = 2 phrases (ar2en and en2ar each)");
    assert.equal(M.pickMatchCards({ cards: [], now: T0 }).length, 0);
    const few = allCards.filter((c) => c.deck === "alphabet" || c.extra.wordId === words[0].id);
    const picked = M.pickMatchCards({ cards: few, now: T0 });
    assert.ok(picked.length >= 1 && picked.length <= 10);
  });

  it("rejects a bad size", () => {
    assert.throws(() => M.pickMatchCards({ cards: allCards, now: T0, size: -1 }), RangeError);
    assert.throws(() => M.pickMatchCards({ cards: allCards, now: T0, size: 1.5 }), RangeError);
    assert.equal(M.pickMatchCards({ cards: allCards, now: T0, size: 0 }).length, 0);
  });
});

describe("match: layout and pages", () => {
  const items = M.pickMatchCards({ cards: allCards, now: T0 }).slice(0, 5).map(M.toItem);

  it("each column has every item once, and the columns are never in the same order", () => {
    for (let seed = 0; seed < 50; seed++) {
      const { left, right } = M.layoutPage(items, A.seededRng(seed));
      assert.deepEqual(left.map((t) => t.id).sort(), items.map((i) => i.id).sort());
      assert.deepEqual(right.map((t) => t.id).sort(), items.map((i) => i.id).sort());
      assert.ok(!right.every((r, i) => r.id === left[i].id), `seed ${seed} lined up straight across`);
    }
  });

  it("left tiles show the Arabic and right tiles the meaning", () => {
    const { left, right } = M.layoutPage(items, A.seededRng(1));
    for (const t of left) assert.equal(t.text, items.find((i) => i.id === t.id).ar);
    for (const t of right) assert.equal(t.text, items.find((i) => i.id === t.id).meaning);
  });

  it("is deterministic for a seed and handles one or no items", () => {
    assert.deepEqual(M.layoutPage(items, A.seededRng(3)), M.layoutPage(items, A.seededRng(3)));
    assert.equal(M.layoutPage([items[0]], A.seededRng(3)).left.length, 1);
    assert.deepEqual(M.layoutPage([], A.seededRng(3)), { left: [], right: [] });
  });

  it("pagesOf splits into pages of 5 and rejects a bad size", () => {
    assert.deepEqual(M.pagesOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).map((p) => p.length), [5, 5]);
    assert.deepEqual(M.pagesOf([1, 2, 3, 4, 5, 6, 7]).map((p) => p.length), [5, 2]);
    assert.deepEqual(M.pagesOf([]), []);
    assert.throws(() => M.pagesOf([1], 0), RangeError);
  });

  it("does not change the items it is given", () => {
    const copy = structuredClone(items);
    M.layoutPage(items, A.seededRng(9));
    assert.deepEqual(items, copy);
  });
});

describe("match: a whole round", () => {
  const picked = M.pickMatchCards({ cards: allCards, now: T0 });
  const start = () => M.createRound(picked, A.seededRng(5));
  const matchAll = (state, r) => {
    let s = state;
    const grades = [];
    let last = null;
    while (s.phase !== "done") {
      for (const it of M.pageItems(s)) {
        if (s.matched.includes(it.id)) continue;
        const res = M.pairUp(s, it.id, it.id, r);
        s = res.state; grades.push(...res.grades); last = res.advanced;
        if (res.advanced) break;
      }
    }
    return { s, grades, last };
  };

  it("starts on page 1 of 2 with 5 pairs", () => {
    const s = start();
    assert.equal(s.phase, "main");
    assert.deepEqual(M.progress(s), { page: 1, pages: 2, retry: false });
    assert.equal(M.pageItems(s).length, 5);
    assert.equal(s.layout.left.length, 5);
  });

  it("a clean round grades all 10 items good, goes page 1 then page 2, then is done (no retry page)", () => {
    const r = A.seededRng(11);
    let s = start();
    const advances = [];
    const grades = [];
    while (s.phase !== "done") {
      const it = M.pageItems(s).find((i) => !s.matched.includes(i.id));
      const res = M.pairUp(s, it.id, it.id, r);
      s = res.state; grades.push(...res.grades);
      if (res.advanced) advances.push(res.advanced);
    }
    assert.deepEqual(advances, ["page", "done"]);
    assert.equal(grades.length, 10);
    assert.ok(grades.every((g) => g.grade === "good"));
    assert.deepEqual(new Set(grades.map((g) => g.id)), new Set(picked.map((c) => c.id)));
  });

  it("a wrong pair resets nothing but explains, marks both items, and costs nothing else", () => {
    const s = start();
    const [a, b] = M.pageItems(s);
    const res = M.pairUp(s, a.id, b.id, A.seededRng(1));
    assert.equal(res.correct, false);
    assert.deepEqual(res.grades, []);
    assert.equal(res.advanced, null);
    assert.deepEqual(res.note, [`${a.ar} goes with ${a.meaning}.`, `${b.meaning} goes with ${b.ar}.`]);
    assert.deepEqual(new Set(res.state.missed), new Set([a.id, b.id]));
    assert.deepEqual(res.state.matched, []);
    assert.equal(res.state.page, 0, "same page");
    assert.deepEqual(s.missed, [], "the old state is untouched");
  });

  it("missed items grade again once, then come back on one short extra page that grades nothing", () => {
    const r = A.seededRng(21);
    let s = start();
    const [a, b] = M.pageItems(s);
    s = M.pairUp(s, a.id, b.id, r).state; // both a and b missed
    const { s: end, grades } = matchAll(s, r);
    assert.equal(end.phase, "done");
    assert.equal(grades.length, 10, "each item graded exactly once");
    assert.deepEqual(new Set(grades.filter((g) => g.grade === "again").map((g) => g.id)), new Set([a.id, b.id]));
    assert.ok(grades.filter((g) => g.grade === "good").length === 8);
  });

  it("the retry page holds exactly the missed items, and a slip there asks for nothing more", () => {
    const r = A.seededRng(31);
    let s = start();
    const [a, b] = M.pageItems(s);
    s = M.pairUp(s, a.id, b.id, r).state;
    let advanced = null;
    while (s.phase === "main") {
      const it = M.pageItems(s).find((i) => !s.matched.includes(i.id));
      const res = M.pairUp(s, it.id, it.id, r);
      s = res.state; advanced = res.advanced ?? advanced;
    }
    assert.equal(s.phase, "retry");
    assert.equal(advanced, "retry");
    assert.deepEqual(new Set(M.pageItems(s).map((i) => i.id)), new Set([a.id, b.id]));
    assert.deepEqual(M.progress(s).retry, true);
    const wrong = M.pairUp(s, a.id, b.id, r);
    assert.equal(wrong.correct, false);
    assert.deepEqual(wrong.state.missed, s.missed, "no extra retry is created");
    const first = M.pairUp(wrong.state, a.id, a.id, r);
    assert.deepEqual(first.grades, []);
    const last = M.pairUp(first.state, b.id, b.id, r);
    assert.equal(last.advanced, "done");
    assert.equal(last.state.phase, "done");
  });

  it("rejects tiles that are not on the page, already matched, or a finished round", () => {
    const s = start();
    const it = M.pageItems(s)[0];
    const other = s.pages[1][0];
    assert.throws(() => M.pairUp(s, it.id, other.id), RangeError);
    const done = M.pairUp(s, it.id, it.id).state;
    assert.throws(() => M.pairUp(done, it.id, it.id), RangeError);
    assert.throws(() => M.pairUp({ ...s, phase: "done" }, it.id, it.id), RangeError);
  });

  it("a round of fewer than 5 items is one page; no items is already done", () => {
    const few = M.createRound(picked.slice(0, 3), A.seededRng(1));
    assert.deepEqual(M.progress(few), { page: 1, pages: 1, retry: false });
    assert.equal(M.createRound([], A.seededRng(1)).phase, "done");
  });
});

describe("match: stays pure", () => {
  it("uses no DOM, storage, clock or randomness of its own", () => {
    const src = read("match.js");
    for (const banned of ["document", "window", "indexedDB", "localStorage", "Date.now", "innerHTML"]) {
      assert.ok(!src.includes(banned), `match.js must not use ${banned}`);
    }
    // Math.random only as an overridable default argument.
    const uses = src.match(/Math\.random/g) ?? [];
    assert.equal(uses.length, (src.match(/rng = Math\.random/g) ?? []).length, "every use is a default argument");
  });

  it("has no forbidden wording in its messages", () => {
    const words = /\b(due|overdue|locked|unlock|streak|daily|expires|deadline|behind|missed|penalty|tomorrow|later|wait)\b/i;
    const s = M.createRound(M.pickMatchCards({ cards: allCards, now: T0 }), A.seededRng(1));
    const [a, b] = M.pageItems(s);
    assert.ok(!words.test(M.pairUp(s, a.id, b.id).note.join(" ")));
  });
});
