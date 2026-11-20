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
