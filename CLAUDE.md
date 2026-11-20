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

### 1.4 Known violations to fix

These exist in the code today and must be removed when the pacing foundation task lands:

- `www/srs.js`: `RELEARN_MS` makes a missed card wait 10 minutes. Missed cards should be eligible immediately and requeued a few questions later in the same session.
- `www/alphabet.js`: `unlockedGroupCount` uses "unlock" semantics. Rename and reframe it as a *suggested path* ("recommended group"). It must never gate access.
- `www/app.js`: the Home card says "Due for review" and shows a count. Change it to "Ready to practice".

---

## 2. Learning content and method

- **Language:** Modern Standard Arabic. **Goal:** read and understand the Quran. **Starting level:** total beginner (alphabet first).
- **Methods:** spaced repetition (SM-2 variant), active recall, chunking (letters in small shape-based groups), interleaving, frequency-ordered vocabulary with a Quran-focused track, short grammar lessons ending in a quiz.
- **Audio:** on-device text-to-speech only. Arabic voice quality varies by phone and handling of fully vowelled Quranic text can be uneven. Always handle the "no Arabic voice installed" case clearly.
- **Arabic text:** show beginner material with vowel marks (tashkeel). Render Arabic with the `.ar` class (RTL, a font stack with good tashkeel support). Joined letter forms use a zero-width joiner (`‍`), never presentation-form code points.
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
  - `db.js`: IndexedDB wrapper (`cards` and `meta` stores).
  - `srs.js`: pure scheduling functions. No I/O, no clock; callers pass `now`.
  - `alphabet.js`: pure logic for letters, cards, suggested path and question building.
  - `tts.js`: native Android TTS first, Web Speech fallback.
  - `letters.json`: letter data in teaching order.
- **Security and offline:** the CSP in `index.html` forbids inline scripts and styles and any external request. Keep it that way. Build DOM with the `h()` helper, not `innerHTML` with dynamic content.
- **Pure logic stays pure.** Keep logic (scheduling, question building, validation) free of the DOM and storage so it can be tested in Node.
- **Android project:** `android/` is generated fresh in CI and is not committed.

### 3.1 Data safety (the learner's progress is sacred)

- Never change the `appId` (`com.dallen0.arabiclearner`) or the signing key. Doing either forces an uninstall, which erases all progress.
- **The display name is only a label** (`appName` in `capacitor.config.json`, currently "Big Brainer") and is safe to change. **The IndexedDB name `arabic-learner` in `db.js` is not the display name and must never change.** Renaming it would open an empty database and make the learner's progress appear to vanish. Leave the old "arabic-learner" identifiers alone even when the app is renamed.
- IndexedDB changes need a version bump and a migration. Never drop or rename a store without migrating its data.
- Card ids are stable identifiers (`alphabet:<letter>:<kind>[:<position>]`). Never change an id format without a migration.
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
- Run the design checklist in 1.2 as part of describing any approach.
- Run a syntax check and real tests before committing. Report plainly what was and was not verified, including anything that could not be tested without a device.
- Keep replies short and phone-friendly. The owner mostly reads on a phone.

---

## 5. Roadmap and status

Done: app shell, IndexedDB storage, SM-2 engine, text-to-speech wrapper, alphabet data and logic, signing and CI.

Next, in order:
1. **Pacing foundation** (`srs.js`, `alphabet.js`): remove the violations in 1.4, add a weakest-first practice order, add a "suggested path" function and a "far ahead" check for the gentle heads-up.
2. **Letters screen** (`letters-screen.js`, `app.js`, `styles.css`): grid, lesson view with the four forms and audio, practice with explain-and-move-on feedback, Home card reworded.
3. Vocab flashcards, quiz engine, grammar lessons, Quran reading track, handwriting canvas.

### Known gaps

- Example words and hints in `letters.json` are unreviewed by a native speaker.
- Tests exist only as throwaway scripts. Add a `test/` folder using `node:test`.
- No `.gitignore` or `package-lock.json` yet.
- GitHub Actions versions show Node deprecation warnings (cosmetic).
- Text-to-speech and joined-letter rendering have not been checked on a real device.
