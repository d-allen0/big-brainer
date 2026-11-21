// Match logic: pair up Arabic items with their meanings, 5 pairs per page, 10 per round.
// Pure: no DOM, no storage, no clock. Callers pass `now` and an `rng`.
//
// PACING RULES (CLAUDE.md section 1): a round is just a set of pairs to match. Wrong matches cost
// nothing: both tiles reset, a short note says what goes with what, and the item comes back on a
// short extra page at the end of the round. There is no score, timer, speed or limit.

import * as srs from "./srs.js";
import * as alphabet from "./alphabet.js";
import * as vocab from "./vocab.js";
import * as phrasesMod from "./phrases.js";

export const MATCH_SIZE = 10;
export const PAGE_SIZE = 5;
// How many of each deck a round aims for (letters, words, phrases). Short decks are topped up from the others.
export const QUOTAS = Object.freeze({ [alphabet.DECK]: 4, [vocab.DECK]: 3, [phrasesMod.DECK]: 3 });
const DECK_ORDER = [alphabet.DECK, vocab.DECK, phrasesMod.DECK];

/**
 * Cards that have an Arabic side and a meaning side: a letter's "name" card, and the Arabic-to-English
 * card of a word or phrase. (`front` is the Arabic and `back` is its meaning for all of these.)
 */
export function isMatchable(card) {
  const kind = card?.extra?.kind;
  if (card?.deck === alphabet.DECK) return kind === "name";
  if (card?.deck === vocab.DECK || card?.deck === phrasesMod.DECK) return kind === "ar2en";
  return false;
}

/** The two sides of a pair, from a card. */
export const toItem = (card) => ({ id: card.id, deck: card.deck, ar: card.front, meaning: card.back });

/**
 * Choose the cards for one round: weakest first inside each deck (srs.practiceOrder), about 4 letters,
 * 3 words and 3 phrases. No two chosen items share the same Arabic or the same meaning, so every
 * pair has exactly one partner. Never empty while any matchable card exists.
 */
export function pickMatchCards({ cards, now, size = MATCH_SIZE }) {
  if (!Number.isInteger(size) || size < 0) throw new RangeError("size must be a non-negative integer");
  const pool = cards.filter(isMatchable);
  const lists = Object.fromEntries(DECK_ORDER.map((deck) => [deck, srs.practiceOrder(pool, now, { deck })]));
  const usedAr = new Set();
  const usedMeaning = new Set();
  const out = [];
  const take = (deck, limit) => {
    let taken = 0;
    const list = lists[deck];
    while (list.length && taken < limit && out.length < size) {
      const card = list.shift();
      if (usedAr.has(card.front) || usedMeaning.has(card.back)) continue;
      usedAr.add(card.front);
      usedMeaning.add(card.back);
      out.push(card);
      taken++;
    }
  };
  for (const deck of DECK_ORDER) take(deck, QUOTAS[deck]);
  // Top up from whatever is left, one at a time in deck order, until the round is full.
  while (out.length < size && DECK_ORDER.some((d) => lists[d].length)) {
    for (const deck of DECK_ORDER) take(deck, 1);
  }
  return out;
}

/** A shuffled copy (Fisher-Yates). */
export function shuffled(items, rng = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Lay out one page: the Arabic tiles and the meaning tiles, each in its own shuffled order. The two
 * columns are never in the same order (when there is more than one pair), so the page cannot be
 * solved by tapping straight across.
 */
export function layoutPage(items, rng = Math.random) {
  const left = shuffled(items, rng);
  let right = shuffled(items, rng);
  for (let tries = 0; items.length > 1 && right.every((r, i) => r.id === left[i].id) && tries < 20; tries++) {
    right = shuffled(items, rng);
  }
  if (items.length > 1 && right.every((r, i) => r.id === left[i].id)) right = [...right.slice(1), right[0]];
  return {
    left: left.map((i) => ({ id: i.id, text: i.ar })),
    right: right.map((i) => ({ id: i.id, text: i.meaning })),
  };
}

/** Split into pages of `pageSize` (the last page may be shorter). */
export function pagesOf(items, pageSize = PAGE_SIZE) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError("pageSize must be a positive integer");
  const pages = [];
  for (let i = 0; i < items.length; i += pageSize) pages.push(items.slice(i, i + pageSize));
  return pages;
}

// ---- a round as plain data (nothing is mutated; each step returns a new state) ----

/**
 * Start a round from picked cards. phase: "main" (the pages), "retry" (one short extra page of the
 * items that had a wrong match) or "done".
 */
export function createRound(cards, rng = Math.random, pageSize = PAGE_SIZE) {
  const items = cards.map(toItem);
  const pages = pagesOf(items, pageSize);
  return {
    items,
    pages,
    page: 0,
    phase: pages.length ? "main" : "done",
    matched: [], // ids matched on the current page
    missed: [], // ids that had a wrong match during the main pages
    layout: pages.length ? layoutPage(pages[0], rng) : { left: [], right: [] },
  };
}

/** The items on the page being shown (including ones already matched). */
export const pageItems = (state) => (state.phase === "retry" ? state.retry : state.pages[state.page] ?? []);

/** Which page of how many, for a quiet "Page 1 of 2" label. The retry page is "Keep going". */
export const progress = (state) => ({ page: state.page + 1, pages: state.pages.length, retry: state.phase === "retry" });

/**
 * What goes with what, in plain words, for a wrong match. `left` is the item whose Arabic was tapped
 * and `right` the item whose meaning was tapped.
 */
export function mismatchNote(left, right) {
  return [`${left.ar} goes with ${left.meaning}.`, `${right.meaning} goes with ${right.ar}.`];
}

/**
 * Try one pair: the Arabic tile of `leftId` and the meaning tile of `rightId`.
 * Returns { state, correct, grades, note, advanced }:
 *  - correct: the two tiles belong together.
 *  - grades: [{ id, grade }] for an item that is now finished in the main pages: "good" if it never
 *    had a wrong match, "again" if it did. The retry page grades nothing (those items already count as "again").
 *  - note: two lines for a wrong match, else null.
 *  - advanced: "page", "retry" or "done" when this match completed a page, else null.
 */
export function pairUp(state, leftId, rightId, rng = Math.random) {
  if (state.phase === "done") throw new RangeError("the round is finished");
  const onPage = pageItems(state);
  const left = onPage.find((i) => i.id === leftId);
  const right = onPage.find((i) => i.id === rightId);
  if (!left || !right) throw new RangeError("tile is not on this page");
  if (state.matched.includes(leftId) || state.matched.includes(rightId)) throw new RangeError("tile is already matched");

  if (leftId !== rightId) {
    const missed = state.phase === "main" ? [...new Set([...state.missed, leftId, rightId])] : state.missed;
    return { state: { ...state, missed }, correct: false, grades: [], note: mismatchNote(left, right), advanced: null };
  }

  const matched = [...state.matched, leftId];
  const grades = state.phase === "main" ? [{ id: leftId, grade: state.missed.includes(leftId) ? "again" : "good" }] : [];
  let next = { ...state, matched };
  let advanced = null;

  if (matched.length === onPage.length) {
    if (state.phase === "main" && state.page + 1 < state.pages.length) {
      const page = state.page + 1;
      next = { ...state, page, matched: [], layout: layoutPage(state.pages[page], rng) };
      advanced = "page";
    } else if (state.phase === "main") {
      const retry = state.items.filter((i) => state.missed.includes(i.id));
      if (retry.length) {
        next = { ...state, phase: "retry", retry, matched: [], layout: layoutPage(retry, rng) };
        advanced = "retry";
      } else {
        next = { ...state, phase: "done", matched: [] };
        advanced = "done";
      }
    } else {
      next = { ...state, phase: "done", matched: [] };
      advanced = "done";
    }
  }
  return { state: next, correct: true, grades, note: null, advanced };
}
