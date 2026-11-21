// Real-browser layout test. jsdom has no layout, so this drives the real www/ app in headless
// Chrome at three phone sizes and checks the one-handed, no-scrolling promises:
//  - all four answers, the feedback and Next fit on one screen (voice working),
//  - Next / Skip / Practice are always visible without scrolling (even with the voice note),
//  - answers are ONE column on normal phones; 2x2 only on short screens (under ~700px tall),
//  - nothing overflows sideways.
//
// Needs Chrome. Set CHROME=/path/to/chrome, or it looks in the usual places. If none is found
// the test is skipped (not failed). Never paste invisible characters here; use ZWJ.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const WWW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../www");
const ZWJ = String.fromCharCode(0x200d);
const letters = JSON.parse(fs.readFileSync(path.join(WWW, "letters.json"), "utf8")).letters;

const chromePath = [
  process.env.CHROME,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && fs.existsSync(p));
const skip = chromePath ? false : "Chrome not found (set CHROME=/path/to/chrome)";

const SIZES = [{ w: 360, h: 640 }, { w: 393, h: 852 }, { w: 412, h: 915 }];
const SHORT = (h) => h < 700; // matches the max-height: 700px rule in styles.css
const FAKE_TTS = () => {
  window.Capacitor = { Plugins: { TextToSpeech: {
    isLanguageSupported: async ({ lang }) => ({ supported: lang === "ar" }),
    speak: async () => {}, stop: async () => {}, openInstall: async () => {},
  } } };
};

let server;
let browser;
let base;

before(async () => {
  if (skip) return;
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
  server = http.createServer((req, res) => {
    const file = path.join(WWW, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
    if (!file.startsWith(WWW) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}/index.html`;
  browser = await chromium.launch({ executablePath: chromePath, args: ["--no-sandbox", "--disable-gpu"] });
});

after(async () => {
  await browser?.close();
  server?.close();
});

const measure = (page) => page.evaluate(() => {
  const box = (e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: Math.round(b.left) }; };
  const byText = (...t) => [...document.querySelectorAll("button, a")].find((b) => t.includes(b.textContent.trim()));
  const next = byText("Next", "Finish round");
  const skipBtn = byText("Skip for now");
  const practice = byText("Practice this letter");
  return {
    vh: innerHeight, vw: innerWidth, scrollY: Math.round(scrollY),
    docH: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth,
    topBottom: box(document.querySelector(".topbar")).bottom, tabTop: box(document.querySelector(".tabbar")).top,
    next: next && box(next), skip: skipBtn && box(skipBtn), practice: practice && box(practice),
    choices: [...document.querySelectorAll(".choice")].map((c) => box(c)),
  };
});
const inView = (m, b) => b && b.top >= m.topBottom - 0.5 && b.bottom <= m.tabTop + 0.5;

/** Answer the current Letters question, right or (worst case: longest explanation) wrong. */
async function answerLetter(page, wrong) {
  const info = await page.evaluate(() => ({
    kindText: document.querySelector(".card.center p.text").textContent,
    prompt: document.querySelector(".prompt").textContent,
    choices: [...document.querySelectorAll(".choice")].map((c) => c.textContent),
  }));
  const letter = letters.find((l) => l.char === info.prompt.replaceAll(ZWJ, ""));
  const isSound = info.kindText.includes("sound");
  const textOf = (l) => (isSound ? l.sound : `${l.name} (${l.nameEn})`);
  const right = textOf(letter);
  let pick = right;
  if (wrong) {
    const hintLen = (c) => letters.find((l) => textOf(l) === c)?.hint.length ?? 0;
    pick = info.choices.filter((c) => c !== right).sort((a, b) => hintLen(b) - hintLen(a))[0];
  }
  await page.locator(".choice", { hasText: pick }).first().click();
  await page.waitForTimeout(40);
}

async function newPage(w, h, withVoice) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  if (withVoice) await page.addInitScript(FAKE_TTS);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, errors };
}

for (const { w, h } of SIZES) {
  for (const withVoice of [true, false]) {
    const tag = `${w}x${h}, ${withVoice ? "voice works" : "voice note showing"}`;

    describe(`Letters at ${tag}`, { skip }, () => {
      it("question and feedback fit; Next is always visible", async () => {
        const { ctx, page, errors } = await newPage(w, h, withVoice);
        try {
          await page.goto(`${base}#/alphabet/practice/letter/ain`); // long hints: worst case
          await page.waitForSelector(".choice");
          await page.waitForTimeout(150);
          let m = await measure(page);
          assert.equal(m.choices.length, 4);
          assert.ok(m.choices.every((c) => c.bottom <= m.tabTop + 0.5), "all 4 answers above the tab bar");
          const lefts = new Set(m.choices.map((c) => c.left));
          assert.equal(lefts.size, SHORT(h) ? 2 : 1, SHORT(h) ? "short screens use 2 columns" : "one column for one-handed use");
          if (withVoice) assert.ok(m.docH <= m.vh + 1, `question needs no scrolling (doc ${m.docH} vs ${m.vh})`);
          for (const wrong of [false, true, true]) {
            await answerLetter(page, wrong);
            m = await measure(page);
            assert.ok(m.scrollY === 0 && inView(m, m.next), `Next visible after a ${wrong ? "wrong" : "right"} answer`);
            if (withVoice) assert.ok(m.docH <= m.vh + 1, `no scrolling after a ${wrong ? "wrong" : "right"} answer (doc ${m.docH} vs ${m.vh})`);
            await page.getByRole("button", { name: /^(Next|Finish round)$/ }).click();
            await page.waitForTimeout(30);
          }
          assert.deepEqual(errors, []);
        } finally {
          await ctx.close();
        }
      });

      it("the lesson's Practice button is visible without scrolling", async () => {
        const { ctx, page, errors } = await newPage(w, h, withVoice);
        try {
          await page.goto(`${base}#/alphabet/letter/ain`);
          await page.waitForSelector(".big-letter");
          await page.waitForTimeout(150);
          const m = await measure(page);
          assert.ok(inView(m, m.practice), "Practice this letter is visible");
          assert.deepEqual(errors, []);
        } finally {
          await ctx.close();
        }
      });
    });

    describe(`Cards at ${tag}`, { skip }, () => {
      it("both directions fit with the heads-up showing; Next is always visible", async () => {
        const { ctx, page, errors } = await newPage(w, h, withVoice);
        try {
          await page.goto(`${base}#/cards/practice/set/7`); // far ahead: heads-up note shown (worst case)
          await page.waitForSelector(".choice");
          await page.waitForTimeout(150);
          const seen = new Set();
          for (let i = 0; i < 12 && seen.size < 2; i++) {
            const kind = (await page.$(".prompt-en")) ? "en2ar" : "ar2en";
            if (!seen.has(kind)) {
              let m = await measure(page);
              assert.ok(m.choices.every((c) => c.bottom <= m.tabTop + 0.5), `${kind}: all 4 answers above the tab bar`);
              assert.equal(new Set(m.choices.map((c) => c.left)).size, SHORT(h) ? 2 : 1, `${kind}: column layout`);
              if (withVoice) assert.ok(m.docH <= m.vh + 1, `${kind}: question needs no scrolling (doc ${m.docH} vs ${m.vh})`);
              await (await page.$$(".choice"))[0].click(); // usually wrong: the longest feedback
              await page.waitForTimeout(60);
              m = await measure(page);
              assert.ok(inView(m, m.next), `${kind}: Next visible after answering`);
              if (withVoice) assert.ok(m.docH <= m.vh + 1, `${kind}: no scrolling after answering (doc ${m.docH} vs ${m.vh})`);
              seen.add(kind);
            } else {
              await (await page.$$(".choice"))[0].click();
              await page.waitForTimeout(30);
            }
            const next = await page.$("button:text-is('Next'), button:text-is('Finish round')");
            if (!next) break;
            await next.click();
            await page.waitForTimeout(40);
          }
          assert.equal(seen.size, 2, `saw both directions (${[...seen]})`);
          assert.deepEqual(errors, []);
        } finally {
          await ctx.close();
        }
      });

      it("the sets overview and Home do not overflow sideways", async () => {
        const { ctx, page, errors } = await newPage(w, h, withVoice);
        try {
          for (const hash of ["#/cards", "#/alphabet", "#/"]) {
            await page.goto(`${base}${hash}`);
            await page.waitForTimeout(150);
            const m = await measure(page);
            assert.ok(m.docW <= m.vw, `${hash}: no horizontal overflow (${m.docW} vs ${m.vw})`);
          }
          assert.deepEqual(errors, []);
        } finally {
          await ctx.close();
        }
      });
    });

    describe(`Quiz at ${tag}`, { skip }, () => {
      it("every question type fits, and Next / Check are always visible", async () => {
        const { ctx, page, errors } = await newPage(w, h, withVoice);
        try {
          // A fixed random sequence keeps this test repeatable.
          await page.addInitScript(() => { let s = 12345; Math.random = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); });
          await page.goto(`${base}#/quiz`);
          await page.waitForSelector(".choice, .type-input, .speak-big");
          await page.waitForTimeout(150);
          const want = withVoice ? ["choice", "listen", "type"] : ["choice", "type"];
          const seen = new Set();
          for (let i = 0; i < 500 && seen.size < want.length; i++) {
            if (await page.$("button:text-is('Keep going')")) {
              await page.click("button:text-is('Keep going')");
              await page.waitForSelector(".choice, .type-input, .speak-big");
              continue;
            }
            const kind = (await page.$(".type-input")) ? "type" : (await page.$(".speak-big")) ? "listen" : "choice";
            if (!withVoice) assert.notEqual(kind, "listen", "no listening question without a voice");
            if (!seen.has(kind)) {
              let m = await measure(page);
              if (kind === "type") {
                const box = await page.evaluate(() => {
                  const b = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; };
                  return { input: b(document.querySelector(".type-input")), check: b([...document.querySelectorAll("button")].find((x) => x.textContent === "Check")) };
                });
                assert.ok(inView(m, box.input) && inView(m, box.check), "type: the input and Check are visible");
                await page.fill(".type-input", "zzzzzz"); // wrong: the longest feedback
                await page.click("button:text-is('Check')");
              } else {
                assert.ok(m.choices.every((c) => c.bottom <= m.tabTop + 0.5), `${kind}: all 4 answers above the tab bar`);
                assert.equal(new Set(m.choices.map((c) => c.left)).size, SHORT(h) ? 2 : 1, `${kind}: column layout`);
                if (kind === "listen") {
                  const sp = await page.evaluate(() => { const r = document.querySelector(".speak-big").getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
                  assert.ok(inView(m, sp), "listen: the speaker button is visible");
                }
                if (withVoice) assert.ok(m.docH <= m.vh + 1, `${kind}: question needs no scrolling (doc ${m.docH} vs ${m.vh})`);
                await (await page.$$(".choice"))[0].click();
              }
              await page.waitForTimeout(60);
              m = await measure(page);
              assert.ok(inView(m, m.next), `${kind}: Next visible after answering`);
              if (withVoice) assert.ok(m.docH <= m.vh + 1, `${kind}: no scrolling after answering (doc ${m.docH} vs ${m.vh})`);
              seen.add(kind);
            } else if (kind === "type") {
              await page.fill(".type-input", "zzzzzz");
              await page.click("button:text-is('Check')");
            } else {
              await (await page.$$(".choice"))[0].click();
            }
            await page.waitForTimeout(30);
            await page.locator("button:text-is('Next'), button:text-is('Finish round')").first().click();
            await page.waitForTimeout(30);
          }
          assert.equal(seen.size, want.length, `saw every type (${[...seen]})`);
          const m = await measure(page);
          assert.ok(m.docW <= m.vw, "no horizontal overflow");
          assert.deepEqual(errors, []);
        } finally {
          await ctx.close();
        }
      });
    });

    describe(`Quiz with phrases at ${tag}`, { skip }, () => {
      for (const font of [null, "FreeMono"]) it(`phrase questions in both directions fit, with the longest answers${font ? ` (taller font: ${font})` : ""}; Next is always visible`, async () => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, bypassCSP: !!font });
        const page = await ctx.newPage();
        if (withVoice) await page.addInitScript(FAKE_TTS);
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        try {
          await page.addInitScript(() => { let s = 777; Math.random = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); });
          await page.goto(`${base}#/quiz`);
          await page.waitForSelector(".choice, .type-input, .speak-big");
          if (font) await page.addStyleTag({ content: `body, a, button, .ar { font-family: "${font}" !important; }` });
          await page.waitForTimeout(150);
          const dirs = new Set();
          let phraseQs = 0;
          for (let i = 0; i < 400 && phraseQs < 8; i++) {
            if (await page.$("button:text-is('Keep going')")) {
              await page.click("button:text-is('Keep going')");
              await page.waitForSelector(".choice, .type-input, .speak-big");
              continue;
            }
            const ins = await page.evaluate(() => document.querySelector(".card.center p.text")?.textContent ?? "");
            if (/phrase/.test(ins) && !(await page.$(".type-input"))) {
              phraseQs++;
              dirs.add(ins);
              let m = await measure(page);
              assert.equal(m.choices.length, 4);
              assert.ok(m.choices.every((c) => c.bottom <= m.tabTop + 0.5), "all 4 phrase answers above the tab bar");
              assert.ok(await page.$(".choices.long"), "phrase questions use the compact long-text layout");
              if (withVoice) assert.ok(m.docH <= m.vh + 1, `question needs no scrolling (doc ${m.docH} vs ${m.vh})`);
              const texts = await page.$$eval(".choice", (els) => els.map((e) => e.textContent.length));
              await (await page.$$(".choice"))[texts.indexOf(Math.max(...texts))].click(); // the longest answer: the longest feedback
              await page.waitForTimeout(60);
              m = await measure(page);
              assert.ok(inView(m, m.next), "Next is visible after answering");
              if (withVoice) assert.ok(m.docH <= m.vh + 1, `no scrolling after answering (doc ${m.docH} vs ${m.vh})`);
              assert.ok(m.docW <= m.vw, "no horizontal overflow");
            } else if (await page.$(".type-input")) {
              await page.fill(".type-input", "zzzzzz");
              await page.click("button:text-is('Check')");
            } else {
              await (await page.$$(".choice"))[0].click();
            }
            await page.waitForTimeout(30);
            await page.locator("button:text-is('Next'), button:text-is('Finish round')").first().click();
            await page.waitForTimeout(30);
          }
          assert.ok(phraseQs >= 8, `saw phrase questions (${phraseQs})`);
          assert.ok(dirs.size >= 2, `saw both directions (${[...dirs]})`);
          assert.deepEqual(errors, []);
        } finally {
          await ctx.close();
        }
      });
    });

    describe(`Read at ${tag}`, { skip }, () => {
      for (const font of [null, "FreeMono"]) it(`the list and every dialogue fit sideways, bubbles stay readable, Hear whole dialogue is reachable${font ? ` (taller font: ${font})` : ""}`, async () => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, bypassCSP: !!font });
        const page = await ctx.newPage();
        if (withVoice) await page.addInitScript(FAKE_TTS);
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const style = () => font ? page.addStyleTag({ content: `body, a, button, .ar { font-family: "${font}" !important; }` }) : null;
        try {
          await page.goto(`${base}#/read`);
          await page.waitForSelector(".dialogue-row");
          await style();
          await page.waitForTimeout(100);
          const list = await page.evaluate(() => ({
            docW: document.documentElement.scrollWidth, vw: innerWidth,
            rows: [...document.querySelectorAll(".dialogue-row")].map((r) => { const b = r.getBoundingClientRect(); return { h: b.height, left: b.left, right: b.right }; }),
          }));
          assert.equal(list.rows.length, 6);
          assert.ok(list.docW <= list.vw, `list: no horizontal overflow (${list.docW} vs ${list.vw})`);
          assert.ok(list.rows.every((r) => r.h >= 44 && r.left >= 0 && r.right <= list.vw), "list rows are big enough and on screen");

          const ids = await page.$$eval(".dialogue-row", (as) => as.map((a) => a.getAttribute("href").split("/").pop()));
          for (const id of ids) {
            await page.goto(`${base}#/read/dialogue/${id}`);
            await page.waitForSelector(".bubble");
            await style();
            // Open every line: the worst case for height and width.
            for (const b of await page.$$(".bubble")) await b.click();
            await page.waitForTimeout(60);
            const m = await page.evaluate(() => {
              const box = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }; };
              const hear = [...document.querySelectorAll("button")].find((b) => /Hear whole dialogue/.test(b.textContent));
              return {
                docW: document.documentElement.scrollWidth, vw: innerWidth, vh: innerHeight,
                tabTop: box(document.querySelector(".tabbar")).top, topBottom: box(document.querySelector(".topbar")).bottom,
                bubbles: [...document.querySelectorAll(".bubble")].map(box),
                speakers: [...document.querySelectorAll(".bubble-row .speak-btn")].map(box),
                hear: box(hear),
              };
            });
            assert.ok(m.docW <= m.vw, `${id}: no horizontal overflow (${m.docW} vs ${m.vw})`);
            assert.ok(m.bubbles.every((b) => b.left >= 0 && b.right <= m.vw), `${id}: bubbles stay on screen`);
            assert.ok(m.bubbles.every((b) => b.right - b.left >= m.vw * 0.5), `${id}: bubbles are wide enough to read`);
            assert.ok(m.speakers.every((b) => b.h >= 32 && b.left >= 0 && b.right <= m.vw), `${id}: speaker buttons fit`);
            assert.ok(m.hear.h >= 40 && m.hear.bottom <= m.tabTop + 0.5, `${id}: Hear whole dialogue sits above the tab bar (${m.hear.bottom} vs ${m.tabTop})`);
            assert.ok(m.hear.top >= m.topBottom - 0.5, `${id}: Hear whole dialogue is not under the title bar`);
          }
          assert.deepEqual(errors, []);
        } finally {
          await ctx.close();
        }
      });
    });

    describe(`Match at ${tag}`, { skip }, () => {
      // What goes with what, from the shipped data (a letter pairs with its name card).
      const partner = {};
      for (const l of letters) partner[l.char] = `${l.name} (${l.nameEn})`;
      for (const f of ["vocab.json", "phrases.json"]) {
        const data = JSON.parse(fs.readFileSync(path.join(WWW, f), "utf8"));
        for (const item of data.words ?? data.phrases) partner[item.ar] = item.en;
      }

      for (const font of [null, "FreeMono"]) it(`five pairs per page fit, a wrong pair's note fits, Next page is reachable, over several rounds${font ? ` (taller font: ${font})` : ""}`, async () => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, bypassCSP: !!font });
        const page = await ctx.newPage();
        if (withVoice) await page.addInitScript(FAKE_TTS);
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const m0 = () => page.evaluate(() => {
          const box = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }; };
          return {
            label: document.querySelector(".practice-head .muted").textContent,
            docH: document.documentElement.scrollHeight, vh: innerHeight, docW: document.documentElement.scrollWidth, vw: innerWidth,
            tabTop: box(document.querySelector(".tabbar")).top, topBottom: box(document.querySelector(".topbar")).bottom,
            tiles: [...document.querySelectorAll(".tile")].map(box),
            feedback: box(document.querySelector(".match-feedback")),
            actions: box(document.querySelector(".actions-bar")),
            next: [...document.querySelectorAll(".actions-bar button")].map(box),
          };
        });
        const style = () => font ? page.addStyleTag({ content: `body, a, button, .ar { font-family: "${font}" !important; }` }) : null;
        // Click the Arabic tile `ar` and then the tile whose text is `meaning`.
        const pair = (ar, meaning) => page.evaluate(([a, mtext]) => {
          const col = (i) => [...document.querySelectorAll(".match-col")[i].querySelectorAll(".tile")];
          col(0).find((t) => t.textContent === a).click();
          col(1).find((t) => t.textContent === mtext).click();
        }, [ar, meaning]);
        const openArabic = () => page.$$eval(".match-col:first-child .tile:not([disabled])", (els) => els.map((e) => e.textContent));
        const checkFits = (m, what) => {
          assert.ok(m.docW <= m.vw, `${what}: no horizontal overflow (${m.docW} vs ${m.vw})`);
          if (m.label === "Another look") assert.ok(m.tiles.length >= 4 && m.tiles.length <= 8 && m.tiles.length % 2 === 0, `${what}: the extra page has only the items that were mixed up (${m.tiles.length} tiles)`);
          else assert.equal(m.tiles.length, 10, `${what}: ten tiles`);
          assert.ok(m.tiles.every((t) => t.h >= 36 && t.left >= 0 && t.right <= m.vw), `${what}: tiles are big enough and on screen (smallest ${Math.min(...m.tiles.map((t) => t.h))}px)`);
          assert.ok(m.tiles.every((t) => t.bottom <= m.tabTop + 0.5 && t.top >= m.topBottom - 0.5), `${what}: every tile is between the title and the tab bar`);
          if (withVoice) assert.ok(m.docH <= m.vh + 1, `${what}: no scrolling (doc ${m.docH} vs ${m.vh})`);
        };
        try {
          await page.addInitScript(() => { let s = 4242; Math.random = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); });
          await page.goto(`${base}#/match`);
          await page.waitForSelector(".tile");
          await style();
          await page.waitForTimeout(120);
          let sawRetry = false;
          for (let round = 0; round < 4; round++) {
            for (let guard = 0; guard < 4; guard++) {
              await page.waitForSelector(".tile");
              checkFits(await m0(), `round ${round + 1} page`);

              // A wrong pair: the two-line note must fit with the tiles on screen.
              if (round === 0 || round === 2) {
                const open = await openArabic();
                const left = open[0];
                await pair(left, partner[open[1]]);
                await page.waitForTimeout(40);
                const m = await m0();
                assert.ok(await page.$(".match-feedback .verdict"), "the note is showing");
                checkFits(m, `round ${round + 1} after a wrong pair`);
                assert.ok(m.feedback.bottom <= m.tabTop + 0.5, `the note is above the tab bar (${m.feedback.bottom} vs ${m.tabTop}, docH ${m.docH}, vh ${m.vh})`);
              }

              for (const ar of await openArabic()) await pair(ar, partner[ar]);
              await page.waitForTimeout(40);
              const m = await m0();
              assert.ok(m.tiles.every((t) => t.bottom <= m.tabTop + 0.5), "a finished page still fits");
              assert.equal(m.next.length, 1, "one button to go on");
              assert.ok(m.next[0].h >= 40 && m.next[0].top >= m.topBottom - 0.5 && m.next[0].bottom <= m.tabTop + 0.5, "the go-on button is reachable");
              const btn = await page.textContent(".actions-bar button");
              if (btn === "Keep going") sawRetry = true;
              await page.click(".actions-bar button");
              await page.waitForTimeout(40);
              if (btn === "Finish round") break;
            }
            // The summary: both buttons visible, nothing to scroll.
            await page.waitForSelector(".card.center h2");
            const s = await page.evaluate(() => {
              const b = (e) => e.getBoundingClientRect();
              return { docH: document.documentElement.scrollHeight, vh: innerHeight, tab: b(document.querySelector(".tabbar")).top, btns: [...document.querySelectorAll(".actions-bar .btn")].map((e) => b(e).bottom) };
            });
            assert.ok(s.btns.length === 2 && s.btns.every((v) => v <= s.tab + 0.5), "summary buttons are reachable");
            await page.click(".actions-bar button:text-is('Keep going')");
            await page.waitForTimeout(60);
          }
          assert.ok(sawRetry, "a wrong pair led to the extra page");
          assert.deepEqual(errors, []);
        } finally {
          await ctx.close();
        }
      });
    });

    describe(`Phrases at ${tag}`, { skip }, () => {
      it("the toggle and phrase overview fit sideways, with the toggle visible at the top", async () => {
        const { ctx, page, errors } = await newPage(w, h, withVoice);
        try {
          await page.goto(`${base}#/cards/phrases`);
          await page.waitForSelector(".phrase");
          await page.waitForTimeout(150);
          const m = await measure(page);
          assert.ok(m.docW <= m.vw, `no horizontal overflow (${m.docW} vs ${m.vw})`);
          const t = await page.evaluate(() => {
            const r = document.querySelector(".segmented").getBoundingClientRect();
            const links = [...document.querySelectorAll(".segmented a")].map((a) => a.getBoundingClientRect().height);
            return { top: r.top, bottom: r.bottom, links };
          });
          assert.ok(t.top >= m.topBottom - 0.5 && t.bottom <= m.tabTop, "the toggle is on screen without scrolling");
          assert.ok(t.links.every((x) => x >= 44), "each toggle button is at least 44px tall");
          assert.equal(await page.locator(".phrase").count(), 40);
          assert.deepEqual(errors, []);
        } finally {
          await ctx.close();
        }
      });

      for (const font of [null, "FreeMono"]) it(`both directions fit in every phrase set with the longest answers${font ? ` (taller Arabic font: ${font})` : ""}; Next is always visible`, async () => {
        // A taller Arabic font stands in for devices whose fonts have larger line heights than this machine's.
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, bypassCSP: !!font });
        const page = await ctx.newPage();
        if (withVoice) await page.addInitScript(FAKE_TTS);
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        try {
          const seen = new Set();
          for (const set of [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]) { // each set a few times: different questions every time
            await page.goto(`${base}#/cards/phrases/practice/set/${set}`);
            await page.reload();
            await page.waitForSelector(".choice");
            if (font) await page.addStyleTag({ content: `.ar, .choice-ar, .prompt { font-family: "${font}" !important; }` });
            await page.waitForTimeout(100);
            for (let i = 0; i < 14; i++) {
              if (await page.$("button:text-is('Keep going')")) break;
              const kind = (await page.$(".prompt-en")) ? "en2ar" : "ar2en";
              let m = await measure(page);
              assert.ok(m.choices.every((c) => c.bottom <= m.tabTop + 0.5), `set ${set} ${kind}: all 4 answers above the tab bar`);
              assert.equal(new Set(m.choices.map((c) => c.left)).size, SHORT(h) ? 2 : 1, `set ${set} ${kind}: column layout`);
              if (withVoice) assert.ok(m.docH <= m.vh + 1, `set ${set} ${kind}: no scrolling (doc ${m.docH} vs ${m.vh})`);
              const texts = await page.$$eval(".choice", (bs) => bs.map((x) => x.textContent.length));
              await (await page.$$(".choice"))[texts.indexOf(Math.max(...texts))].click(); // the longest answer: the longest feedback
              await page.waitForTimeout(40);
              m = await measure(page);
              assert.ok(inView(m, m.next), `set ${set} ${kind}: Next visible after answering`);
              if (withVoice) assert.ok(m.docH <= m.vh + 1, `set ${set} ${kind}: no scrolling after answering (doc ${m.docH} vs ${m.vh})`);
              assert.ok(m.docW <= m.vw, "no horizontal overflow");
              seen.add(kind);
              await page.locator("button:text-is('Next'), button:text-is('Finish round')").first().click();
              await page.waitForTimeout(30);
            }
          }
          assert.equal(seen.size, 2, `saw both directions (${[...seen]})`);
          assert.deepEqual(errors, []);
        } finally {
          await ctx.close();
        }
      });
    });

    describe(`Voice options at ${tag}`, { skip }, () => {
      // Twelve voices with long technical names, like a phone with many installed voices.
      const MANY_VOICES = () => {
        window.Capacitor = { Plugins: { TextToSpeech: {
          isLanguageSupported: async ({ lang }) => ({ supported: lang === "ar" }),
          getSupportedVoices: async () => ({ voices: Array.from({ length: 12 }, (_, i) => ({
            voiceURI: `v${i}`, name: `ar-xa-x-${"very-long-voice-name-".repeat(3)}${i}`, lang: i % 2 ? "ar-SA" : "ar-MA", localService: i % 3 !== 0, default: i === 1,
          })) }),
          speak: async () => {}, stop: async () => {}, openInstall: async () => {},
        } } };
      };
      for (const font of [null, "FreeMono"]) {
        it(`fits sideways, every control is big enough and on screen, and the choice is remembered${font ? ` (taller font: ${font})` : ""}`, async () => {
          const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, bypassCSP: !!font });
          const page = await ctx.newPage();
          if (withVoice) await page.addInitScript(MANY_VOICES);
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          const open = async () => {
            await page.goto(`${base}#/options`);
            await page.reload();
            await page.waitForSelector(".segmented button");
            if (font) await page.addStyleTag({ content: `body, button, input { font-family: "${font}" !important; }` });
            await page.waitForTimeout(150);
          };
          try {
            await open();
            const m = await page.evaluate(() => {
              const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, h: r.height }; };
              return {
                docW: document.documentElement.scrollWidth, vw: innerWidth,
                choices: [...document.querySelectorAll(".voice-choice")].map(box),
                speakers: [...document.querySelectorAll(".voice-row .speak-btn")].map(box),
                speed: [...document.querySelectorAll(".segmented button")].map(box),
              };
            });
            assert.ok(m.docW <= m.vw, `no horizontal overflow (${m.docW} vs ${m.vw})`);
            assert.equal(m.choices.length, withVoice ? 13 : 1, "Automatic plus each voice");
            assert.ok(m.choices.every((c) => c.h >= 52), "voice rows are at least 52px tall");
            assert.ok(m.speakers.every((s) => s.r <= m.vw && s.l >= 0 && s.r - s.l >= 32), "every speaker button is fully on screen");
            assert.ok(m.choices.every((c) => c.r <= m.vw && c.l >= 0));
            assert.equal(m.speed.length, 3);
            assert.ok(m.speed.every((s) => s.h >= 44 && s.l >= 0 && s.r <= m.vw), "the speed buttons are at least 44px tall and on screen");

            // Choose a voice and a speed, then come back: both are remembered.
            if (withVoice) await page.locator(".voice-choice").nth(2).click();
            await page.locator(".segmented button", { hasText: "Slow" }).click();
            await page.waitForTimeout(80);
            await open();
            assert.equal(await page.locator(".segmented button.active").textContent(), "Slow");
            if (withVoice) assert.equal(await page.locator(".voice-choice.selected .voice-title").textContent(), "Voice 2");
            else assert.ok(await page.locator(".note").count() > 0, "a plain note explains that no Arabic voice is available");
            assert.deepEqual(errors, []);
          } finally {
            await ctx.close();
          }
        });
      }

      it("Home shows the Voice options button without scrolling sideways", async () => {
        const { ctx, page, errors } = await newPage(w, h, withVoice);
        try {
          await page.goto(`${base}#/`);
          await page.waitForSelector("a:text-is('Voice options')");
          const m = await measure(page);
          assert.ok(m.docW <= m.vw, "no horizontal overflow");
          await page.click("a:text-is('Voice options')");
          await page.waitForSelector(".segmented button");
          assert.deepEqual(errors, []);
        } finally {
          await ctx.close();
        }
      });
    });

    describe(`Home at ${tag}`, { skip }, () => {
      for (const font of [null, "FreeMono"]) {
        it(`Practice | Browse sit side by side, equal and big enough, with Voice options in the Welcome card${font ? ` (taller font: ${font})` : ""}`, async () => {
          const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, bypassCSP: !!font });
          const page = await ctx.newPage();
          if (withVoice) await page.addInitScript(FAKE_TTS);
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          try {
            await page.goto(`${base}#/`);
            await page.waitForSelector(".btn-pair");
            if (font) await page.addStyleTag({ content: `body, a, button { font-family: "${font}" !important; }` });
            await page.waitForTimeout(150);
            const m = await page.evaluate(() => {
              const box = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, w: r.width, h: r.height }; };
              const welcome = document.querySelector("#view .card");
              const voice = [...welcome.querySelectorAll("a")].find((a) => a.textContent === "Voice options");
              return {
                docW: document.documentElement.scrollWidth, vw: innerWidth,
                pairs: [...document.querySelectorAll(".btn-pair")].map((p) => [...p.querySelectorAll("a")].map(box)),
                voice: voice && box(voice),
                quiz: box([...document.querySelectorAll("a")].find((a) => a.textContent === "Take a quiz")),
              };
            });
            assert.ok(m.docW <= m.vw, `no horizontal overflow (${m.docW} vs ${m.vw})`);
            assert.equal(m.pairs.length, 4, "Letters, Words, Phrases and Quiz | Match");
            for (const [a, b] of m.pairs) {
              assert.equal(Math.round(a.top), Math.round(b.top), "Practice and Browse are on the same row");
              assert.ok(a.right <= b.left, "Practice is left of Browse");
              assert.ok(Math.abs(a.w - b.w) < 2, `equal widths (${a.w} vs ${b.w})`);
              assert.ok(a.h >= 44 && b.h >= 44, "each button is at least 44px tall");
              assert.ok(a.left >= 0 && b.right <= m.vw, "both fit on screen");
            }
            assert.ok(m.voice && m.voice.h >= 44, "Voice options is in the Welcome card and big enough");
            assert.ok(m.quiz.h >= 44 && m.quiz.left >= 0 && m.quiz.right <= m.vw);
            assert.deepEqual([...m.pairs[3]].map((b) => Math.round(b.top)).filter((v, i, a) => a.indexOf(v) === i).length, 1, "Take a quiz and Match are on one row");

            // The Quiz button is reachable by scrolling, and Voice options opens its screen.
            await page.locator("a:text-is('Take a quiz')").scrollIntoViewIfNeeded();
            await page.click("a:text-is('Voice options')");
            await page.waitForSelector(".segmented button");
            assert.deepEqual(errors, []);
          } finally {
            await ctx.close();
          }
        });
      }
    });
  }
}

describe("Pronunciation buttons in the Chrome layout", { skip }, () => {
  it("the speaker button on an Arabic prompt does not push the answers off screen", async () => {
    const { ctx, page } = await newPage(360, 640, true);
    try {
      await page.goto(`${base}#/cards/practice/set/1`);
      await page.waitForSelector(".choice");
      for (let i = 0; i < 12 && !(await page.$(".prompt-row")); i++) {
        await (await page.$$(".choice"))[0].click();
        await page.locator("button:text-is('Next'), button:text-is('Finish round')").first().click();
        await page.waitForTimeout(40);
      }
      assert.ok(await page.$(".prompt-row .speak-btn"), "an Arabic-prompt question was reached");
      const m = await measure(page);
      assert.ok(m.choices.every((c) => c.bottom <= m.tabTop + 0.5));
    } finally {
      await ctx.close();
    }
  });
});

describe("Status bar room (Capacitor system-bar insets)", { skip }, () => {
  // Capacitor hands the Android insets to the page as CSS variables. The title bar must use them.
  for (const { w, h } of SIZES) {
    it(`title starts below the status bar and the tab bar clears the gesture bar at ${w}x${h}`, async () => {
      const { ctx, page } = await newPage(w, h, true);
      try {
        await page.goto(`${base}#/home`);
        await page.waitForSelector(".topbar h1");
        await page.evaluate(() => {
          const s = document.documentElement.style;
          s.setProperty("--safe-area-inset-top", "48px");
          s.setProperty("--safe-area-inset-bottom", "24px");
        });
        await page.waitForTimeout(80);
        const m = await page.evaluate(() => {
          const t = document.querySelector(".topbar h1").getBoundingClientRect();
          const bar = document.querySelector(".tabbar").getBoundingClientRect();
          const link = document.querySelector(".tabbar a").getBoundingClientRect();
          return { titleTop: t.top, barBottom: bar.bottom, linkBottom: link.bottom, vh: window.innerHeight };
        });
        assert.ok(m.titleTop >= 48, `title top ${m.titleTop} is below the 48px status bar`);
        assert.ok(m.linkBottom <= m.vh - 24 + 0.5, `tab labels end ${m.linkBottom}, above the 24px gesture bar`);
        // Still true after scrolling: the pinned title bar must not slide under the status bar.
        await page.goto(`${base}#/alphabet`);
        await page.waitForSelector(".topbar h1");
        await page.evaluate(() => {
          document.documentElement.style.setProperty("--safe-area-inset-top", "48px");
          window.scrollTo(0, 400);
        });
        await page.waitForTimeout(80);
        const top = await page.evaluate(() => document.querySelector(".topbar h1").getBoundingClientRect().top);
        assert.ok(top >= 48, `title stays below the status bar after scrolling (${top})`);
      } finally {
        await ctx.close();
      }
    });
  }
});
