# Big Brainer: project guide

(Internal identifiers such as the app id, the database name and some file names still say "arabic-learner" on purpose. See 3.1.)

A self-hosted, fully offline Android app for learning Modern Standard Arabic (MSA) as a total beginner, with the long-term goal of reading and understanding the Quran. Built with Capacitor and plain JavaScript. All data stays on the phone.

Read this file before designing or building anything. Section 1 is the most important part of the project.

---

## 1. Design philosophy: self-paced, never time-gated

**Pacing belongs to the learner, above everything else.** The learner decides what to study, when, and for how long. The app suggests; it never insists.

### 1.1 Principles

1. **Never time-gated.** Nothing is ever locked, hidden, delayed, limited or refused because of the clock, a quota or a streak. No cooldowns, daily limits, "come back tomorrow" screens, countdowns, expiring content or timed unlocks.
2. **Progress comes from the learner's own results, not elapsed time.** Mastery (answers given) shapes suggestions. It never blocks access.
3. **Everything is open from day one.** All letters, lessons and tracks are reachable immediately. The curriculum is a *suggested path* with an "Up next" marker, not a staircase.
4. **Gentle heads-up, never a wall.** If the learner jumps far ahead (for example two or more groups past the suggested one), show one short, dismissible, friendly note that it may feel hard yet. Then let them continue. Do not repeat it for the same content once dismissed, and never require confirmation.
5. **Spaced repetition runs silently.** Timing only decides which cards come first. The UI never shows due dates, due counts, "overdue", or "come back later". Practice is always available. When nothing is scheduled, serve the weakest items first. Never show an empty state caused by scheduling.
6. **Motivation = progress plus quiet milestones.** Show what has been mastered (letters learned, accuracy, groups completed). Milestone messages ("All 28 letters seen") appear passively on the progress view, once, with no sound, vibration, popup or notification. No streaks, points, badges, levels, daily goals, reminders, leaderboards or guilt-trip copy.
7. **Mistakes are cheap and instructive.** On a wrong answer: show the correct answer, add one short note on what sets it apart (for example, the dot difference between look-alike letters), speak it aloud, and bring the item back later in the same session. No penalties, no lives, no lost progress, no red-alarm styling.
8. **Respect the learner.** No ads, tracking, accounts, upsells, dark patterns or nagging. Works with no network.

### 1.2 Design checklist (run before building any feature)

Ask these in order. If any answer is "yes", redesign before writing code.

- Can the clock, a quota or a streak ever stop the learner from doing something?
- Does any screen say, or imply, "wait", "later", "tomorrow", "locked", "unlock", "overdue", "due", "behind" or "don't break your streak"?
- Can the learner end up with nothing to do, or only a "come back later" message?
- Does the feature require a daily habit, a reminder or a notification to work?
- Does a wrong answer cost the learner anything (progress, points, access)?
- Can the learner reach any content directly, without finishing something else first?
- Is any progress shown as a score to protect, not information to use?

### 1.3 Wording

- Prefer: "Ready to practice", "Up next", "Review", "Revisit", "Keep going", "Take a break whenever you like".
- Avoid: due, overdue, locked, unlock, streak, daily, expires, deadline, behind, missed, penalty.
- Tone: calm, encouraging, plain language.

### 1.4 Violations log

**None open.** Fixed so far:

- Missed cards used to wait 10 minutes. They are now eligible immediately and come back a few questions later in the same round.
- "Unlock" semantics for letter groups became a *suggested path* (`suggestedGroup`). Nothing is gated.
- The Home card said "Due for review" with a count. It now says "Ready to practice" and shows no numbers.

Add any new violation here the moment it is found, then fix it.

---

## 2. Learning content and method

- **Language:** Modern Standard Arabic. **Goal:** read and understand the Quran. **Starting level:** total beginner (alphabet first).
- **Methods:** spaced repetition (SM-2 variant), active recall, chunking (letters in small shape-based groups), interleaving, frequency-ordered vocabulary with a Quran-focused track, short grammar lessons ending in a quiz.
- **Audio:** on-device text-to-speech only. Arabic voice quality varies by phone and handling of fully vowelled Quranic text can be uneven. Always handle the "no Arabic voice installed" case clearly.
- **Arabic text:** show beginner material with vowel marks (tashkeel). Render Arabic with the `.ar` class (RTL, a font stack with good tashkeel support). Joined letter forms use a zero-width joiner (U+200D, defined in `alphabet.js` as `String.fromCharCode(0x200d)`), never presentation-form code points.
- **Transliteration:** macron vowels (ā ī ū) and ḥ ṣ ḍ ṭ ẓ ʿ ʾ. The standard letter names must stay unique (ح is ḥāʾ, ه is hāʾ).
- **Accuracy rules:**
  - **Quranic text must come from a verified source. Never type or recall it from memory.**
  - Content written by Claude (example words, meanings, hints) is unreviewed until a fluent speaker checks it. Mark such content as unreviewed in the roadmap.
  - Verify letter data against the Unicode character database (the letter `id` is its Unicode name suffix).

---

## 3. Architecture

- **Platform:** Capacitor 8 wrapping a plain web app. Needs Node 22 and JDK 21.
- **Web app:** vanilla ES modules in `www/`, no bundler. `index.html` + `app.js` (hash router and shell) + `styles.css`.
- **Modules:**
  - `db.js`: IndexedDB wrapper (`cards` and `meta` stores). `addCardsIfMissing` seeds cards atomically and never overwrites existing progress; use it instead of `putCards` for seeding.
  - `srs.js`: pure scheduling functions. No I/O, no clock; callers pass `now`. `due` only orders practice (`practiceOrder`: ready cards first, then weakest first, never empty); `requeueAfter` brings missed items back within a round.
  - `alphabet.js`: pure logic for letters, cards, the suggested path (`suggestedGroup`, `groupMastery`, `farAhead`), question building and `mistakeNote`.
  - `tts.js`: native Android TTS first, Web Speech fallback.
  - `letters.json`: letter data in teaching order.
  - `letters-screen.js`: the Letters UI (grid, lesson, practice). Built with `createLettersScreen({ h, ...injectables })` so tests can swap storage, speech and the clock.
  - `vocab.json`: word list (id, vowelled Arabic, transliteration, meaning, part of speech) in teaching order, roughly common-first. **Not a measured frequency list.** 100 words, written by Claude, unreviewed.
  - `vocab.js`: pure logic for words: validation (unique ids, Arabic and meanings), sets of 10 (`SET_SIZE`), cards (`ar2en`, `en2ar`), `setMastery`, `suggestedSet`, `buildQuestion` (wrong options from the same set and part of speech first) and `mistakeNote`. Reuses `farAhead` from `alphabet.js`.
  - `vocab-screen.js`: the Cards UI (sets overview, practice). Built with `createVocabScreen({ h, ...injectables })`, same pattern as the Letters screen.
- **Security and offline:** the CSP in `index.html` forbids inline scripts and styles and any external request. Keep it that way. Build DOM with the `h()` helper, not `innerHTML` with dynamic content.
- **Routing:** hash routes. The first segment picks the screen; screens receive `{ parts, setTitle }`. Letters sub-routes: `#/alphabet`, `#/alphabet/letter/<id>`, `#/alphabet/practice`, `#/alphabet/practice/group/<n>`, `#/alphabet/practice/letter/<id>`. Unknown ids fall back to the grid. Cards sub-routes: `#/cards`, `#/cards/practice`, `#/cards/practice/set/<n>`; anything unknown falls back to the sets overview. Hardware Back works because every view is a hash route.
- **Practice layout (Letters and Cards share it):**
  - The action bar (`.actions-bar`: Next, Skip, Keep going, Practice this letter) is pinned just above the tab bar, so the learner never scrolls to continue.
  - Answers are **one full-width column** so the app works one-handed. A 2x2 grid is used **only on short screens** (`max-height: 700px`) where a single column would not fit. Do not change this without asking the owner.
  - Target: a whole question, its feedback and Next fit on one phone screen with no scrolling (checked at 360x640, 393x852, 412x915). Feedback wording is the owner's favourite: change layout, not wording.
  - Notes (heads-up, voice banner) are compact rows: text plus a small button side by side.
- **Practice rules in code:** rounds of 10; a correct answer grades "good", an answer that is not right grades "again" and the card returns 3 questions later; Skip moves a card to the end without grading; nothing advances on a timer.
- **Pure logic stays pure.** Keep logic (scheduling, question building, validation) free of the DOM and storage so it can be tested in Node.
- **Android project:** `android/` is generated fresh in CI and is not committed.

### 3.1 Data safety (the learner's progress is sacred)

- Never change the `appId` (`com.dallen0.arabiclearner`) or the signing key. Doing either forces an uninstall, which erases all progress.
- **The display name is only a label** (`appName` in `capacitor.config.json`, currently "Big Brainer") and is safe to change. **The IndexedDB name `arabic-learner` in `db.js` is not the display name and must never change.** Renaming it would open an empty database and make the learner's progress appear to vanish. Leave the old "arabic-learner" identifiers alone even when the app is renamed.
- IndexedDB changes need a version bump and a migration. Never drop or rename a store without migrating its data.
- Card ids are stable identifiers (`alphabet:<letter>:<kind>[:<position>]`, `vocab:<word id>:<ar2en|en2ar>`). Word ids in `vocab.json` are part of the card id, so never rename or reuse one; only append new words. Never change an id format without a migration.
- Never ship anything that clears storage.

### 3.2 Build and release

- GitHub Actions (`.github/workflows/build-apk.yml`) builds on every push to `main`, and on manual run.
- The release APK is signed with repository secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). Without them the workflow falls back to a debug APK, which cannot be updated in place. Do not rely on that fallback.
- `versionCode` is set from the run number so each build installs over the last.
- Download from the run page: Actions, a run, Artifacts, `arabic-learner-apk`.

---

## 4. Working rules for Claude (from the owner's preferences)

1. **Before writing any code, describe the approach and wait for approval.**
2. **If the requirements are ambitious, ask clarifying questions before writing code.**
3. **After writing code, list the edge cases and suggest test cases.**
4. **If a task needs changes to more than 3 files, stop and split it into smaller tasks first.**
5. **For a bug, first write a test that reproduces it, then fix it until the test passes.**
6. **When corrected, reflect on what went wrong and propose a plan so it does not happen again.**

Also:
- One commit per task, with a clear message. Push to `main` and confirm the Actions build is green and signed.
- **Every time an update is pushed, give the owner the direct download link** for that build's APK artifact (once the build is green and signed), so they never have to search for it. Also say which run number it is.
- Run the design checklist in 1.2 as part of describing any approach.
- Run a syntax check and real tests before committing. Report plainly what was and was not verified, including anything that could not be tested without a device.
- Keep replies short and phone-friendly. The owner mostly reads on a phone.
- **Never paste invisible or look-alike characters literally** (zero-width joiners, directional marks, special spaces). Write them with explicit code such as `String.fromCharCode(0x200d)` and verify the file bytes. This slipped through once and made a source file fragile.
- **Check layout in a real browser, not only jsdom.** jsdom has no layout. Drive the real `www/` in headless Chrome (playwright-core with `/usr/bin/google-chrome`) at 360x640, 393x852 and 412x915, with and without the voice warning, and check that the answers, feedback and Next are visible and nothing scrolls. Any change to practice screens or `styles.css` needs this check.
- **Ask before changing how the app is tapped or laid out** (button placement, grid vs column, size). The owner uses it one-handed on a phone. Describe the change and wait.
- **Tests live in `test/`** (own `package.json`, so the APK build never installs them). Run: `cd test && npm install && npm test` (about 20 seconds). `logic.test.mjs` covers scheduling, letters, vocab, speech and storage; `ui.test.mjs` drives the real app in jsdom; `layout.test.mjs` uses real Chrome (set `CHROME=/path/to/chrome`; skipped if not found). All must pass before every commit. Prove a new check works by breaking the app on purpose and watching it fail. Keep invisible characters out of tests too (use `ZWJ`).
- **Test the UI for real:** run the actual `www/` app in jsdom with `fake-indexeddb` and drive it like a learner. Include the pacing checks: no forbidden words in any screen, practice never empty, nothing blocked, no inline `style` attributes (CSP), every CSS class used is defined.

---

## 5. Roadmap and status

Done: test suite in `test/`, app shell, IndexedDB storage, SM-2 engine, text-to-speech wrapper, alphabet data and logic, pacing foundation, Letters screen (grid, lessons, practice), signing and CI, compact one-screen practice layout, vocab flashcards (100 words, 10 sets, both directions, multiple choice).

Next, in order:
1. Grow vocab: extend the list (target about 200) using an open frequency list to rank words (Leipzig Corpora, CC BY 4.0, is the candidate; Kelly is non-commercial, OpenSubtitles is share-alike, CAMeL's licence is unconfirmed; credit whatever is used), then add a Quran-focused word track. Quranic text and word lists for it must come from a verified source.
2. Quiz engine (answer-speed grading is allowed here, but never time pressure or timers shown to the learner).
3. Grammar lessons, Quran reading track, handwriting canvas.

### Known gaps

- Example words and hints in `letters.json` are unreviewed by a native speaker.
- All 100 words in `vocab.json` (Arabic forms, transliteration, meanings, order) are unreviewed by a fluent speaker, and the order is not a measured frequency ranking.
- Text-to-speech output and the Arabic fonts for the word lists have not been checked on a real device. The owner has confirmed on their phone that the Letters practice fits one screen. UI logic is tested in jsdom, layout in headless Chrome.
- GitHub Actions versions show Node deprecation warnings (cosmetic).
- Practice grades only right or wrong. Finer grading (hard, easy) waits for the quiz engine.
