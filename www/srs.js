// Spaced-repetition scheduling (SM-2 variant). Pure functions: no I/O, no clock.
// Callers pass `now` (ms since epoch) so behavior is deterministic and testable.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const RELEARN_MS = 10 * 60 * 1000; // a failed card comes back in 10 minutes
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
    next.due = now + RELEARN_MS;
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

/** Due cards, most overdue first; optional deck filter and limit. */
export function pickDue(cards, now, { deck = null, limit = Infinity } = {}) {
  return cards
    .filter((c) => isDue(c, now) && (deck === null || c.deck === deck))
    .sort((a, b) => a.due - b.due)
    .slice(0, limit);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
