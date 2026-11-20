// Learner-simulation tests: the real www/ app in jsdom, driven like a person would.
// Covers Home, Letters, Cards (word practice) and the pronunciation buttons, plus the pacing
// rules from CLAUDE.md section 1 on every screen (no forbidden words, practice never empty,
// nothing blocked, no inline styles, every CSS class styled).
//
// The sections share one in-memory database and run in order, like one learner's session.
// Never paste invisible characters into this file; use ZWJ.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createEnv, sleep, ZWJ, WWW } from "./helpers.mjs";

const env = await createEnv();
const { h, db, css, letters, words, $, $$, text, until, go, audit, usedClasses, clickButton, hasButton, clickNext, hasLink, headsUps, left } = env;
const { createLettersScreen } = await import(path.join(WWW, "letters-screen.js"));
const { createVocabScreen } = await import(path.join(WWW, "vocab-screen.js"));
const alphabet = await import(path.join(WWW, "alphabet.js"));

const byId = Object.fromEntries(letters.map((l) => [l.id, l]));
const byAr = Object.fromEntries(words.map((w) => [w.ar, w]));
const byEn = Object.fromEntries(words.map((w) => [w.en, w]));
const spoken = [];
const settled = async () => { await sleep(20); return spoken.at(-1); };

// ---------------------------------------------------------------------- Home

describe("Home", () => {
  it("shows no counts and links to every practice area", async () => {
    await until(() => $("#view").firstElementChild, "home");
    audit("home");
    assert.equal($("#screen-title").textContent, "Big Brainer");
    assert.ok(text().includes("Ready to practice"));
    assert.ok(!/Due for review/i.test(text()));
    assert.equal($$(".stat").length, 0, "home shows no counts");
    assert.deepEqual($$("#view a").map((a) => a.getAttribute("href")),
      ["#/alphabet/practice", "#/alphabet", "#/cards/practice", "#/cards"]);
  });

  it("an unknown route falls back to Home", async () => {
    await go("#/bogus", () => text().includes("Ready to practice"));
  });
});

// ------------------------------------------------------------------- Letters

describe("Letters: grid and lessons", () => {
  it("fresh install: every letter and group is open from day one", async () => {
    await go("#/alphabet", () => $$(".letter-btn").length === 28);
    audit("grid");
    assert.equal($("#screen-title").textContent, "Letters");
    assert.equal($("[aria-current=page]").dataset.route, "alphabet");
    assert.ok($$(".letter-btn").every((a) => a.getAttribute("href").startsWith("#/alphabet/letter/")));
    assert.equal($$("section.card").length, 8);
    assert.equal($$(".tag").filter((t) => t.textContent === "Up next").length, 1);
    assert.equal($("section.card .tag").textContent, "Up next", "group 1 is suggested first");
    assert.ok(text().includes("0 of 28"));
    assert.ok(hasLink("#/alphabet/practice/group/8"), "far groups are directly reachable");
    assert.ok(text().includes("This device has no speech engine"), "voice banner when there is no engine");
  });

  it("lesson shows four forms, hint, example and neighbors", async () => {
    await go("#/alphabet/letter/beh", () => $(".big-letter"));
    audit("lesson beh");
    assert.equal($("#screen-title").textContent, "bāʾ");
    assert.equal($(".big-letter").textContent, "ب");
    assert.deepEqual($$(".form-cell .ar").map((e) => e.textContent), ["ب", `ب${ZWJ}`, `${ZWJ}ب${ZWJ}`, `${ZWJ}ب`]);
    assert.deepEqual($$(".form-cell .muted").map((e) => e.textContent), ["Alone", "Start", "Middle", "End"]);
    assert.ok(text().includes(byId.beh.hint) && text().includes(byId.beh.example.ar));
    assert.equal(headsUps().length, 0);
    assert.ok(hasLink("#/alphabet/practice/letter/beh"));
    assert.ok(hasLink("#/alphabet/letter/teh"), "next letter link");
    assert.ok(hasLink("#/alphabet/letter/alef"), "previous letter link");
  });

  it("a right-joining letter explains why it has fewer forms", async () => {
    await go("#/alphabet/letter/alef", () => $(".big-letter")?.textContent === "ا");
    audit("lesson alef");
    assert.deepEqual($$(".form-cell .ar").map((e) => e.textContent), ["ا", "–", "–", `${ZWJ}ا`]);
    assert.ok(text().includes("does not connect to the letter after it"));
    assert.ok(!$$("a").some((a) => a.textContent.startsWith("←") && a.getAttribute("href").includes("letter/")), "first letter has no previous link");
  });

  it("unknown letter falls back to the grid", async () => {
    await go("#/alphabet/letter/nope", () => $$(".letter-btn").length === 28);
  });
});

describe("Letters: gentle heads-up (never blocks)", () => {
  it("shows once when far ahead, still shows all content, stays dismissed", async () => {
    await go("#/alphabet/letter/jeem", () => $(".big-letter"));
    assert.equal(headsUps().length, 0, "one group ahead: no heads-up");
    await go("#/alphabet/letter/tah", () => $(".big-letter"));
    audit("lesson tah");
    assert.equal(headsUps().length, 1, "far ahead: one heads-up");
    assert.ok($(".big-letter"), "content is still fully shown");
    clickButton("Got it");
    assert.equal(headsUps().length, 0);
    await sleep(30);
    assert.deepEqual(await db.getMeta("alphabet.headsUpDismissed"), [5]);
    await go("#/alphabet/letter/dad", () => $(".big-letter")); // a different group: its own heads-up
    await go("#/alphabet/letter/tah", () => $(".big-letter"));
    assert.equal(headsUps().length, 0, "not repeated once dismissed");
  });
});

describe("Letters: speech buttons", () => {
  it("speak only when pressed, and no voice banner when speech works", async () => {
    globalThis.Capacitor = { Plugins: { TextToSpeech: {
      async isLanguageSupported({ lang }) { return { supported: lang === "ar" }; },
      async speak(o) { spoken.push(o.text); },
      async stop() {},
      async openInstall() {},
    } } };
    await go("#/alphabet/letter/alef", () => $(".big-letter")?.textContent === "ا");
    assert.equal($$(".note").length, 0);
    assert.equal(spoken.length, 0, "nothing spoken on opening a lesson");
    clickButton("Hear the name");
    clickButton("Hear the word");
    await sleep(50);
    assert.deepEqual(spoken, [byId.alef.name, byId.alef.example.ar]);
  });
});

describe("Letters: practice", () => {
  const kindOf = (q) => Object.entries({ name: "called", sound: "sound", form: "joined" }).find(([, w]) => q.includes(w))[0];
  function readQuestion() {
    const q = $(".card.center p.text").textContent;
    const prompt = $(".prompt").textContent.replaceAll(ZWJ, "");
    const letter = letters.find((l) => l.char === prompt);
    const kind = kindOf(q);
    const answer = kind === "sound" ? letter.sound : `${letter.name} (${letter.nameEn})`;
    return { letter, kind, answer, buttons: $$(".choice") };
  }
  let asked = 0;

  it("round starts with 10 questions, 4 choices, and a way out", async () => {
    await go("#/alphabet/practice", () => $(".prompt"));
    audit("practice question");
    assert.equal(left(), 10);
    assert.equal(readQuestion().buttons.length, 4);
    assert.ok($$("a").some((a) => a.textContent.includes("Back to letters")));
  });

  it("a right answer: shown, speaks the letter, offers Next", async () => {
    const q = readQuestion();
    asked++;
    q.buttons.find((b) => b.textContent === q.answer).click();
    await sleep(15);
    audit("practice feedback (right)");
    assert.ok(text().includes("Yes!"));
    assert.ok($(".choice.correct"));
    assert.ok($$(".choice").every((b) => b.disabled));
    assert.ok(hasButton("Next"));
    assert.equal(await settled(), q.letter.name, "correct letter is spoken after answering");
    await clickNext();
  });

  it("a wrong answer: calm, shows the right one, costs nothing, comes back", async () => {
    const q = readQuestion();
    asked++;
    const wrong = q.buttons.find((b) => b.textContent !== q.answer);
    wrong.click();
    await sleep(15);
    audit("practice feedback (wrong)");
    assert.ok(text().includes("Not quite."));
    assert.ok(wrong.classList.contains("chosen") && !wrong.classList.contains("correct"));
    assert.equal($(".choice.correct").textContent, q.answer, "right answer is shown");
    assert.ok($$(".feedback p").some((p) => p.textContent.startsWith("Not ")), "says what the chosen letter is");
    assert.ok(!/wrong|incorrect|fail/i.test($(".feedback").textContent), "calm wording");
    await clickNext();
    const missed = (await db.getAllCards()).filter((c) => c.lapses === 1);
    assert.equal(missed.length, 1);
    assert.ok(missed[0].due <= Date.now(), "missed card is eligible immediately");
  });

  it("the round ends after 10 questions plus the missed one coming back", async () => {
    while (!text().includes("Round complete")) {
      const q = readQuestion();
      asked++;
      q.buttons.find((b) => b.textContent === q.answer).click();
      await sleep(10);
      await clickNext();
      assert.ok(asked < 30, "round must end");
    }
    assert.equal(asked, 11);
    audit("summary");
    assert.ok(text().includes("10 of 11 answers were right."));
    assert.ok(text().includes("Suggested next group: 1"));
  });

  it("Keep going is never an empty state", async () => {
    clickButton("Keep going");
    await until(() => $(".prompt"), "second round");
    audit("second round");
    assert.ok(left() >= 1);
  });

  it("practice never runs dry, even when nothing is scheduled", async () => {
    await go("#/alphabet/practice/letter/alef", () => $(".prompt"));
    assert.equal(left(), 3);
    for (let i = 0; i < 3; i++) {
      const q = readQuestion();
      q.buttons.find((b) => b.textContent === q.answer).click();
      await sleep(10);
      await clickNext();
    }
    assert.ok(text().includes("Round complete") && text().includes("3 of 3"));
    const alef = (await db.getAllCards()).filter((c) => c.extra.letterId === "alef");
    assert.ok(alef.every((c) => c.due > Date.now() + 3600_000), "all scheduled days away");
    clickButton("Keep going");
    await until(() => $(".prompt"), "practice with nothing scheduled");
    assert.equal(left(), 3, "still serves the cards: no 'come back later' state");
    audit("nothing scheduled");
  });

  it("Skip is ungraded and moves the card to the end", async () => {
    await go("#/alphabet/practice/letter/beh", () => $(".prompt"));
    const snapshot = async () => (await db.getAllCards()).filter((c) => c.extra.letterId === "beh").map((c) => ({ id: c.id, reps: c.reps, last: c.lastReviewed }));
    const before = await snapshot();
    assert.equal(left(), 5);
    clickButton("Skip for now");
    await sleep(15);
    assert.equal(left(), 5, "skipping keeps the count");
    assert.deepEqual(await snapshot(), before, "skip does not touch progress");
  });

  it("a far-ahead group can be practiced directly, with a heads-up; bad routes fall back", async () => {
    await go("#/alphabet/practice/group/7", () => $(".prompt"));
    assert.equal(headsUps().length, 1);
    assert.ok($(".choice"));
    audit("far group practice");
    await go("#/alphabet/practice/group/99", () => $$(".letter-btn").length === 28);
    await go("#/alphabet/practice/letter/nope", () => $$(".letter-btn").length === 28);
  });
});

describe("Letters: progress is advice that follows the learner", () => {
  it("suggestion moves on once group 1 is learned; nothing is locked", async () => {
    const g1 = (await db.getAllCards()).filter((c) => c.extra.group === 1).map((c) => ({ ...c, reps: 3, lastReviewed: Date.now() }));
    await db.putCards(g1);
    await go("#/alphabet", () => $$(".letter-btn").length === 28);
    audit("grid after group 1");
    const heads = $$("section.card").map((s) => [s.querySelector("h2").textContent, [...s.querySelectorAll(".tag")].map((t) => t.textContent)]);
    assert.deepEqual(heads[0], ["Group 1", ["Well known"]]);
    assert.deepEqual(heads[1], ["Group 2", ["Up next"]]);
    assert.ok(text().includes("4 of 28"));
    assert.equal($$(".letter-btn.learned").length, 4);
  });

  it("slipping back moves the suggestion back", async () => {
    const g1 = (await db.getAllCards()).filter((c) => c.extra.group === 1).map((c) => ({ ...c, reps: 0 }));
    await db.putCards(g1);
    await go("#/", () => text().includes("Ready to practice"));
    await go("#/alphabet", () => $$(".letter-btn").length === 28);
    assert.equal($$("section.card")[0].querySelector(".tag").textContent, "Up next");
  });

  it("milestones appear quietly, once everything is learned", async () => {
    await db.putCards(letters.flatMap((l) => alphabet.cardsForLetter(Object.freeze(l), 1)).map((c) => ({ ...c, reps: 4, lastReviewed: 5 })));
    await go("#/", () => text().includes("Ready to practice"));
    await go("#/alphabet", () => $$(".letter-btn").length === 28);
    audit("grid all learned");
    assert.ok(text().includes("All 28 letters met") && text().includes("All 28 letters learned"));
    assert.ok(text().includes("28 of 28"));
    assert.equal($$(".tag").filter((t) => t.textContent === "Up next").length, 0);
    assert.equal($$(".tag.quiet").length, 8);
  });
});

describe("Letters: failures are visible, not swallowed", () => {
  it("storage and data errors reject so the shell can show them", async () => {
    const failing = createLettersScreen({ h, store: { getAllCards: async () => { throw new Error("storage unavailable"); } } });
    await assert.rejects(failing({ parts: ["alphabet"] }), /storage unavailable/);
    const badLetters = createLettersScreen({ h, loadLetters: async () => { throw new Error("Could not load letters (404)"); } });
    await assert.rejects(badLetters({ parts: ["alphabet"] }), /404/);
  });

  it("a failed save is reported but practice continues", async () => {
    let fail = true;
    const flaky = createLettersScreen({ h, store: { ...db, putCard: async (c) => { if (fail) throw new Error("disk full"); return db.putCard(c); } } });
    document.querySelector("#view").replaceChildren(await flaky({ parts: ["alphabet", "practice", "letter", "alef"] }));
    const answer = $$(".choice")[0];
    // find the right answer by the card shown
    const prompt = $(".prompt").textContent.replaceAll(ZWJ, "");
    const letter = letters.find((l) => l.char === prompt);
    const q = $(".card.center p.text").textContent;
    const right = q.includes("sound") ? letter.sound : `${letter.name} (${letter.nameEn})`;
    $$(".choice").find((b) => b.textContent === right).click();
    await sleep(30);
    assert.ok(answer);
    assert.ok(text().includes("Could not save this answer: disk full"));
    assert.ok(hasButton("Next", "Finish round"));
    fail = false;
  });
});

// --------------------------------------------------------------------- Cards

describe("Cards: word sets", () => {
  it("fresh install: every set and word is open from day one", async () => {
    await go("#/cards", () => $$("section.card").length === 10);
    audit("sets");
    assert.equal($("#screen-title").textContent, "Flashcards");
    assert.equal($("[aria-current=page]").dataset.route, "cards");
    assert.ok(text().includes("0 of 100"));
    assert.equal($$(".word").length, 100);
    assert.equal($$(".tag").filter((t) => t.textContent === "Up next").length, 1);
    assert.ok(hasLink("#/cards/practice/set/10"), "far sets are directly reachable");
  });
});

describe("Cards: practice", () => {
  function readQuestion() {
    const q = $(".practice-body .card p.text").textContent;
    const buttons = $$(".choice");
    const answer = q.startsWith("What does") ? byAr[$(".prompt").textContent].en : byEn[$(".prompt-en").textContent].ar;
    return { q, buttons, answer, wrong: buttons.find((b) => b.textContent !== answer) };
  }

  it("a full round: a wrong answer comes back inside the round, progress is saved", async () => {
    await go("#/cards/practice", () => $(".choice"));
    audit("vocab practice");
    assert.equal($(".practice-head .muted").textContent, "10 left in this round");
    assert.equal($$(".choice").length, 4);
    for (let i = 0; i < 12; i++) {
      const r = readQuestion();
      if (i === 0) {
        r.wrong.click();
        await sleep(20);
        assert.ok(text().includes("Not quite."));
        assert.ok(text().includes("means"));
        assert.ok($(".choice.correct") && $(".choice.chosen"));
        assert.equal($$(".choice").filter((b) => !b.disabled).length, 0);
        audit("vocab wrong answer");
      } else {
        r.buttons.find((b) => b.textContent === r.answer).click();
        await sleep(15);
        assert.ok(text().includes("Yes!"));
      }
      const wasFinish = $$("button").some((b) => b.textContent === "Finish round");
      await clickNext();
      if (wasFinish) break;
    }
    assert.ok(text().includes("Round complete"));
    audit("vocab summary");
    assert.ok(hasButton("Keep going"));
    const stored = (await db.getAllCards()).filter((c) => c.deck === "vocab");
    assert.ok(stored.length >= 20 && stored.every((c) => c.id.startsWith("vocab:")));
    assert.ok(stored.some((c) => c.lapses === 1), "the wrong answer is recorded as a lapse");
  });

  it("Keep going is never empty", async () => {
    clickButton("Keep going");
    await until(() => $$(".choice").length === 4, "next round");
  });

  it("a far-ahead set can be practiced directly; the heads-up shows once", async () => {
    await go("#/cards/practice/set/7", () => $(".choice"));
    assert.equal(headsUps().length, 1);
    $$(".note").find((n) => n.textContent.includes("few steps past")).querySelector("button").click();
    await sleep(40);
    assert.equal(headsUps().length, 0);
    await go("#/cards/practice/set/7", () => $(".choice"));
    assert.equal(headsUps().length, 0, "dismissed heads-up does not return");
    assert.equal($$(".choice").length, 4);
  });

  it("unknown routes fall back to the sets overview", async () => {
    for (const hash of ["#/cards/practice/set/99", "#/cards/practice/set/abc", "#/cards/whatever"]) {
      await go(hash, () => $$("section.card").length === 10);
    }
  });

  it("meaning-to-Arabic questions show Arabic choices in the Arabic style", async () => {
    await go("#/cards/practice/set/1", () => $(".choice"));
    let saw = false;
    for (let i = 0; i < 10 && !saw; i++) {
      saw = $$(".choice-ar").length === 4 && $$(".choice-ar").every((b) => b.getAttribute("lang") === "ar");
      const r = readQuestion();
      r.buttons.find((b) => b.textContent === r.answer).click();
      await sleep(10);
      if (!hasButton("Next")) break;
      await clickNext();
    }
    assert.ok(saw);
    audit("arabic choices");
  });
});

describe("Cards: pronunciation buttons (on demand only)", () => {
  const speech = { speaks: [], failing: false };
  const fakeSpeech = {
    checkArabic: async () => ({ ok: true }),
    speak: async (t) => { if (speech.failing) throw new Error("No Arabic voice"); speech.speaks.push(t); },
    stop: async () => {},
    openVoiceInstall: async () => {},
  };
  const screen = createVocabScreen({ h, loadWords: async () => words, speech: fakeSpeech });
  const mount = async (parts) => { document.querySelector("#view").replaceChildren(await screen({ parts })); await sleep(20); };

  it("word list: one button per word, speaks that word only when pressed", async () => {
    await mount(["cards"]);
    assert.equal($$(".word .speak-btn").length, 100);
    assert.equal(speech.speaks.length, 0, "nothing spoken automatically");
    $$(".word .speak-btn")[4].click();
    await sleep(10);
    assert.deepEqual(speech.speaks, [words[4].ar]);
  });

  it("a failure shows a plain message that clears on the next press", async () => {
    speech.failing = true;
    $$(".word .speak-btn")[0].click();
    await sleep(10);
    assert.equal($(".speak-msg").textContent, "No Arabic voice");
    speech.failing = false;
    $$(".word .speak-btn")[1].click();
    await sleep(10);
    assert.equal($(".speak-msg").textContent, "");
  });

  it("practice: button on Arabic prompts; none before answering meaning-to-Arabic; Hear it again after", async () => {
    speech.speaks.length = 0;
    await mount(["cards", "practice", "set", "1"]);
    let sawAr = false;
    let sawEn = false;
    for (let i = 0; i < 20 && !(sawAr && sawEn); i++) {
      if ($(".prompt")) {
        sawAr = true;
        assert.equal($$(".speak-btn").length, 1);
        const w = byAr[$(".prompt").textContent];
        speech.speaks.length = 0;
        $(".prompt-row .speak-btn").click();
        await sleep(10);
        assert.deepEqual(speech.speaks, [w.ar], "speaks the word shown");
        speech.speaks.length = 0;
        $$(".choice").find((b) => b.textContent === w.en).click();
        await sleep(10);
        assert.deepEqual(speech.speaks, [w.ar], "the existing after-answer sound plays once");
      } else {
        sawEn = true;
        assert.equal($$(".speak-btn").length, 0, "no button before answering: it would reveal the answer");
        const w = byEn[$(".prompt-en").textContent];
        speech.speaks.length = 0;
        $$(".choice").find((b) => b.textContent === w.ar).click();
        await sleep(10);
        assert.equal($$(".speak-btn").length, 1, "Hear it again appears after answering");
        speech.speaks.length = 0;
        $(".verdict-row .speak-btn").click();
        await sleep(10);
        assert.deepEqual(speech.speaks, [w.ar]);
      }
      if (!hasButton("Next")) break;
      await clickNext();
    }
    assert.ok(sawAr && sawEn, "saw both directions");
  });

  it("with no voice available, answering and continuing still work", async () => {
    speech.failing = true;
    await mount(["cards", "practice", "set", "2"]);
    if ($(".prompt")) {
      $(".prompt-row .speak-btn").click();
      await sleep(10);
      assert.equal($(".speak-msg").textContent, "No Arabic voice");
    }
    $$(".choice")[0].click();
    await sleep(10);
    assert.ok(hasButton("Next", "Finish round"));
  });
});

// --------------------------------------------------------------------- styles

describe("styles", () => {
  it("every CSS class used on any screen is defined", () => {
    const undefinedClasses = [...usedClasses].filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    assert.deepEqual(undefinedClasses, [], "classes used but not styled: " + undefinedClasses.join(", "));
  });
});
