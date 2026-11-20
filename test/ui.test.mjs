// Learner-simulation tests: the real www/ app in jsdom, driven like a person would.
// Covers Home, Letters, Cards (word practice) and the pronunciation buttons, plus the pacing
// rules from CLAUDE.md section 1 on every screen (no forbidden words, practice never empty,
// nothing blocked, no inline styles, every CSS class styled).
//
// The sections share one in-memory database and run in order, like one learner's session.
// Never paste invisible characters into this file; use ZWJ.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createEnv, sleep, ZWJ, WWW } from "./helpers.mjs";

// The learner had already chosen a voice and speed in an earlier session: seed it before the app starts.
const earlyDb = await import(path.join(WWW, "db.js"));
await earlyDb.setMeta("speech.prefs", { voiceId: "seeded-voice", speed: "slow" });

const env = await createEnv();
const { h, db, css, letters, words, $, $$, text, until, go, audit, usedClasses, clickButton, hasButton, clickNext, hasLink, headsUps, left } = env;
const { createLettersScreen } = await import(path.join(WWW, "letters-screen.js"));
const { createVocabScreen } = await import(path.join(WWW, "vocab-screen.js"));
const { createQuizScreen } = await import(path.join(WWW, "quiz-screen.js"));
const quizLogic = await import(path.join(WWW, "quiz.js"));
const vocabLogic = await import(path.join(WWW, "vocab.js"));
const srsLogic = await import(path.join(WWW, "srs.js"));
const alphabet = await import(path.join(WWW, "alphabet.js"));
const ttsLogic = await import(path.join(WWW, "tts.js"));
const { createOptionsScreen, PREFS_KEY } = await import(path.join(WWW, "options-screen.js"));
const phraseLogic = await import(path.join(WWW, "phrases.js"));
const phraseList = phraseLogic.parsePhrases(JSON.parse(fs.readFileSync(path.join(WWW, "phrases.json"), "utf8")));
// The shared test environment only knows the letters and words files, so teach its fetch about phrases here.
const baseFetch = globalThis.fetch;
const phrasesRaw = JSON.parse(fs.readFileSync(path.join(WWW, "phrases.json"), "utf8"));
globalThis.fetch = async (url) => (String(url).includes("phrases") ? { ok: true, status: 200, json: async () => phrasesRaw } : baseFetch(url));

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
      ["#/options", "#/alphabet/practice", "#/alphabet", "#/cards/practice", "#/cards", "#/quiz"]);
  });

  it("an unknown route falls back to Home", async () => {
    await go("#/bogus", () => text().includes("Ready to practice"));
  });

  it("the voice and speed chosen in an earlier session are applied when the app starts", async () => {
    await sleep(50);
    assert.deepEqual(ttsLogic.getPreferences(), { voiceId: "seeded-voice", speed: "slow" });
    ttsLogic.setPreferences(null); // the rest of the tests use the defaults
  });

  it("Home: Voice options sits in the Welcome card, and Practice | Browse are side by side pairs", async () => {
    await go("#/", () => text().includes("Ready to practice"));
    const [welcome, practice] = $$("#view > div > .card");
    const voice = [...welcome.querySelectorAll("a")];
    assert.deepEqual(voice.map((a) => a.textContent), ["Voice options"]);
    assert.ok(voice[0].classList.contains("secondary") && voice[0].getAttribute("href") === "#/options");
    assert.deepEqual([...practice.querySelectorAll(".home-topic")].map((x) => x.textContent), ["Letters", "Words"]);
    const pairs = [...practice.querySelectorAll(".btn-pair")];
    assert.equal(pairs.length, 2);
    for (const [pair, [practiceHref, browseHref]] of [[pairs[0], ["#/alphabet/practice", "#/alphabet"]], [pairs[1], ["#/cards/practice", "#/cards"]]]) {
      const [p, b] = [...pair.querySelectorAll("a")];
      assert.deepEqual([p.textContent, p.getAttribute("href"), p.classList.contains("secondary")], ["Practice", practiceHref, false]);
      assert.deepEqual([b.textContent, b.getAttribute("href"), b.classList.contains("secondary")], ["Browse", browseHref, true]);
      assert.equal(pair.children.length, 2);
    }
    const quiz = [...practice.querySelectorAll("a")].find((a) => a.textContent === "Take a quiz");
    assert.ok(quiz && quiz.classList.contains("wide") && quiz.getAttribute("href") === "#/quiz");
    assert.equal(practice.querySelectorAll("a").length, 5, "the practice card has only practice, browse and quiz links");
    assert.ok(!text().includes("Practice letters") && !text().includes("Browse the words"), "the old long labels are gone");
    for (const cls of ["home-topic", "btn-pair", "wide"]) assert.ok(new RegExp(`\\.${cls}(?![\\w-])`).test(css), `.${cls} is styled`);
  });

  it("the Voice options route opens its own screen, with Back to Home and no tab highlighted", async () => {
    await go("#/options", () => $(".segmented"));
    audit("options route");
    assert.equal($("#screen-title").textContent, "Voice options");
    assert.ok(hasLink("#/"));
    assert.equal($("[aria-current=page]"), null, "it is a side screen, not a tab");
    assert.deepEqual($$(".tabbar a").map((a) => a.textContent), ["Home", "Letters", "Cards", "Read"], "the tab bar is unchanged");
    assert.ok(text().includes("This device has no speech engine."), "jsdom has no speech engine: a plain message, no crash");
    assert.deepEqual($$(".segmented button").map((b) => b.textContent), ["Slow", "Normal", "Fast"]);
  });

  it("applySavedVoice uses a saved choice, ignores junk, and never throws", async () => {
    const app = await import(path.join(WWW, "app.js"));
    const fake = (value, boom = false) => ({
      store: { getMeta: async () => { if (boom) throw new Error("storage unavailable"); return value; } },
      speech: { setPreferences: ttsLogic.setPreferences },
    });
    await app.applySavedVoice(fake({ voiceId: "v1", speed: "fast" }));
    assert.deepEqual(ttsLogic.getPreferences(), { voiceId: "v1", speed: "fast" });
    await app.applySavedVoice(fake({ voiceId: 9, speed: "warp" }));
    assert.deepEqual(ttsLogic.getPreferences(), { voiceId: null, speed: "normal" });
    await app.applySavedVoice(fake({ voiceId: "v2", speed: "slow" }));
    await app.applySavedVoice(fake(null, true));
    assert.deepEqual(ttsLogic.getPreferences(), { voiceId: null, speed: "normal" }, "unreadable storage means the defaults");
    ttsLogic.setPreferences(null);
  });

  it("the old Quran route falls back to Home, and no screen mentions the Quran", async () => {
    await go("#/quran", () => text().includes("Ready to practice"));
    assert.ok(!/quran/i.test(document.body.textContent), "Home never mentions the Quran");
  });

  it("the Read tab exists and is highlighted on its own route", async () => {
    assert.deepEqual($$(".tabbar a").map((a) => a.textContent), ["Home", "Letters", "Cards", "Read"]);
    await go("#/read", () => $("#screen-title").textContent === "Read");
    assert.equal($("[aria-current=page]").dataset.route, "read");
    audit("read");
    assert.ok(!/quran/i.test(document.body.textContent));
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

// -------------------------------------------------------------- Cards: phrases

describe("Cards: the Words | Phrases toggle and phrase sets", () => {
  const toggle = () => $$(".segmented a");

  it("the Words overview shows the toggle with Words marked; the tab bar keeps its own marker", async () => {
    await go("#/cards", () => $$("section.card").length === 10);
    assert.deepEqual(toggle().map((a) => a.textContent), ["Words", "Phrases"]);
    assert.deepEqual(toggle().map((a) => a.getAttribute("href")), ["#/cards", "#/cards/phrases"]);
    assert.equal($(".segmented a.active").textContent, "Words");
    assert.equal($(".segmented a[aria-current]").textContent, "Words");
    assert.equal($("[aria-current=page]").dataset.route, "cards", "the tab bar is still the only 'page' marker");
    assert.equal($$(".word").length, 100, "the word overview is unchanged");
  });

  it("Phrases: four open sets, one phrase per row, nothing locked, Cards tab still highlighted", async () => {
    await go("#/cards/phrases", () => $$("section.card").length === 4);
    audit("phrase sets");
    assert.equal($("#screen-title").textContent, "Flashcards");
    assert.equal($("[aria-current=page]").dataset.route, "cards");
    assert.equal($(".segmented a.active").textContent, "Phrases");
    assert.ok(text().includes("0 of 40"));
    assert.ok(text().includes("phrases learned"));
    assert.equal($$(".phrase").length, 40);
    assert.equal($$(".word").length, 0);
    assert.equal($$(".tag").filter((t) => t.textContent === "Up next").length, 1);
    assert.equal($("section.card .tag").textContent, "Up next", "set 1 is suggested first");
    for (let s = 1; s <= 4; s++) assert.ok(hasLink(`#/cards/phrases/practice/set/${s}`), `set ${s} is directly reachable`);
    assert.ok(hasLink("#/cards/phrases/practice"));
    assert.ok(!$$("#view .card").map((c) => c.textContent).join(" ").toLowerCase().includes("word"), "no word wording in the phrase cards");
    assert.ok(hasLink("#/cards"), "the toggle goes back to Words");
  });

  it("each phrase shows its Arabic and meaning, and one speaker button", async () => {
    assert.equal($$(".phrase .speak-btn").length, 40);
    const first = $$(".phrase")[0];
    assert.equal(first.querySelector(".ar").textContent, phraseList[0].ar);
    assert.ok(first.textContent.includes(phraseList[0].en));
  });

  it("phrase sets and words stay independent", async () => {
    await go("#/cards/phrases/practice/set/1", () => $(".choice"));
    for (let i = 0; i < 3; i++) {
      const prompt = $(".prompt, .prompt-en").textContent;
      const p = phraseList.find((x) => x.ar === prompt || x.en === prompt);
      const right = $(".prompt") ? p.en : p.ar;
      $$(".choice").find((b) => b.textContent === right).click();
      await sleep(15);
      await clickNext();
    }
    const stored = await db.getAllCards();
    assert.ok(stored.some((c) => c.deck === "phrase" && c.reps > 0));
    await go("#/cards", () => $$("section.card").length === 10);
    assert.ok(text().includes("0 of 100") || /\d+ of 100/.test(text()));
    assert.equal(stored.filter((c) => c.deck === "phrase").every((c) => c.id.startsWith("phrase:")), true);
  });
});

describe("Cards: phrase practice", () => {
  const solve = (wrong = false) => {
    const prompt = $(".prompt, .prompt-en").textContent;
    const p = phraseList.find((x) => x.ar === prompt || x.en === prompt);
    const right = $(".prompt") ? p.en : p.ar;
    const pick = $$(".choice").find((b) => (wrong ? b.textContent !== right : b.textContent === right));
    pick.click();
    return { p, right };
  };

  it("a full round from the suggested set: wording is about phrases, and a wrong answer comes back", async () => {
    await go("#/cards/phrases/practice", () => $(".choice"));
    audit("phrase practice");
    assert.ok(/phrase/.test($(".practice-body .card p.text").textContent), "question text talks about phrases");
    assert.ok(hasLink("#/cards/phrases"));
    assert.ok(text().includes("Back to phrases"));
    assert.equal($$(".choice").length, 4);
    assert.equal(left(), 10);
    let asked = 0;
    let wrongSeen = false;
    while (!text().includes("Round complete")) {
      const wrong = asked === 1;
      assert.ok(/phrase/.test($(".practice-body .card p.text").textContent), "every question talks about phrases");
      const { p, right } = solve(wrong);
      await sleep(15);
      if (wrong) {
        wrongSeen = true;
        assert.ok(text().includes("Not quite."));
        assert.ok($$(".feedback p").some((l) => l.textContent.includes(`${p.ar} (${p.tr}) means "${p.en}".`)), "shows the right answer");
        audit("phrase wrong answer");
      } else assert.ok(text().includes("Yes!"));
      asked++;
      await clickNext();
      assert.ok(asked < 30);
    }
    assert.ok(wrongSeen);
    assert.equal(asked, 11, "ten plus the one that came back");
    assert.ok(text().includes("10 of 11 answers were right."));
    assert.ok(hasButton("Keep going"));
    assert.ok(hasLink("#/cards/phrases"), "Back to phrases");
    audit("phrase summary");
  });

  it("a far set can be opened directly, with one dismissible heads-up that is remembered per deck", async () => {
    await go("#/cards/phrases/practice/set/4", () => $(".choice"));
    const notes = $$(".note").filter((n) => n.textContent.includes("few steps past"));
    assert.equal(notes.length, 1);
    audit("phrase heads-up");
    notes[0].querySelector("button").click();
    await sleep(20);
    assert.equal($$(".note").filter((n) => n.textContent.includes("few steps past")).length, 0);
    assert.deepEqual(await db.getMeta("phrases.headsUpDismissed", []), [4]);
    assert.ok(!(await db.getMeta("vocab.headsUpDismissed", [])).includes(4), "words keep their own memory");
    await go("#/cards/phrases/practice/set/4", () => $(".choice"));
    assert.equal($$(".note").filter((n) => n.textContent.includes("few steps past")).length, 0, "not shown again");
    assert.ok($(".choice"), "and nothing blocked it");
  });

  it("phrase practice is never empty, even when everything is scheduled far ahead", async () => {
    const all = (await db.getAllCards()).filter((c) => c.deck === "phrase");
    await db.putCards(all.map((c) => ({ ...c, due: Date.now() + 400 * 86_400_000, reps: 5 })));
    await go("#/cards/phrases/practice", () => $(".choice"));
    assert.ok(left() >= 1);
    assert.ok(!text().includes("nothing to practice"));
  });

  it("unknown phrase routes fall back to the phrase overview; unknown words routes to the word overview", async () => {
    for (const hash of ["#/cards/phrases/practice/set/99", "#/cards/phrases/practice/set/abc", "#/cards/phrases/whatever", "#/cards/phrases/practice/set/0"]) {
      await go(hash, () => $$("section.card").length === 4);
      assert.equal($(".segmented a.active").textContent, "Phrases");
    }
    await go("#/cards/phrasez", () => $$("section.card").length === 10);
    assert.equal($(".segmented a.active").textContent, "Words");
  });

  it("phrase speaker buttons speak only when pressed; a failure is a plain message", async () => {
    const speech = { speaks: [], failing: false };
    const fake = {
      checkArabic: async () => ({ ok: true }),
      speak: async (t) => { if (speech.failing) throw new Error("No Arabic voice"); speech.speaks.push(t); },
      stop: async () => {}, openVoiceInstall: async () => {},
    };
    const screen = createVocabScreen({ h, loadWords: async () => words, loadPhrases: async () => phraseList, speech: fake });
    document.querySelector("#view").replaceChildren(await screen({ parts: ["cards", "phrases"] }));
    await sleep(20);
    assert.equal(speech.speaks.length, 0, "nothing spoken automatically");
    $$(".phrase .speak-btn")[3].click();
    await sleep(10);
    assert.deepEqual(speech.speaks, [phraseList[3].ar]);
    speech.failing = true;
    $$(".phrase .speak-btn")[0].click();
    await sleep(10);
    assert.equal($(".speak-msg").textContent, "No Arabic voice");
  });

  it("a failed load shows a plain error through the app, not a blank screen", async () => {
    const screen = createVocabScreen({ h, loadWords: async () => words, loadPhrases: async () => { throw new Error("phrases missing"); } });
    await assert.rejects(screen({ parts: ["cards", "phrases"] }), /phrases missing/);
  });
});

// ------------------------------------------------------------------- Options

describe("Options: voice and speed", () => {
  const VOICES = [
    { id: "ar-a", name: "ar-xa-x-ard-local", lang: "ar-SA", local: true },
    { id: "ar-b", name: "ar-eg-x-are-local", lang: "ar-EG", local: true },
    { id: "ar-c", name: "ar-xa-x-arc-network", lang: "ar", local: false },
  ];
  const memoryMeta = (initial = null) => {
    const m = { saved: initial, writes: [], failing: false };
    m.getMeta = async (_k, fallback = null) => (m.saved === undefined || m.saved === null ? fallback : structuredClone(m.saved));
    m.setMeta = async (_k, v) => { if (m.failing) throw new Error("disk full"); m.writes.push(structuredClone(v)); m.saved = structuredClone(v); };
    return m;
  };
  function setup({ voices = VOICES, backend = "native", check = { ok: true }, saved = null } = {}) {
    const spoke = [];
    const speech = {
      listVoices: async () => ({ backend, voices }),
      checkArabic: async () => check,
      speak: async (text, options) => { if (speech.failing) throw new Error("No Arabic voice"); spoke.push({ text, options, prefs: ttsLogic.getPreferences() }); },
      setPreferences: ttsLogic.setPreferences,
      getPreferences: ttsLogic.getPreferences,
      openVoiceInstall: async () => { speech.opened = true; },
    };
    const store = memoryMeta(saved);
    const screen = createOptionsScreen({ h, speech, store });
    const mount = async () => { document.querySelector("#view").replaceChildren(await screen({ setTitle: () => {} })); await sleep(10); };
    return { speech, store, spoke, mount };
  }
  const rows = () => $$(".voice-row");
  const selected = () => $$(".voice-choice.selected").map((b) => b.querySelector(".voice-title").textContent);
  const speedNow = () => $$(".segmented button.active").map((b) => b.textContent);
  const done = () => ttsLogic.setPreferences(null);

  it("opens with Automatic selected and Normal speed, speaks nothing, and says what each voice is", async () => {
    const ctx = setup();
    await ctx.mount();
    audit("options");
    assert.equal(ctx.spoke.length, 0, "nothing is spoken when the screen opens");
    assert.ok(hasLink("#/"), "Back to Home");
    assert.deepEqual($$(".voice-title").map((t) => t.textContent), ["Automatic (default)", "Voice 1", "Voice 2", "Voice 3"]);
    assert.deepEqual($$(".voice-detail").map((t) => t.textContent), [
      "Uses your phone's best Arabic voice",
      "Arabic (Saudi Arabia) · works offline",
      "Arabic (Egypt) · works offline",
      "Arabic · needs internet",
    ]);
    assert.deepEqual($$(".voice-name").map((t) => t.textContent), VOICES.map((v) => v.name));
    assert.deepEqual(selected(), ["Automatic (default)"]);
    assert.deepEqual(speedNow(), ["Normal"]);
    assert.deepEqual($$(".segmented button").map((b) => b.textContent), ["Slow", "Normal", "Fast"]);
    assert.ok($$(".voice-choice").every((b) => b.getAttribute("aria-pressed") === (b.classList.contains("selected") ? "true" : "false")));
    assert.ok($$(".speak-btn").every((b) => b.getAttribute("aria-label")), "every speaker button has a label");
    assert.equal($$(".speak-btn").length, 5, "one per voice row, plus the speed sample");
    assert.ok(!/later|wait|due|tomorrow|streak/i.test(text()));
    done();
  });

  it("choosing a voice selects it, saves it, plays nothing, and is remembered on the next visit", async () => {
    const ctx = setup();
    await ctx.mount();
    $$(".voice-choice")[2].click();
    await sleep(15);
    assert.deepEqual(selected(), ["Voice 2"]);
    assert.deepEqual(ctx.store.saved, { voiceId: "ar-b", speed: "normal" });
    assert.deepEqual(ttsLogic.getPreferences(), { voiceId: "ar-b", speed: "normal" }, "every pronunciation button now uses it");
    assert.equal(ctx.spoke.length, 0, "choosing never plays anything");
    done();
    await ctx.mount(); // a later visit, with the app's in-memory choice reset
    assert.deepEqual(selected(), ["Voice 2"], "restored from storage");
    assert.deepEqual(ttsLogic.getPreferences().voiceId, "ar-b");
    $$(".voice-choice")[0].click();
    await sleep(15);
    assert.deepEqual(selected(), ["Automatic (default)"]);
    assert.deepEqual(ctx.store.saved, { voiceId: null, speed: "normal" });
    done();
  });

  it("each speaker button plays a sample with that voice only when pressed", async () => {
    const ctx = setup();
    await ctx.mount();
    $$(".voice-row .speak-btn")[3].click();
    await sleep(10);
    assert.equal(ctx.spoke.length, 1);
    assert.equal(ctx.spoke[0].text, "مَرْحَبًا");
    assert.deepEqual(ctx.spoke[0].options, { voiceId: "ar-c" });
    $$(".voice-row .speak-btn")[0].click();
    await sleep(10);
    assert.deepEqual(ctx.spoke[1].options, { voiceId: null }, "Automatic means no particular voice");
    assert.deepEqual(selected(), ["Automatic (default)"], "hearing a voice does not choose it");
    done();
  });

  it("speed: choose Slow or Fast, saved with the voice; the sample uses the chosen speed", async () => {
    const ctx = setup();
    await ctx.mount();
    $$(".voice-choice")[1].click();
    await sleep(15);
    $$(".segmented button").find((b) => b.textContent === "Slow").click();
    await sleep(15);
    assert.deepEqual(speedNow(), ["Slow"]);
    assert.deepEqual(ctx.store.saved, { voiceId: "ar-a", speed: "slow" }, "the voice is kept when the speed changes");
    assert.equal(ctx.spoke.length, 0);
    $$(".card .row .speak-btn")[0].click();
    await sleep(10);
    assert.equal(ctx.spoke.length, 1);
    assert.equal(ctx.spoke[0].prefs.speed, "slow", "the sample plays at the chosen speed");
    assert.deepEqual(ctx.spoke[0].options, {});
    $$(".segmented button").find((b) => b.textContent === "Fast").click();
    await sleep(15);
    assert.deepEqual(speedNow(), ["Fast"]);
    assert.equal(ttsLogic.getPreferences().speed, "fast");
    done();
  });

  it("a saved voice that is no longer installed is explained, and Automatic is used", async () => {
    const ctx = setup({ saved: { voiceId: "uninstalled", speed: "fast" } });
    await ctx.mount();
    audit("options missing voice");
    assert.ok(text().includes("not installed on this phone right now, so the automatic voice is used"));
    assert.deepEqual(selected(), ["Automatic (default)"]);
    assert.deepEqual(speedNow(), ["Fast"], "the speed is kept");
    $$(".voice-choice")[1].click();
    await sleep(15);
    assert.ok(!text().includes("not installed"), "the note goes once a real voice is chosen");
    assert.deepEqual(ctx.store.saved, { voiceId: "ar-a", speed: "fast" });
    done();
  });

  it("corrupted or odd saved settings fall back to the defaults without an error", async () => {
    for (const saved of [{ voiceId: 7, speed: "warp" }, "nonsense", [], 5]) {
      const ctx = setup({ saved });
      await ctx.mount();
      assert.deepEqual(selected(), ["Automatic (default)"]);
      assert.deepEqual(speedNow(), ["Normal"]);
      assert.ok(!text().includes("Something went wrong"));
    }
    const unreadable = setup();
    unreadable.store.getMeta = async () => { throw new Error("storage unavailable"); };
    await unreadable.mount();
    assert.deepEqual(selected(), ["Automatic (default)"], "unreadable storage is harmless");
    done();
  });

  it("no Arabic voice installed: a plain note with a way to install one; speed still works", async () => {
    const ctx = setup({ voices: [], check: { ok: false, code: "no-arabic-voice", message: "No Arabic voice is installed. Install Arabic in your phone's text-to-speech settings." } });
    await ctx.mount();
    audit("options no voice");
    assert.ok(text().includes("No Arabic voice is installed."));
    assert.ok(hasButton("Open voice settings"));
    clickButton("Open voice settings");
    assert.equal(ctx.speech.opened, true);
    assert.deepEqual($$(".voice-title").map((t) => t.textContent), ["Automatic (default)"]);
    $$(".segmented button")[0].click();
    await sleep(15);
    assert.deepEqual(speedNow(), ["Slow"]);
    done();
  });

  it("no speech engine at all: a plain message and no install button", async () => {
    const ctx = setup({ voices: [], backend: "none", check: { ok: false, code: "no-backend", message: "This device has no speech engine." } });
    await ctx.mount();
    assert.ok(text().includes("This device has no speech engine."));
    assert.ok(!hasButton("Open voice settings"));
    assert.ok($(".voice-choice"), "the screen still works");
    done();
  });

  it("a failing sample shows a plain message that clears on the next press, and never blocks choosing", async () => {
    const ctx = setup();
    await ctx.mount();
    ctx.speech.failing = true;
    $$(".voice-row .speak-btn")[1].click();
    await sleep(10);
    assert.equal($$(".speak-msg").map((m) => m.textContent).join(""), "No Arabic voice");
    $$(".voice-choice")[1].click();
    await sleep(15);
    assert.deepEqual(selected(), ["Voice 1"]);
    ctx.speech.failing = false;
    $$(".voice-row .speak-btn")[1].click();
    await sleep(10);
    assert.equal($$(".speak-msg").map((m) => m.textContent).join(""), "");
    done();
  });

  it("if saving fails, it says so plainly and the choice still applies for now", async () => {
    const ctx = setup();
    await ctx.mount();
    ctx.store.failing = true;
    $$(".voice-choice")[2].click();
    await sleep(15);
    assert.ok(text().includes("Could not save your choice: disk full."));
    assert.deepEqual(selected(), ["Voice 2"]);
    assert.equal(ttsLogic.getPreferences().voiceId, "ar-b");
    ctx.store.failing = false;
    $$(".voice-choice")[1].click();
    await sleep(15);
    assert.ok(!text().includes("Could not save"), "the message clears after a good save");
    done();
  });

  it("one voice, and a long list of voices with long names, both work", async () => {
    const one = setup({ voices: [VOICES[0]] });
    await one.mount();
    assert.equal(rows().length, 2);
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `v${i}`, name: `ar-xa-x-${"very-long-voice-name-".repeat(4)}${i}`, lang: i % 2 ? "ar-SA" : "ar-MA", local: i % 3 !== 0 }));
    const lots = setup({ voices: many });
    await lots.mount();
    assert.equal(rows().length, 31);
    $$(".voice-choice")[30].click();
    await sleep(15);
    assert.deepEqual(selected(), ["Voice 30"]);
    assert.ok($$(".voice-detail").some((d) => d.textContent === "Arabic (ar-MA) · needs internet"), "an unfamiliar language code is still shown");
    done();
  });

  it("the styles for this screen exist and nothing uses an inline style", async () => {
    const ctx = setup();
    await ctx.mount();
    for (const cls of ["voice-list", "voice-row", "voice-choice", "selected", "voice-title", "voice-detail", "voice-name", "segmented", "three", "active"]) {
      assert.ok(new RegExp(`\\.${cls}(?![\\w-])`).test(css), `.${cls} is styled`);
    }
    assert.equal($$("#view [style]").length, 0);
    done();
  });
});

// ---------------------------------------------------------------------- Quiz

describe("Quiz", () => {
  const T0 = 1_700_000_000_000;
  const parsedLetters = alphabet.parseLetters(env.lettersRaw);
  const parsedWords = vocabLogic.parseVocab(env.vocabRaw);
  const INS = quizLogic.INSTRUCTIONS;
  const SPEED_WORDS = /\b(timer|seconds?|faster|quicker|slower|speed|hurry|time limit)\b/i;

  // An in-memory store, so every quiz test starts from exactly the state it describes.
  function memoryStore(initial = []) {
    const cards = new Map(initial.map((c) => [c.id, structuredClone(c)]));
    return {
      cards,
      getAllCards: async () => [...cards.values()].map((c) => structuredClone(c)),
      addCardsIfMissing: async (list) => { let n = 0; for (const c of list) if (!cards.has(c.id)) { cards.set(c.id, structuredClone(c)); n++; } return n; },
      putCard: async (c) => { cards.set(c.id, structuredClone(c)); },
      getMeta: async (_k, f = null) => f,
      setMeta: async () => {},
    };
  }
  // Cards the learner has already answered once, so listening and typing questions are allowed.
  const seenStore = () => memoryStore([
    ...[1, 2].flatMap((g) => alphabet.cardsForGroup(parsedLetters, g, T0)),
    ...[1, 2].flatMap((s) => vocabLogic.cardsForSet(parsedWords, s, T0)),
    ...[1, 2].flatMap((s) => phraseLogic.cardsForSet(phraseList, s, T0)),
  ].map((c) => ({ ...c, lastReviewed: T0 - 1000, reps: 1, interval: 1, due: T0 + 86_400_000 })));

  function setup({ store = memoryStore(), voice = { ok: true }, seed = 1, tick = { now: 0 } } = {}) {
    const spokenHere = [];
    const speech = {
      checkArabic: async () => voice,
      speak: async (t) => { if (speech.failing) throw new Error("No Arabic voice"); spokenHere.push(t); },
      stop: async () => {},
      openVoiceInstall: async () => { speech.opened = true; },
    };
    const screen = createQuizScreen({
      h, loadLetters: async () => parsedLetters, loadWords: async () => parsedWords, loadPhrases: async () => phraseList, store, speech,
      now: () => T0, clock: () => tick.now, rng: alphabet.seededRng(seed),
    });
    return { store, speech, spokenHere, tick, mount: async () => { document.querySelector("#view").replaceChildren(await screen({ parts: ["quiz"] })); await sleep(20); } };
  }

  const kindNow = () => ($(".type-input") ? "type" : $(".speak-big") ? "listen" : "choice");
  const promptText = () => $(".prompt, .prompt-en")?.textContent;
  const letterByPrompt = () => letters.find((l) => l.char === promptText().replaceAll(ZWJ, ""));

  /** Find the right answer for the question on screen. For "listen" the speaker must be pressed first. */
  async function solve(ctx, { wrong = false } = {}) {
    const type = kindNow();
    const ins = $(".card.center p.text").textContent;
    let right;
    let deck;
    if (type === "type") {
      deck = "vocab";
      right = words.find((w) => w.ar === promptText()).en.split(",")[0];
      const input = $(".type-input");
      input.value = wrong ? "zzzzzz" : right;
      $$("button").find((b) => b.textContent === "Check").click();
    } else {
      if (type === "listen") {
        const before = ctx.spokenHere.length;
        $(".speak-big").click();
        await sleep(10);
        assert.equal(ctx.spokenHere.length, before + 1, "the speaker speaks when pressed");
        const said = ctx.spokenHere.at(-1);
        const letter = letters.find((l) => l.name === said);
        const phrase = phraseList.find((p) => p.ar === said);
        if (letter) { deck = "alphabet"; right = letter.char; }
        else if (phrase) { deck = "phrase"; right = phrase.en; }
        else { deck = "vocab"; right = words.find((w) => w.ar === said).en; }
      } else if (ins === INS.phraseAr2en) { deck = "phrase"; right = phraseList.find((p) => p.ar === promptText()).en; }
      else if (ins === INS.phraseEn2ar) { deck = "phrase"; right = phraseList.find((p) => p.en === promptText()).ar; }
      else if (ins === INS.ar2en) { deck = "vocab"; right = words.find((w) => w.ar === promptText()).en; }
      else if (ins === INS.en2ar) { deck = "vocab"; right = words.find((w) => w.en === promptText()).ar; }
      else {
        deck = "alphabet";
        const l = letterByPrompt();
        right = ins === INS.sound ? l.sound : `${l.name} (${l.nameEn})`;
      }
      const choice = $$(".choice").find((b) => (wrong ? b.textContent !== right : b.textContent === right));
      assert.ok(choice, `a choice to click (right answer "${right}")`);
      choice.click();
    }
    await sleep(15);
    return { type, deck, right };
  }
  const nextQuestion = () => clickNext();
  const inRound = () => !text().includes("Round complete");
  const cardsOf = (store, deck) => [...store.cards.values()].filter((c) => c.deck === deck);

  it("Home links to the quiz; the quiz opens with a full round and a way out", async () => {
    await go("#/", () => text().includes("Ready to practice"));
    assert.ok(hasLink("#/quiz"));
    assert.ok($$("a").some((a) => a.textContent === "Take a quiz"));
    await go("#/quiz", () => $(".choice, .type-input, .speak-big"));
    audit("quiz");
    assert.equal($("#screen-title").textContent, "Quiz");
    assert.equal(left(), 10);
    assert.ok(hasLink("#/"), "Back to Home");
    assert.ok(!SPEED_WORDS.test(text()), "no timer or speed wording");
    await go("#/quiz/whatever", () => $(".choice, .type-input, .speak-big"));
  });

  it("phrase questions never ask for typing, and a wrong phrase answer explains and returns", async () => {
    const only = memoryStore(phraseLogic.cardsForSet(phraseList, 1, T0).map((c) => ({ ...c, lastReviewed: T0 - 1000, reps: 1, interval: 1, due: T0 + 86_400_000 })));
    const ctx = setup({ store: only, seed: 5 });
    await ctx.mount();
    const isPhrase = () => /phrase/.test($(".card.center p.text").textContent);
    let asked = 0, phraseQs = 0, sawWrong = false;
    while (inRound() && asked < 30) {
      const phrase = isPhrase();
      if (phrase) assert.notEqual(kindNow(), "type", "phrases are never typed");
      const wrongNow = phrase && !sawWrong;
      const { deck } = await solve(ctx, { wrong: wrongNow });
      if (phrase) {
        phraseQs++;
        assert.equal(deck, "phrase");
      }
      if (wrongNow) {
        sawWrong = true;
        assert.ok(text().includes("Not quite."));
        assert.ok(text().includes("means"), "a short note on what the phrase means");
        assert.ok(!SPEED_WORDS.test(text()));
      }
      asked++;
      await nextQuestion();
    }
    assert.ok(phraseQs >= 3, `phrase questions came up (${phraseQs})`);
    assert.ok(sawWrong);
  });

  it("a learner's first quiz is plain multiple choice, mixing letters, words and phrases", async () => {
    const ctx = setup();
    await ctx.mount();
    audit("quiz first round");
    assert.equal(left(), 10);
    assert.equal(ctx.spokenHere.length, 0, "nothing is spoken before you press a button");
    const decks = new Set();
    let asked = 0;
    while (inRound()) {
      assert.equal(kindNow(), "choice", "nothing has been seen yet, so no listen or typing");
      assert.equal($$(".choice").length, 4);
      const { deck } = await solve(ctx);
      decks.add(deck);
      assert.ok(text().includes("Yes!"));
      audit("quiz feedback");
      asked++;
      await nextQuestion();
      assert.ok(asked < 40);
    }
    assert.equal(asked, 10);
    assert.deepEqual([...decks].sort(), ["alphabet", "phrase", "vocab"], "letters, words and phrases are mixed");
    audit("quiz summary");
    assert.ok(text().includes("10 of 10 answers were right."));
    assert.ok(hasButton("Keep going"));
    assert.equal(ctx.store.cards.size, 58, "seeded the suggested letter group, word set and phrase set");
  });

  it("a wrong answer is calm, shows the right one, costs nothing, and comes back in the round", async () => {
    const ctx = setup();
    await ctx.mount();
    let asked = 0;
    let firstWrongId = null;
    while (inRound()) {
      const wrong = asked === 1;
      const before = left();
      const { right } = await solve(ctx, { wrong });
      if (wrong) {
        assert.ok(text().includes("Not quite."));
        assert.ok($(".choice.chosen") && $(".choice.correct"), "marks the chosen and the right answer");
        assert.equal($(".choice.correct").textContent, right);
        assert.ok(!/wrong|incorrect|fail/i.test($(".feedback").textContent));
        audit("quiz wrong answer");
        firstWrongId = [...ctx.store.cards.values()].find((c) => c.lapses === 1)?.id;
        assert.ok(firstWrongId, "recorded as a lapse");
        assert.ok(before >= 1);
      }
      asked++;
      await nextQuestion();
      assert.ok(asked < 40);
    }
    assert.equal(asked, 11, "10 questions plus the missed one coming back");
    assert.ok(text().includes("10 of 11 answers were right."));
    // The missed word has now been seen, so it may come back as a listening question, which the learner plays on purpose.
    assert.ok(ctx.spokenHere.length >= 11, "each answer is spoken after answering");
  });

  it("listening questions: silent until the speaker is pressed, then answered like any other", async () => {
    const ctx = setup({ store: seenStore(), seed: 3 });
    await ctx.mount();
    let sawLetter = false;
    let sawWord = false;
    for (let i = 0; i < 600 && !(sawLetter && sawWord); i++) {
      if (!inRound()) { clickButton("Keep going"); await until(() => $(".choice, .type-input, .speak-big"), "next round"); continue; }
      if (kindNow() === "listen") {
        const spokenBefore = ctx.spokenHere.length;
        assert.equal(spokenBefore, ctx.spokenHere.length);
        assert.ok(!$(".prompt, .prompt-en"), "the answer is not shown while listening");
        assert.equal($$(".choice").length, 4);
        const { deck } = await solve(ctx);
        if (deck === "alphabet") sawLetter = true; else sawWord = true;
        assert.ok(text().includes("Yes!"));
        audit("quiz listen");
      } else {
        await solve(ctx);
      }
      if (hasButton("Next", "Finish round")) await nextQuestion();
    }
    assert.ok(sawLetter && sawWord, "saw a listening question for a letter and for a word");
  });

  it("typing questions: gentle on empty, forgiving of one slip, honest about another word", async () => {
    const ctx = setup({ store: seenStore(), seed: 5 });
    await ctx.mount();
    const seen = { right: false, typo: false, other: false, wrong: false, enter: false };
    for (let i = 0; i < 200 && !Object.values(seen).every(Boolean); i++) {
      if (!inRound()) { clickButton("Keep going"); await until(() => $(".choice, .type-input, .speak-big"), "next round"); continue; }
      if (kindNow() === "type") {
        const word = words.find((w) => w.ar === promptText());
        assert.ok($(".prompt-row .speak-btn"), "the word can be heard");
        assert.ok(!$$(".choice").length);
        clickButton("Check");
        await sleep(5);
        assert.ok(text().includes("Type your answer, or choose Skip for now."));
        assert.equal(left() >= 1, true);
        assert.ok(!$(".type-input").readOnly, "an empty check does not use up the question");
        const input = $(".type-input");
        const submit = async (value, viaEnter = false) => {
          input.value = value;
          if (viaEnter) input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          else clickButton("Check");
          await sleep(15);
        };
        const slipTarget = [...quizLogic.acceptedAnswers(word)].find((a) => a.length >= 6);
        if (!seen.right) { await submit(word.en.split(",")[0]); assert.ok(text().includes("Yes!") && !text().includes("small slip")); seen.right = true; }
        else if (!seen.enter) { await submit(word.en.split(",")[0], true); assert.ok(text().includes("Yes!")); seen.enter = true; }
        else if (!seen.typo && slipTarget) {
          await submit(slipTarget.slice(0, 2) + slipTarget.slice(3)); // one letter missing
          assert.ok(text().includes("Yes! Just a small slip in spelling.")); seen.typo = true;
        } else if (!seen.other) {
          const other = words.find((w) => w.id !== word.id && w.en.split(",")[0] !== word.en.split(",")[0] && !w.en.includes(",") && !w.en.includes("("));
          await submit(other.en);
          assert.ok(text().includes("Not quite."));
          assert.ok($$(".feedback p").some((p) => p.textContent.includes(`"${other.en}"`)), "says what the typed word really means");
          seen.other = true;
        } else { await submit("zzzzzz"); assert.ok(text().includes("Not quite.")); seen.wrong = true; }
        assert.ok($(".type-input").readOnly, "locked after answering");
        audit("quiz typed");
      } else {
        await solve(ctx);
      }
      if (hasButton("Next", "Finish round")) await nextQuestion();
    }
    assert.deepEqual(seen, { right: true, typo: true, other: true, wrong: true, enter: true });
  });

  it("answer speed silently picks the grade, and is never shown", async () => {
    const run = async ({ ms, wrong = false, store, hidden = false }) => {
      const tick = { now: 1000 };
      const ctx = setup({ store, tick, seed: 11, voice: { ok: false } }); // no voice: letters are always plain choice
      await ctx.mount();
      // always the first question; make sure it is a plain choice question
      assert.equal(kindNow(), "choice");
      tick.now += ms;
      if (hidden) {
        Object.defineProperty(document, "hidden", { value: true, configurable: true });
        document.dispatchEvent(new window.Event("visibilitychange"));
        Object.defineProperty(document, "hidden", { value: false, configurable: true });
      }
      await solve(ctx, { wrong });
      audit("quiz speed");
      assert.ok(!SPEED_WORDS.test(text()), "no mention of speed anywhere");
      const changed = [...ctx.store.cards.values()].filter((c) => c.lastReviewed !== T0 - 5 && c.lastReviewed != null);
      assert.equal(changed.length, 1, "exactly the answered card changed");
      return changed[0];
    };
    // Letter cards the learner has seen before, so speed counts; the quiz asks a letter first.
    const seenOnly = () => memoryStore(alphabet.cardsForGroup(parsedLetters, 1, T0).map((c) => ({ ...c, lastReviewed: T0 - 5, reps: 1, interval: 1, due: T0 })));
    const easy = await run({ ms: 800, store: seenOnly() });
    assert.equal(easy.ease, 2.6, "quick and right: easy");
    const good = await run({ ms: 6000, store: seenOnly() });
    assert.equal(good.ease, 2.5, "normal pace: good");
    const hard = await run({ ms: 20000, store: seenOnly() });
    assert.equal(hard.ease, 2.36, "slow but right: hard");
    assert.equal(hard.lapses, 0, "slow is never a lapse");
    assert.ok(hard.reps === 2, "still counts as learned");
    const paused = await run({ ms: 20000, store: seenOnly(), hidden: true });
    assert.equal(paused.ease, 2.5, "leaving the app mid-question is not judged on speed");
    const miss = await run({ ms: 100, wrong: true, store: seenOnly() });
    assert.equal(miss.lapses, 1, "wrong is wrong, however quick");
    // first view: speed is ignored
    const firstTick = { now: 0 };
    const ctx = setup({ tick: firstTick });
    await ctx.mount();
    firstTick.now = 100;
    await solve(ctx);
    const firstSeen = [...ctx.store.cards.values()].filter((c) => c.lastReviewed != null);
    assert.equal(firstSeen.length, 1);
    assert.equal(firstSeen[0].ease, 2.5, "a first view is graded good, not easy");
  });

  it("Skip leaves the card ungraded and at the end of the round", async () => {
    const ctx = setup();
    await ctx.mount();
    const before = JSON.stringify([...ctx.store.cards.values()]);
    clickButton("Skip for now");
    await sleep(15);
    assert.equal(left(), 10);
    assert.equal(JSON.stringify([...ctx.store.cards.values()]), before, "skip does not touch progress");
  });

  it("with no Arabic voice: a plain note, no listening questions, typing still works", async () => {
    const ctx = setup({ store: seenStore(), seed: 7, voice: { ok: false, code: "no-arabic-voice", message: "No Arabic voice is installed." } });
    await ctx.mount();
    assert.ok(text().includes("No Arabic voice is installed."));
    assert.ok(hasButton("Open voice settings"));
    clickButton("Open voice settings");
    assert.equal(ctx.speech.opened, true);
    let typed = 0;
    for (let i = 0; i < 120; i++) {
      if (!inRound()) { clickButton("Keep going"); await until(() => $(".choice, .type-input"), "next round"); continue; }
      assert.ok(!$(".speak-big"), "no listening question without a voice");
      if (kindNow() === "type") typed++;
      await solve(ctx);
      if (hasButton("Next", "Finish round")) await nextQuestion();
    }
    assert.ok(typed > 0, "typing questions still appear");
  });

  it("a failing speaker shows a plain message and never blocks answering", async () => {
    const ctx = setup({ store: seenStore(), seed: 3 });
    await ctx.mount();
    ctx.speech.failing = true;
    for (let i = 0; i < 80 && kindNow() !== "listen"; i++) {
      await solve(ctx);
      if (hasButton("Next", "Finish round")) await nextQuestion();
      if (!inRound()) { clickButton("Keep going"); await until(() => $(".choice, .type-input, .speak-big"), "next round"); }
    }
    assert.equal(kindNow(), "listen");
    $(".speak-big").click();
    await sleep(10);
    assert.equal($(".speak-msg").textContent, "No Arabic voice");
    $$(".choice")[0].click();
    await sleep(15);
    assert.ok(hasButton("Next", "Finish round"), "can still answer and continue");
  });

  it("is never empty, even when every card is scheduled far ahead; Keep going always works", async () => {
    const far = seenStore();
    for (const c of far.cards.values()) c.due = T0 + 365 * 86_400_000;
    const ctx = setup({ store: far });
    await ctx.mount();
    assert.equal(left(), 10);
    for (let round = 0; round < 3; round++) {
      let guard = 0;
      while (inRound()) {
        await solve(ctx);
        await nextQuestion();
        assert.ok(guard++ < 80);
      }
      audit("quiz summary");
      clickButton("Keep going");
      await until(() => $(".choice, .type-input, .speak-big"), "another round");
      assert.ok(left() >= 1);
    }
  });

  it("a failed save is reported and the quiz carries on; storage errors surface", async () => {
    const store = memoryStore();
    store.putCard = async () => { throw new Error("disk full"); };
    const ctx = setup({ store });
    await ctx.mount();
    await solve(ctx);
    assert.ok(text().includes("Could not save this answer: disk full"));
    assert.ok(hasButton("Next", "Finish round"));
    const broken = createQuizScreen({ h, loadLetters: async () => parsedLetters, loadWords: async () => parsedWords, loadPhrases: async () => phraseList, store: { getAllCards: async () => { throw new Error("storage unavailable"); } }, speech: { checkArabic: async () => ({ ok: true }) } });
    await assert.rejects(broken({ parts: ["quiz"] }), /storage unavailable/);
  });
});

// --------------------------------------------------------------------- styles

describe("styles", () => {
  it("every CSS class used on any screen is defined", () => {
    const undefinedClasses = [...usedClasses].filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    assert.deepEqual(undefinedClasses, [], "classes used but not styled: " + undefinedClasses.join(", "));
  });
});
