# Big Brainer: project guide

(Internal identifiers such as the app id, the database name and some file names still say "arabic-learner" on purpose. See 3.1.)

A self-hosted, fully offline Android app for learning Modern Standard Arabic (MSA) as a total beginner, with the goal of holding simple conversations and reading with understanding. That includes, in time, being able to read the Quran. Built with Capacitor and plain JavaScript. All data stays on the phone.

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

- **Language:** Modern Standard Arabic. **Goal:** conversation and reading comprehension (which ultimately includes reading the Quran). **Starting level:** total beginner (alphabet first).
- **Methods:** spaced repetition (SM-2 variant), active recall, chunking (letters in small shape-based groups), interleaving, frequency-ordered vocabulary, common phrases and short sentences, graded reading and dialogues, short grammar lessons ending in a quiz.
- **Audio:** on-device text-to-speech only. Arabic voice quality varies by phone and handling of fully vowelled text can be uneven. Always handle the "no Arabic voice installed" case clearly.
- **Arabic text:** show beginner material with vowel marks (tashkeel). Render Arabic with the `.ar` class (RTL, a font stack with good tashkeel support). Joined letter forms use a zero-width joiner (U+200D, defined in `alphabet.js` as `String.fromCharCode(0x200d)`), never presentation-form code points.
- **Transliteration:** macron vowels (ā ī ū) and ḥ ṣ ḍ ṭ ẓ ʿ ʾ. The standard letter names must stay unique (ح is ḥāʾ, ه is hāʾ).
- **Accuracy rules:**
  - **Quranic text (if it is ever added as reading material) must come from a verified source. Never type or recall it from memory.**
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
  - `tts.js`: native Android TTS first, Web Speech fallback. Also lists Arabic voices (`listVoices`, offline voices first, the first one is the automatic pick), and holds the learner's voice and speed (`setPreferences`, `SPEEDS`: slow 0.6, normal 0.8, fast 1.0). A chosen voice that is gone quietly falls back to automatic. Voices are matched by stable id, never by list position.
  - `options-screen.js`: the Voice options UI (`createOptionsScreen({ h, ...injectables })`). Saves the choice in the `meta` store under `speech.prefs`; `app.js` applies it at startup (`applySavedVoice`).
  - `letters.json`: letter data in teaching order.
  - `letters-screen.js`: the Letters UI (grid, lesson, practice). Built with `createLettersScreen({ h, ...injectables })` so tests can swap storage, speech and the clock.
  - `vocab.json`: word list (id, vowelled Arabic, transliteration, meaning, part of speech) in teaching order, roughly common-first. **Not a measured frequency list.** 100 words, written by Claude, unreviewed.
  - `vocab.js`: pure logic for words: validation (unique ids, Arabic and meanings), sets of 10 (`SET_SIZE`), cards (`ar2en`, `en2ar`), `setMastery`, `suggestedSet`, `buildQuestion` (wrong options from the same set and part of speech first) and `mistakeNote`. Reuses `farAhead` from `alphabet.js`.
  - `phrases.json` / `phrases.js`: 40 common phrases in 4 sets of 10 (greetings, politeness, everyday needs, questions and numbers), same shape as vocab. Card ids `phrase:<phrase id>:<ar2en|en2ar>`. Written by Claude, unreviewed.
  - `vocab-screen.js`: the Cards UI (sets overview, practice) for every deck. Built with `createVocabScreen({ h, ...injectables })`, same pattern as the Letters screen. A `DECKS` table describes each deck (Words, Phrases); a new deck is one more entry plus its data and logic module.
  - `quiz.js`: pure logic for quizzes: `pickQuizCards` (letters, words and phrases interleaved, weakest first), `buildQuizQuestion` (types `choice`, `listen`, `type`), `checkTyped`, `speedGrade`, `seedForQuiz`, `explain`. A card never seen before is always plain multiple choice. `listen` needs a working Arabic voice. `type` is for words only (type the English meaning). Phrases get `choice` (both directions) and `listen` (seen ar2en cards, voice needed), never `type`.
  - `quiz-screen.js`: the Quiz UI, built with `createQuizScreen({ h, ...injectables })` (storage, speech, `now`, `clock`, `rng` can be swapped in tests). Reuses the practice layout.
  - `match.js`: pure logic for Match: `isMatchable` (a letter's `name` card, a word's or phrase's `ar2en` card; `front` is the Arabic, `back` the meaning), `pickMatchCards` (10 items weakest-first, about 4 letters, 3 words, 3 phrases, no repeated Arabic or meaning, decks alternated so each page of 5 is a mix), `layoutPage` (two shuffled columns, never lined up straight across), `pagesOf`, and a round as plain data: `createRound`, `pairUp` (returns grades as names, `good`/`again`), `mismatchNote`, `progress`. A wrong pair marks both items; items matched cleanly grade good, items with a wrong pair grade again, and they come back on one short extra page (the retry page grades nothing). `pickMatchCards` takes an optional `deck` for a one-deck round (that deck's weakest first, up to 10), and `seedForDeck` makes sure such a round has 10 pairs: the suggested group or set in full, then, only if short, the matchable card of each following group or set, wrapping to earlier ones. It never returns existing cards, so progress is never touched.
  - `match-screen.js`: the Match UI, built with `createMatchScreen({ h, ...injectables })` (storage, speech, `now`, `rng`). Reads `parts[1]` (`letters`, `words`, `phrases`; anything else is the mixed round) and titles the screen `Match`, `Match letters`, `Match words` or `Match phrases`; Keep going starts another round of the same deck. Turns grade names into numbers with `srs.GRADES` (`srs.review` needs an integer).
  - `dialogues.json` / `dialogues.js`: 6 short two-person conversations (4 to 6 lines each: greeting, names, shop, directions, family, café), each line with vowelled Arabic, transliteration and meaning, `who` a (Ahmad, a man) or b (Layla, a woman). Pure logic: `parseDialogues` (validation), `findDialogue`, `suggestedDialogue` (first one not opened yet; starts over, never empty), `markOpened`, `hearAllTexts`. Written by Claude, unreviewed.
  - `texts.json` / `texts.js`: 12 graded short readings, easiest first (level 1: one sentence; level 2: 2 to 3; level 3: 4 to 6), each sentence with vowelled Arabic, transliteration and meaning, plus one comprehension question (`question.options`, the right one listed first in the file, `answer` its index). Pure logic: `parseTexts` (validation, incl. sentences per level, vowel marks, no invisible characters), `findText`, `byLevel`, `levelLabel`, `suggestedText` (first one not opened yet; starts over, never empty), `markOpened`, `hearAllTexts`, `buildQuestion` (options shuffled, each tracked by its original index) and `checkAnswer` (always returns the right answer and a short note; nothing is scored). Written by Claude, unreviewed.
  - `read-screen.js`: the Read tab UI, built with `createReadScreen({ h, ...injectables })` (`loadDialogues`, `loadTexts`, `store`, `speech`, `rng`). A `Dialogues | Texts` switch tops both lists. Dialogues: the list, and a dialogue as chat bubbles. Texts: a list grouped by level, and a text as tap-for-meaning sentences plus one question. Remembers what was opened in the `meta` store under `read.opened` (dialogues) and `read.textsOpened` (texts); each only moves its own Up next marker. The speech code (speaker per row, Hear whole ..., stop on leaving) is shared by both.
- **Security and offline:** the CSP in `index.html` forbids inline scripts and styles and any external request. Keep it that way. Build DOM with the `h()` helper, not `innerHTML` with dynamic content.
- **Routing:** hash routes. The first segment picks the screen; screens receive `{ parts, setTitle }`. Letters sub-routes: `#/alphabet`, `#/alphabet/letter/<id>`, `#/alphabet/practice`, `#/alphabet/practice/group/<n>`, `#/alphabet/practice/letter/<id>`. Unknown ids fall back to the grid. Cards sub-routes (Words): `#/cards`, `#/cards/practice`, `#/cards/practice/set/<n>`; Phrases: `#/cards/phrases`, `#/cards/phrases/practice`, `#/cards/phrases/practice/set/<n>`. Anything unknown falls back to that deck's sets overview (an unknown first segment falls back to Words). Quiz route: `#/quiz` (opened by the "Take a quiz" button on Home; the tab bar stays at 4 tabs). Voice options route: `#/options` (opened by the "Voice options" button in the Welcome card on Home; a side screen, no tab highlighted). Match routes: `#/match` (mixed; opened by the Match button in Mixed practice on Home), `#/match/letters`, `#/match/words`, `#/match/phrases` (one deck; opened by the Match button in that deck's Home row; an unknown deck falls back to the mixed round). Side screens, no tab highlighted. Read routes: `#/read` (the dialogues list), `#/read/dialogue/<id>`, `#/read/texts` (the texts list) and `#/read/text/<id>`. An unknown or missing id falls back to that kind's list. Hardware Back works because every view is a hash route.
- **Practice layout (Letters and Cards share it):**
  - The action bar (`.actions-bar`: Next, Skip, Keep going, Practice this letter) is pinned just above the tab bar, so the learner never scrolls to continue.
  - Answers are **one full-width column** so the app works one-handed. A 2x2 grid is used **only on short screens** (`max-height: 700px`) where a single column would not fit. Do not change this without asking the owner.
  - Target: a whole question, its feedback and Next fit on one phone screen with no scrolling (checked at 360x640, 393x852, 412x915). Feedback wording is the owner's favourite: change layout, not wording.
  - Notes (heads-up, voice banner) are compact rows: text plus a small button side by side.
- **System-bar room:** Android draws the app edge to edge. `styles.css` defines `--inset-top` and `--inset-bottom` as the larger of `env(safe-area-inset-*)` and Capacitor's `--safe-area-inset-*` variables. The pinned title bar carries the top inset as padding (so it never slides under the status bar); the tab bar and action bar use the bottom one. Use these variables, never `env()` directly. Checked in `layout.test.mjs` by setting the variables in Chrome; the real values on a phone are unverified.
- **Home layout:** the Welcome card holds the Voice options button. The Ready to practice card has a `Letters`, a `Words` and a `Phrases` heading, each with a `Practice | Browse | Match` row (`.btn-pair`: equal buttons side by side, one filled and two outlined, sized by how many it holds; about 93px each at 360px), then a `Mixed practice` heading with a `Take a quiz | Match` pair. Keep labels short enough that each row fits on one line at 360px wide; do not go back to long labels that wrap into a list. Checked in `layout.test.mjs` at three sizes and with a taller font.
- **Read layout:** the list is one full-width row per dialogue (title, line count, a quiet `Up next` tag on one of them; every row is a link, nothing is locked). A dialogue is chat bubbles: speaker a on the left, b on the right (`.bubble-row.who-b` is reversed), each bubble a button that shows or hides the transliteration and meaning, with a small 🔊 beside it. `Hear whole dialogue` is in the pinned action bar above the tab bar and turns into `Stop` while playing; nothing is spoken until a button is pressed, and leaving the screen stops the speech. Without an Arabic voice a note appears and that button is off; reading still works. Checked in `layout.test.mjs` at three sizes with every line opened and with a taller font.
- **Texts layout:** the `Dialogues | Texts` switch (`.segmented`, the same style as the Cards switch, current one marked with `aria-current="true"`) tops both Read lists. The texts list has a `Level 1`, `Level 2` and `Level 3` heading, each followed by full-width rows (`.dialogue-row`: title, `1 sentence` / `N sentences`, a quiet `Up next` tag on one of them; every row is a link, a level is only a label). A text is rows of sentences in the same tap-for-meaning bubbles as a dialogue (no speaker names, all on the left, a small 🔊 beside each), then the question (`.choices`, so one column, or 2x2 on short screens like the practice screens) and its `.feedback` (`Yes!` or `Not quite.`, for a wrong answer `The answer is: ...` and a short note). `Hear whole text` is in the pinned action bar and turns into `Stop` while playing. A long text and its question may be taller than one screen: that is allowed here (unlike practice), as long as every option and the answer note can be scrolled clear of the pinned bar. No new CSS was needed. Checked in `layout.test.mjs` for all 12 texts at three sizes, with and without the voice banner and with a taller font, with every sentence opened and a wrong answer given.
- **Match layout:** two columns of tiles, Arabic on the left (`.tile.ar`) and the meaning on the right, 5 pairs per page, 2 pages, then at most one short extra page. Tap an Arabic tile, then its partner; tapping another tile on the same side swaps the choice, tapping the chosen tile lets it go. A right pair fades (`.tile.done`) and is spoken; a wrong pair resets both tiles and shows `Not quite.` plus two plain lines in `.match-feedback`. A finished page stays on screen, faded, until the learner presses `Next page`, `Keep going` or `Finish round` in the pinned action bar (nothing advances on a timer). The label is `Page 1 of 2`, `Another look` for the extra page; the summary says `All 10 pairs matched.` and shows no score. The one-deck rounds use the same screen and layout (only the title differs). Checked in `layout.test.mjs` at three sizes over several rounds, with wrong-pair notes and a taller font, for the mixed round and for each one-deck round (letters, words, phrases; the one-deck runs do 2 rounds each and also check every Arabic tile belongs to that deck).
- **Cards toggle:** the sets overview starts with a full-width `Words | Phrases` switch (links, current deck marked with `aria-current="true"`, never `page`, which belongs to the tab bar). Phrase sets list one phrase per row; word sets use the two-column tiles. Each deck keeps its own heads-up memory (`vocab.headsUpDismissed`, `phrases.headsUpDismissed`) and its own progress.
- **Voice options:** Voice (Automatic plus each Arabic voice, with a 🔊 sample per row and "works offline" / "needs internet" labels) and Speed (Slow | Normal | Fast). Choosing a voice or speed never plays anything by itself; sample sounds play only when a speaker button is pressed. Saved choices never block anything: unusable settings mean the defaults, and a missing voice is explained on the screen.
- **Practice rules in code:** rounds of 10; a correct answer grades "good", an answer that is not right grades "again" and the card returns 3 questions later; Skip moves a card to the end without grading; nothing advances on a timer.
- **Quiz rules in code:** rounds of 10, mixed letters, words and phrases. Nothing is spoken before an answer; the listen question has a 🔊 button the learner presses (never autoplay). Answer speed is measured silently and only picks the grade (`quiz.speedGrade`: wrong = again; quick and right = easy; slow and right = hard; first view, interrupted (app left, or over 60 s) = good). Never show a timer, speed or "faster" wording, and slow is never a lapse. Typed answers: case, accents, punctuation and a leading "to/the/a" are ignored; one slip is accepted only for answers of 6+ letters ("Yes! Just a small slip in spelling."); an exact match of a different word's meaning is wrong and says what it means. An empty Check shows a gentle message and does not grade. Without an Arabic voice there are no listen questions.
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

Done: test suite in `test/`, app shell, IndexedDB storage, SM-2 engine, text-to-speech wrapper, alphabet data and logic, pacing foundation, Letters screen (grid, lessons, practice), signing and CI, compact one-screen practice layout, vocab flashcards (100 words, 10 sets, both directions, multiple choice), phrase flashcards (40 phrases, 4 sets, behind a Words | Phrases toggle in Cards), quiz engine (mixed letters, words and phrases; choose, listen-and-pick, type-the-answer; silent speed grading), voice options (choose the Arabic voice and speed from Home), dialogues in the Read tab (6 conversations, chat bubbles, tap for meaning, speaker per line and Hear whole dialogue), Match (10 mixed items, two pages of 5, tap an Arabic tile then its meaning), and Match for Letters, Words and Phrases individually (a third button in each Home row; letters fill from the next groups), and graded short texts in the Read tab (12 texts, 3 levels, a Dialogues | Texts switch).

Next, in order (agreed with the owner):
1. (Done: phrases in Cards, in the quiz (choice and listen only), and Home Phrases buttons.)
2. (Done: dialogues in the Read tab.) Possible follow-ups: more dialogues; a comprehension question per dialogue.
3. (Done: graded short texts in the Read tab: 12 texts in 3 levels, tap-for-meaning per sentence, one unscored question each, behind a Dialogues | Texts switch.) Possible follow-ups: more texts; tap-for-meaning per word (needs a gloss for every word); hiding vowel marks as an option; more than one question per text; a word-reuse check against Cards (not built: matching Arabic words reliably needs prefix and article handling).
4. Grow vocab (target about 200) using an open frequency list (Leipzig Corpora, CC BY 4.0, is the candidate; Kelly is non-commercial, OpenSubtitles is share-alike, CAMeL's licence is unconfirmed; credit whatever is used). Parked: needs a list the sandbox can reach.
5. Grammar lessons, handwriting canvas, and Quran passages as one more reading source (verified text only).

### Known gaps

- Example words and hints in `letters.json` are unreviewed by a native speaker.
- Voice options have not been tried on a real phone: which voices the plugin lists, what they are called and whether choosing one changes the sound are unverified.
- All 40 phrases in `phrases.json` are unreviewed by a fluent speaker (vowel marks, naturalness, masculine forms). The toggle's feel one-handed has not been tried on a device.
- Match has not been tried on a real phone: how tapping two columns of tiles feels one-handed, and the tile text at the real Arabic font, are unverified. The same goes for the three-button Home rows (`Practice | Browse | Match`).
- All 6 dialogues in `dialogues.json` are unreviewed by a fluent speaker (vowel marks, naturalness, feminine forms when speaking to Layla). The bubble layout, the speech reading whole dialogues and the Arabic font have not been tried on a real phone.
- All 12 texts in `texts.json` (vowel marks, transliteration, naturalness, the questions) are unreviewed by a fluent speaker. Some words in them are new to Cards (for example عِنْدِي and أُسْرَتِي); their meaning is one tap away. The switch's feel one-handed, the speech reading whole texts and the Arabic font have not been tried on a real phone.
- All 100 words in `vocab.json` (Arabic forms, transliteration, meanings, order) are unreviewed by a fluent speaker, and the order is not a measured frequency ranking.
- Text-to-speech output and the Arabic fonts for the word lists have not been checked on a real device. The owner has confirmed on their phone that the Letters practice fits one screen. UI logic is tested in jsdom, layout in headless Chrome.
- GitHub Actions versions show Node deprecation warnings (cosmetic).
- Letters and Cards practice grade only right or wrong. The quiz grades finer (easy, good, hard) from silent answer speed.
- The quiz's typing questions have not been tried with a real phone keyboard (autocorrect, layout shift). Speed thresholds in `quiz.SPEED` are guesses and may need tuning from real use.
