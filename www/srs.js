// Spaced-repetition scheduling (SM-2 variant). Pure functions: no I/O, no clock.
// Callers pass `now` (ms since epoch) so behavior is deterministic and testable.
//
// PACING RULE (see CLAUDE.md section 1): `due` only decides which cards come FIRST.
// It never hides, delays or blocks a card. Practice must always have something to serve.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_EASE = 1.3;
export const START_EASE = 2.5;

// Button label -> SM-2 quality (0-5).
export const GRADES = Object.freeze({ again: 0, hard: 3, good: 4, easy: 5 });

/** Create a new, immediately-due card. */
export function newCard({ id, deck, front, back, extra = null }, now) {
  if (!id || !deck) throw new TypeError("newCard requires id and deck");
  if (!Number.isFinite(now)) throw new TypeError("newCard requires a numeric `now`");
  return {
    id,
    deck,
    front,
    back,
    extra,
    ease: START_EASE,
    interval: 0, // days
    reps: 0, // consecutive successful reviews
    lapses: 0,
    due: now,
    createdAt: now,
    lastReviewed: null,
  };
}

/**
 * Apply one review and return a NEW card (input is not mutated).
 * grade: integer 0-5 (see GRADES). Below 3 counts as a lapse.
 */
export function review(card, grade, now) {
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) {
    throw new RangeError("grade must be an integer from 0 to 5");
  }
  if (!Number.isFinite(now)) throw new TypeError("review requires a numeric `now`");

  const next = { ...card, lastReviewed: now };

  if (grade < 3) {
    next.reps = 0;
    next.interval = 0;
    next.lapses = card.lapses + 1;
    next.due = now; // a missed card is eligible again right away; no waiting
  } else {
    if (card.reps === 0) next.interval = 1;
    else if (card.reps === 1) next.interval = 6;
    else next.interval = Math.max(1, Math.round(card.interval * card.ease));
    next.reps = card.reps + 1;
    next.due = now + next.interval * DAY_MS;
  }

  // Standard SM-2 ease update, applied on every review and floored.
  const q = grade;
  const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  next.ease = Math.max(MIN_EASE, round2(card.ease + delta));
  return next;
}

export function isDue(card, now) {
  return card.due <= now;
}

/**
 * Cards in the order they should be practiced. NEVER hides a card and never returns an
 * empty list while matching cards exist (unless limit is 0).
 *   1. Cards whose time has come, most overdue first.
 *   2. Everything else, weakest first (lowest ease, then most lapses, then fewest
 *      correct answers in a row), soonest-due as the tie-break.
 * Optional deck filter and limit.
 */
export function practiceOrder(cards, now, { deck = null, limit = Infinity } = {}) {
  if (!(limit === Infinity || (Number.isInteger(limit) && limit >= 0))) {
    throw new RangeError("limit must be a non-negative integer or Infinity");
  }
  if (!Number.isFinite(now)) throw new TypeError("practiceOrder requires a numeric `now`");
  const pool = cards.filter((c) => deck === null || c.deck === deck);
  const ready = pool.filter((c) => isDue(c, now)).sort((a, b) => a.due - b.due || weaker(a, b));
  const rest = pool.filter((c) => !isDue(c, now)).sort((a, b) => weaker(a, b) || a.due - b.due);
  return [...ready, ...rest].slice(0, limit);
}

/** Put a missed item back into a session queue a few places later (not mutating the queue). */
export function requeueAfter(queue, item, gap = 3) {
  if (!Number.isInteger(gap) || gap < 0) throw new RangeError("gap must be a non-negative integer");
  const at = Math.min(gap, queue.length);
  return [...queue.slice(0, at), item, ...queue.slice(at)];
}

// Negative when `a` is weaker than `b`.
function weaker(a, b) {
  return a.ease - b.ease || b.lapses - a.lapses || a.reps - b.reps;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
