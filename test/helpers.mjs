// Shared test environment: runs the real www/ app (index.html, app.js, screens) inside jsdom
// with an in-memory IndexedDB (fake-indexeddb), so tests can drive it like a learner.
//
// NOTE: never paste invisible characters into test files. Use ZWJ below.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import "fake-indexeddb/auto";

export const WWW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../www");
export const ZWJ = String.fromCharCode(0x200d);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Words that must never appear on any screen (CLAUDE.md section 1.3).
export const FORBIDDEN = /\b(due|overdue|locked|unlock|unlocked|streak|daily|expires|deadline|behind|penalty|tomorrow|later|wait|missed)\b/i;

/** Boot the real app once. Returns helpers bound to the jsdom document. */
export async function createEnv() {
  const read = (f) => fs.readFileSync(path.join(WWW, f), "utf8");
  const lettersRaw = JSON.parse(read("letters.json"));
  const vocabRaw = JSON.parse(read("vocab.json"));

  const dom = new JSDOM(read("index.html"), { url: "https://localhost/", pretendToBeVisual: true });
  const { window } = dom;
  window.scrollTo = () => {};
  Object.assign(globalThis, { window, document: window.document, location: window.location });
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).includes("vocab") ? vocabRaw : lettersRaw),
  });

  const app = await import(path.join(WWW, "app.js"));
  const db = await import(path.join(WWW, "db.js"));
  const css = read("styles.css");

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const text = () => document.body.textContent;

  async function until(fn, label, ms = 4000) {
    const t0 = Date.now();
    for (;;) {
      try {
        const v = fn();
        if (v) return v;
      } catch {
        // not ready yet
      }
      if (Date.now() - t0 > ms) throw new Error("timed out waiting for: " + label);
      await sleep(5);
    }
  }

  /** Navigate to a hash route and wait until a fresh view has rendered (and `ready()` is true). */
  async function go(hash, ready) {
    if (location.hash === hash) {
      location.hash = "#/";
      await sleep(30);
    }
    const before = $("#view").firstElementChild;
    location.hash = hash;
    await until(
      () => $("#view").firstElementChild && $("#view").firstElementChild !== before && (!ready || ready()),
      `render ${hash}`);
    await sleep(25); // let async banners settle
  }

  const usedClasses = new Set();

  /** The checks every screen must pass: no pacing words, no inline styles (CSP). */
  function audit(where) {
    assert.ok(!FORBIDDEN.test(text()), `forbidden pacing word on ${where}: ${text().match(FORBIDDEN)?.[0]}`);
    assert.equal($$("[style]").length, 0, `inline style attribute on ${where} (CSP)`);
    for (const el of $$("[class]")) el.classList.forEach((c) => usedClasses.add(c));
  }

  const clickButton = (label) => {
    const b = $$("button").find((x) => x.textContent === label);
    assert.ok(b, `no button "${label}"`);
    b.click();
  };
  const hasButton = (...labels) => $$("button").some((b) => labels.includes(b.textContent));
  const clickNext = async () => {
    $$("button").find((b) => b.textContent === "Next" || b.textContent === "Finish round").click();
    await sleep(15);
  };
  const hasLink = (href) => $$("a").some((a) => a.getAttribute("href") === href);
  const headsUps = () => $$(".note").filter((n) => n.textContent.includes("few steps past"));
  const left = () => Number(text().match(/(\d+) left in this round/)?.[1]);

  return {
    app, db, h: app.h, css, lettersRaw, vocabRaw,
    letters: lettersRaw.letters, words: vocabRaw.words,
    $, $$, text, until, go, audit, usedClasses,
    clickButton, hasButton, clickNext, hasLink, headsUps, left,
  };
}
