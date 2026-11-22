// Read-it screens (lesson page and practice), driven in jsdom like a learner.
// Never paste invisible characters here; use explicit code points.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createEnv, WWW, sleep, FORBIDDEN } from "./helpers.mjs";

const env = await createEnv();
const { $, $$, text, h, css, go, left } = env;
const read = (f) => fs.readFileSync(path.join(WWW, f), "utf8");
const lettersRaw = JSON.parse(read("letters.json"));
const marksRaw = JSON.parse(read("marks.json"));
const FILES = { "letters.json": lettersRaw, "marks.json": marksRaw };
// The shared test helper serves letters and vocab only; serve the lesson file too.
globalThis.fetch = async (url) => {
  const raw = FILES[String(url).split("/").pop()];
  return { ok: Boolean(raw), status: raw ? 200 : 404, json: async () => raw };
};

const { createMarksScreen } = await import(path.join(WWW, "marks-screen.js"));
const A = await import(path.join(WWW, "alphabet.js"));
const M = await import(path.join(WWW, "marks.js"));

const letters = A.parseLetters(lettersRaw);
const lessons = M.parseMarks(marksRaw, letters);
const lesson1 = lessons[0];
const T0 = 1_700_000_000_000;

// ---------- test doubles ----------

function memoryStore({ cards: initial = [], meta: initialMeta = {} } = {}) {
  const cards = new Map(initial.map((c) => [c.id, structuredClone(c)]));
  const meta = new Map(Object.entries(initialMeta));
  const store = {
    cards, meta, puts: 0, saveError: null, loadError: null,
    getAllCards: async () => {
      if (store.loadError) throw new Error(store.loadError);
      return [...cards.values()].map((c) => structuredClone(c));
    },
    addCardsIfMissing: async (list) => { let n = 0; for (const c of list) if (!cards.has(c.id)) { cards.set(c.id, structuredClone(c)); n++; } return n; },
    putCard: async (c) => {
      if (store.saveError) throw new Error(store.saveError);
      store.puts++;
      cards.set(c.id, structuredClone(c));
    },
    getMeta: async (k, f = null) => (meta.has(k) ? structuredClone(meta.get(k)) : f),
    setMeta: async (k, v) => { meta.set(k, structuredClone(v)); },
  };
  return store;
}

function fakeSpeech({ voice = { ok: true } } = {}) {
  const speech = {
    spoken: [], failing: false, installOpened: 0,
    checkArabic: async () => voice,
    speak: async (t) => { if (speech.failing) throw new Error("No Arabic voice"); speech.spoken.push(t); },
    openVoiceInstall: async () => { speech.installOpened++; },
  };
  return speech;
}

/** Cards for letter groups the learner has learned well, so the suggested group moves on. */
const learnedGroups = (groups) =>
  groups.flatMap((g) => A.cardsForGroup(letters, g, T0)).map((c) => ({ ...c, reps: 3, lastReviewed: T0 }));

async function mount(parts, { store = memoryStore(), speech = fakeSpeech(), seed = 1 } = {}) {
  const goes = [];
  const screen = createMarksScreen({
    h,
    loadLetters: async () => letters,
    loadLessons: async () => lessons,
    store, speech, now: () => T0, rng: A.seededRng(seed),
    goTo: (hash) => goes.push(hash),
  });
  let title = "";
  const node = await screen({ parts, setTitle: (t) => { title = t; } });
  $("#view").replaceChildren(node);
  await sleep(20);
  return { store, speech, goes, title: () => title, node };
}

// ---------- shared checks ----------

function audit(where) {
  assert.ok(!FORBIDDEN.test(text()), `forbidden pacing word on ${where}: ${text().match(FORBIDDEN)?.[0]}`);
  assert.equal($$("[style]").length, 0, `inline style attribute on ${where} (CSP)`);
  for (const el of $$("#view [class]")) {
    for (const cls of el.classList) assert.ok(css.includes("." + cls), `CSS class "${cls}" on ${where} is not defined`);
  }
}

const choices = () => $$(".choices .choice");
const verdict = () => $(".verdict")?.textContent;
const snapshot = () => $(".card.center")?.textContent + "|" + choices().map((b) => b.textContent).join(",");
const click = async (label) => {
  const b = $$("button").find((x) => x.textContent === label);
  assert.ok(b, `no button "${label}"`);
  b.click();
  await sleep(15);
};

/** The button with the right answer for whatever question is showing. Presses the speaker for listen questions. */
async function rightChoice(speech) {
  const prompt = $(".prompt");
  if (prompt) {
    const item = lesson1.items.find((i) => i.ar === prompt.textContent);
    return choices().find((b) => b.textContent === item.tr);
  }
  $(".speak-big").click();
  await sleep(5);
  const said = speech.spoken.at(-1);
  return choices().find((b) => b.textContent === said);
}
const wrongChoice = async (speech) => {
  const right = await rightChoice(speech);
  return choices().find((b) => b !== right);
};
const answer = async (btn) => { btn.click(); await sleep(15); };

// ================= the lesson page =================

describe("Read-it: lesson page", () => {
  it("opens at #/readit/<id> with the intro, the marks, every item and a way into practice", async () => {
    await go("#/readit/short_vowels", () => $$(".bubble-row").length > 0);
    audit("lesson page");
    assert.equal($("#screen-title").textContent, "Short vowels");
    assert.equal($$(".tabbar a[aria-current]").length, 0, "a side screen: no tab is marked");
    assert.deepEqual($$(".bubble-ar").map((e) => e.textContent), lesson1.items.map((i) => i.ar));
    assert.ok(lesson1.intro.every((line) => text().includes(line)));
    assert.equal($$(".tag").length, 3, "fatha, kasra and damma");
    assert.ok(text().includes("fatha") && text().includes("kasra") && text().includes("damma"));
    const hrefs = $$("a").map((a) => a.getAttribute("href"));
    assert.ok(hrefs.includes("#/readit/short_vowels/practice"));
    assert.ok(hrefs.includes("#/alphabet"), "a way back to the letters");
    assert.ok(hrefs.includes("#/readit/sukun"), "the next lesson");
    assert.ok(!hrefs.some((x) => x.startsWith("#/readit/") && x !== "#/readit/short_vowels/practice" && x !== "#/readit/sukun"));
  });

  it("words show their meaning and sounds only show how they are read", async () => {
    await go("#/readit/short_vowels", () => $$(".bubble-row").length > 0);
    const rows = $$(".bubble-row");
    lesson1.items.forEach((item, i) => {
      const detail = rows[i].querySelector(".bubble-tr").textContent;
      assert.equal(detail, item.en ? `${item.tr} · ${item.en}` : item.tr);
    });
  });

  it("every lesson is directly reachable, with no marks row where none are taught", async () => {
    for (const lesson of lessons) {
      await go(`#/readit/${lesson.id}`, () => $("#screen-title").textContent === lesson.title);
      audit(lesson.id);
      assert.equal($$(".bubble-row").length, lesson.items.length, lesson.id);
      assert.equal($$(".tag").length, lesson.marks.length, lesson.id);
    }
  });

  it("speaks nothing on its own; a speaker button says that item", async () => {
    const speech = fakeSpeech();
    await mount(["readit", "sukun"], { speech });
    assert.deepEqual(speech.spoken, []);
    const lesson = lessons[1];
    $$(".speak-btn")[2].click();
    await sleep(10);
    assert.deepEqual(speech.spoken, [lesson.items[2].ar]);
  });

  it("a failing speaker shows a plain message and does not break the page", async () => {
    const speech = fakeSpeech();
    speech.failing = true;
    await mount(["readit", "sukun"], { speech });
    $$(".speak-btn")[0].click();
    await sleep(10);
    assert.match(text(), /No Arabic voice/);
    assert.ok($$(".bubble-row").length > 0);
  });

  it("without an Arabic voice the lesson is still readable and says why", async () => {
    const speech = fakeSpeech({ voice: { ok: false, code: "no-arabic-voice", message: "No Arabic voice is installed." } });
    await mount(["readit", "sukun"], { speech });
    assert.match(text(), /No Arabic voice is installed/);
    await click("Open voice settings");
    assert.equal(speech.installOpened, 1);
    assert.equal($$(".bubble-row").length, lessons[1].items.length);
  });

  it("an unknown or missing lesson goes to the Letters grid", async () => {
    const a = await mount(["readit", "nope"]);
    assert.deepEqual(a.goes, ["#/alphabet"]);
    const b = await mount(["readit"]);
    assert.deepEqual(b.goes, ["#/alphabet"]);
  });
});

describe("Read-it: gentle heads-up when far ahead", () => {
  const headsUps = () => $$(".note").filter((n) => n.textContent.includes("few steps past"));

  it("shows once on a lesson two or more groups past the suggested group, and never blocks", async () => {
    const m = await mount(["readit", "sukun"]); // follows group 3; suggested group is 1
    assert.equal(headsUps().length, 1);
    assert.equal($$(".bubble-row").length, lessons[1].items.length, "the lesson is fully usable");
    assert.ok($$("a").some((a) => a.getAttribute("href") === "#/readit/sukun/practice"));
    await click("Got it");
    assert.equal(headsUps().length, 0);
    assert.deepEqual(m.store.meta.get("marks.headsUpDismissed"), ["sukun"]);
  });

  it("stays dismissed next time", async () => {
    await mount(["readit", "sukun"], { store: memoryStore({ meta: { "marks.headsUpDismissed": ["sukun"] } }) });
    assert.equal(headsUps().length, 0);
  });

  it("does not show on the first lesson, or once the learner is up to that group", async () => {
    await mount(["readit", "short_vowels"]);
    assert.equal(headsUps().length, 0);
    await mount(["readit", "sukun"], { store: memoryStore({ cards: learnedGroups([1, 2]) }) });
    assert.equal(headsUps().length, 0, "group 3 is now the suggested group");
  });

  it("a dismissal that cannot be saved is harmless", async () => {
    const store = memoryStore();
    store.setMeta = async () => { throw new Error("full"); };
    await mount(["readit", "sukun"], { store });
    await click("Got it");
    assert.equal(headsUps().length, 0);
  });
});

// ================= practice =================

describe("Read-it: practice", () => {
  it("runs a round of 10: four choices each, then a summary with no score to protect", async () => {
    const speech = fakeSpeech();
    const { store } = await mount(["readit", "short_vowels", "practice"], { speech });
    audit("practice");
    assert.equal(left(), 10);
    for (let n = 10; n >= 1; n--) {
      assert.equal(left(), n);
      assert.equal(choices().length, 4);
      assert.equal(new Set(choices().map((b) => b.textContent)).size, 4);
      await answer(await rightChoice(speech));
      assert.equal(verdict(), "Yes!");
      audit("practice feedback");
      await click(n === 1 ? "Finish round" : "Next");
    }
    assert.match(text(), /Round complete/);
    assert.match(text(), /10 of 10 answers were right/);
    assert.match(text(), /Suggested next lesson: /);
    audit("summary");
    assert.equal(store.cards.size, lesson1.items.length * 2, "every card of the lesson was seeded");
    assert.ok([...store.cards.keys()].every((id) => id.startsWith("marks:short_vowels:")));
    assert.equal([...store.cards.values()].filter((c) => c.reps === 1).length, 10);
    assert.equal(store.puts, 10);
  });

  it("speaks nothing before an answer; after one it says the item", async () => {
    const speech = fakeSpeech();
    await mount(["readit", "short_vowels", "practice"], { speech });
    assert.deepEqual(speech.spoken, []);
    const right = await rightChoice(speech);
    const before = speech.spoken.length; // a listen question needs its button pressed first
    await answer(right);
    assert.equal(speech.spoken.length, before + 1);
    assert.ok(lesson1.items.some((i) => i.ar === speech.spoken.at(-1)));
  });

  it("a wrong answer shows the right one, a short note, speaks it, and brings it back 3 questions later", async () => {
    const speech = fakeSpeech();
    const { store } = await mount(["readit", "short_vowels", "practice"], { speech });
    const first = snapshot();
    const wrong = await wrongChoice(speech);
    const right = await rightChoice(speech);
    await answer(wrong);
    assert.equal(verdict(), "Not quite.");
    assert.ok(right.classList.contains("correct"));
    assert.ok(wrong.classList.contains("chosen"));
    assert.match($(".feedback").textContent, /is read/);
    assert.ok($(".feedback").textContent.includes(lesson1.reminder));
    assert.ok(speech.spoken.length > 0);
    audit("wrong answer");
    const lapsed = [...store.cards.values()].filter((c) => c.lapses === 1);
    assert.equal(lapsed.length, 1);
    assert.equal(lapsed[0].reps, 0);

    await click("Next");
    assert.equal(left(), 10, "nothing is lost: the round has the same length");
    const seen = [];
    for (let i = 0; i < 3; i++) {
      seen.push(snapshot());
      await answer(await rightChoice(speech));
      await click("Next");
    }
    assert.ok(!seen.includes(first));
    assert.equal(snapshot().split("|")[0], first.split("|")[0], "the missed question is back after 3 others");
  });

  it("Skip for now moves a question to the end without grading it", async () => {
    const speech = fakeSpeech();
    const { store } = await mount(["readit", "short_vowels", "practice"], { speech });
    const first = snapshot();
    await click("Skip for now");
    assert.equal(left(), 10);
    assert.notEqual(snapshot(), first);
    assert.equal(store.puts, 0, "skipping grades nothing");
    for (let n = 10; n >= 1; n--) {
      await answer(await rightChoice(speech));
      await click(n === 1 ? "Finish round" : "Next");
    }
    assert.match(text(), /10 of 10 answers were right/);
  });

  it("with a voice, a round includes listen questions: a speaker button, no text prompt, Arabic choices", async () => {
    const speech = fakeSpeech();
    await mount(["readit", "short_vowels", "practice"], { speech });
    let listen = 0;
    let read = 0;
    for (let n = 10; n >= 1; n--) {
      if ($(".speak-big")) {
        listen++;
        assert.ok(!$(".prompt"), "no text prompt on a listen question");
        assert.ok(choices().every((b) => lesson1.items.some((i) => i.ar === b.textContent)) || choices().every((b) => lessons.some((l) => l.items.some((i) => i.ar === b.textContent))));
        assert.ok(choices().every((b) => b.getAttribute("lang") === "ar"));
      } else {
        read++;
        assert.ok($(".prompt"));
      }
      await answer(await rightChoice(speech));
      await click(n === 1 ? "Finish round" : "Next");
    }
    assert.ok(listen > 0 && read > 0, `a mix of both (${listen} listen, ${read} read)`);
  });

  it("without an Arabic voice every question is a reading question, and the note says why", async () => {
    const speech = fakeSpeech({ voice: { ok: false, code: "no-arabic-voice", message: "No Arabic voice is installed." } });
    await mount(["readit", "short_vowels", "practice"], { speech });
    assert.match(text(), /No Arabic voice is installed/);
    for (let n = 10; n >= 1; n--) {
      assert.ok(!$(".speak-big"), "no listen question without a voice");
      assert.ok($(".prompt"));
      await answer(await rightChoice(speech));
      await click(n === 1 ? "Finish round" : "Next");
    }
    assert.match(text(), /10 of 10 answers were right/);
  });

  it("is never empty, even when everything is well known", async () => {
    const known = lessons.flatMap((l) => M.cardsForLesson(l, T0)).map((c) => ({
      ...c, reps: 6, interval: 90, due: T0 + 90 * 86_400_000, lastReviewed: T0,
    }));
    await mount(["readit", "short_vowels", "practice"], { store: memoryStore({ cards: known }) });
    assert.equal(left(), 10);
    assert.equal(choices().length, 4);
    assert.ok(!/nothing to practice/i.test(text()));
  });

  it("Keep going starts another round, and the lesson is one tap back", async () => {
    const speech = fakeSpeech();
    await mount(["readit", "short_vowels", "practice"], { speech });
    for (let n = 10; n >= 1; n--) {
      await answer(await rightChoice(speech));
      await click(n === 1 ? "Finish round" : "Next");
    }
    assert.ok($$("a").some((a) => a.getAttribute("href") === "#/readit/short_vowels"), "Back to lesson");
    await click("Keep going");
    assert.equal(left(), 10);
    assert.equal(choices().length, 4);
  });

  it("an answer that cannot be saved says so and carries on", async () => {
    const speech = fakeSpeech();
    const store = memoryStore();
    await mount(["readit", "short_vowels", "practice"], { speech, store });
    store.saveError = "disk full";
    await answer(await rightChoice(speech));
    await sleep(10);
    assert.match($(".feedback").textContent, /Could not save this answer: disk full/);
    assert.ok($$("button").some((b) => b.textContent === "Next"));
  });

  it("when storage cannot be read the screen fails loudly instead of showing nothing", async () => {
    const store = memoryStore();
    store.loadError = "storage unavailable";
    await assert.rejects(mount(["readit", "short_vowels", "practice"], { store }), /storage unavailable/);
  });

  it("uses the same wording on the heads-up note in practice, and never blocks it", async () => {
    await mount(["readit", "sukun", "practice"]);
    assert.ok($$(".note").some((n) => n.textContent.includes("few steps past")));
    assert.equal(left(), 10);
  });
});

// ================= wired into the app =================

describe("Read-it: in the app", () => {
  it("the route is registered as a side screen titled Read it", () => {
    assert.equal(env.app.screens.readit.title, "Read it");
    assert.equal(typeof env.app.screens.readit.render, "function");
  });

  it("practice opens from the hash route with the app's own storage and speech", async () => {
    await go("#/readit/sukun/practice", () => $(".practice"));
    await sleep(40);
    audit("app practice route");
    assert.equal($("#screen-title").textContent, "Practice");
    assert.equal($$(".tabbar a[aria-current]").length, 0);
    // No Arabic voice in this test browser, so only the reading cards are used: a lesson with
    // fewer than 10 of them has a shorter round (never an empty one).
    assert.equal(left(), Math.min(10, lessons[1].items.length));
    assert.equal(choices().length, 4);
  });

  it("without a voice a short lesson gives a shorter round, not an empty one", async () => {
    const speech = fakeSpeech({ voice: { ok: false, message: "No voice." } });
    await mount(["readit", "sukun", "practice"], { speech }); // 8 items: 8 reading cards
    assert.equal(left(), 8);
    assert.equal(choices().length, 4);
  });

  it("an unknown lesson id lands on the Letters grid", async () => {
    await go("#/readit/nope", () => true);
    await env.until(() => $("#screen-title").textContent === "Letters", "Letters grid");
    assert.equal(location.hash, "#/alphabet");
    assert.equal($$(".tabbar a[aria-current]")[0]?.dataset.route, "alphabet");
  });
});
