# Big Brainer: content and learning-path plan

Companion to `CLAUDE.md`. CLAUDE.md says how the app works and the rules for building it (section 1, the self-paced philosophy, always wins). This file says what to teach, in what order, and why. Last updated 2026-11-22.

Every item below must pass the design checklist in CLAUDE.md 1.2 before it is built: nothing gated, no clock or streak pressure, a suggestion ("Up next") and never a wall. Per CLAUDE.md section 4, each item is described and approved before any code is written, and any item touching more than 3 files is split first.

---

## 1. Where the app is now

Built: letters (groups, lessons, practice), 100 words, 40 phrases, quiz (choose, listen, type), Match, 6 dialogues, 12 graded texts, voice options, SM-2 scheduling that runs silently.

Not built: vowel-mark and pronunciation-rule lessons, grammar, handwriting, Quran reading, a measured frequency vocabulary, a single path across the tabs.

All Arabic written by Claude is unreviewed by a fluent speaker (see Known gaps in CLAUDE.md). Nothing has been checked on a real device except Letters practice layout.

## 2. Target path (suggested, never enforced)

The goal is conversation and reading with understanding, ending with reading the Quran. These stages are an "Up next" suggestion across tabs. Every stage stays open from day one.

| Stage | Focus | Status |
|---|---|---|
| 0 | Letters: shapes, names, sounds | Built |
| 1 | Short vowels, long vowels, sukūn, shadda, tanwīn, hamza, tāʾ marbūṭa, alif maqṣūra, taught in syllables and real words | Not built |
| 2 | Core vocab, phrases, first grammar | Vocab and phrases built; grammar not |
| 3 | Graded texts and dialogues | Built (small) |
| 4 | Quranic script and tajwīd basics, then short passages from verified text | Not built |

## 3. Content roadmap

Priority order. Each item lists what it adds and a rough split into tasks of 3 files or fewer. File names are proposals.

### P1. Vowel marks and reading rules (Stage 1)
- **Status:** one path with the letters (a "Read it" step after groups 1, 3, 4, 5, 7 and 8; reading-practice steps after groups 2 and 6 and hamza / alif maqsura come later). Task 1 (data and logic, `marks.json` / `marks.js`) is done. Tasks 2 to 5 below are still to build.
- Lessons for each mark and rule above, each ending in a short quiz, using the existing lesson and practice patterns.
- Practise on syllables, then real words from vocab.json.
- Listening drills for confusable sounds: ح/ه/خ, ص/س, ط/ت, ق/ك, ع/ء. Text-to-speech cannot judge the learner's own pronunciation, so these are listen-and-choose.
- Letter mnemonics (look-alike dots, sound hints).
- Tasks: (a) data file and validation, (b) lesson and practice screen, (c) sound-discrimination questions in the quiz and Match.

### P2. Vocabulary grown around frequency and roots (Stage 2)
- Grow from 100 to about 200 words, then toward about 300. Start with particles, pronouns and prepositions (من، في، على، إلى، ما، لا).
- Replace the guessed order with a measured frequency list. Candidate: Leipzig Corpora (CC BY 4.0). For Quran-focused words, an open corpus such as the Quranic Arabic Corpus, licence to be confirmed. Credit whatever is used. Parked until a list can be fetched.
- Add a root (jidhr) field to every word, and a way to see words sharing a root.
- Add a sentence per word, and cloze (fill-in-the-blank) cards alongside recognition and typing cards.
- Fade transliteration out as a word becomes familiar (a setting, never forced).
- Word ids are part of card ids: only append, never rename (CLAUDE.md 3.1).

### P3. Graded reading that measures itself (Stage 3)
- Tag each word in a text with its vocab id, so the app can compute how many words in a text the learner already knows, and suggest texts that are mostly known (aim about 95%).
- This replaces the fragile string-matching word-reuse check noted in CLAUDE.md.
- Tap-for-meaning per word (needs a gloss for every word). Optional hide-vowel-marks setting. More than one question per text. More texts and dialogues.

### P4. Grammar by noticing (Stage 2 to 4)
Short lessons, each ending in a quiz, introduced with sentences the learner has already read:
1. definite article and sun/moon letters
2. noun gender and plurals
3. the nominal sentence
4. iḍāfa (possessive construct)
5. prepositions
6. past and present verbs
7. verb forms I to X
8. case endings, last and only as far as the Quran needs

### P5. Handwriting (supports letter memory)
- Tracing canvas for letters first, then short words. Already agreed in the roadmap.

### P6. Quran reading (Stage 4)
- First a lesson on the Uthmani script (marks such as the dagger alif) and tajwīd basics.
- Then short passages (for example al-Fātiḥa and short surahs) as one more reading source with tap-for-meaning.
- **Quranic text must come from a verified source. Never type or recall it from memory** (CLAUDE.md section 2). Source, edition and licence need to be chosen and checked before any passage is added.

## 4. Cross-cutting improvements

- **One "Up next" across tabs.** A single suggestion on Home that follows the stages above. Suggestion only: it must never hide or lock anything, and a far-ahead jump gets only the existing gentle, dismissible heads-up.
- **Spaced-repetition tuning.** Mix new and review items inside a round. Cap new items per round as a soft default. Cards missed repeatedly get a different exercise or a hint, never a penalty. Practice must never show an empty state.
- **Production, not only recognition.** Alternate recognition and recall (typing, cloze, later writing).
- **Listening.** More listen-first questions, since text-to-speech cannot score speaking.

## 5. Quality gates (before adding more content)

1. A fluent Arabic speaker reviews the existing letters, words, phrases, dialogues and texts. Mark anything new as unreviewed until then.
2. Check on a real phone: Arabic fonts and joined letters in the Android WebView, text-to-speech voices, Match and the three-button Home rows one-handed, typing questions with the real keyboard.
3. Keep the test suite green and do the real-Chrome layout check for any screen change (CLAUDE.md section 4).

## 6. Suggested order

1. P1 (vowel marks and reading rules), the biggest gap in the beginner path.
2. P2 (frequency vocab with roots), unblocked once a list can be fetched.
3. P3 (self-measuring graded reading).
4. P4 (grammar), interleaved with P2 and P3.
5. P5 (handwriting).
6. P6 (Quran reading), last, after the quality gates are met.

## 7. Open questions for the owner

- Which Quran source and edition should be used when the time comes?
- Is there a fluent speaker who can review the Arabic, and when?
- Should transliteration fading be automatic per word, or a single setting?
