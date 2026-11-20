// App shell: tiny hash router plus screen registry.
// Feature modules (alphabet, flashcards, quiz, read) register screens here.
// Screens receive { parts, setTitle }: the hash path split on "/", and a title setter.

import { createLettersScreen } from "./letters-screen.js";
import { createVocabScreen } from "./vocab-screen.js";
import { createQuizScreen } from "./quiz-screen.js";
import { createOptionsScreen, PREFS_KEY } from "./options-screen.js";
import * as tts from "./tts.js";
import * as db from "./db.js";

const view = document.getElementById("view");
const title = document.getElementById("screen-title");
const tabs = document.querySelectorAll(".tabbar a");

/** Build a DOM element without innerHTML (keeps content safe from injection). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") el.className = value;
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

function comingSoon(name) {
  return () =>
    h("div", { class: "card" },
      h("h2", {}, name),
      h("p", {}, "Coming soon."));
}

// Home never shows counts, due dates or deadlines: practice is always available.
function homeScreen() {
  const pair = (practiceHref, browseHref) =>
    h("div", { class: "btn-pair" },
      h("a", { class: "btn", href: practiceHref }, "Practice"),
      h("a", { class: "btn secondary", href: browseHref }, "Browse"));
  return h("div", {},
    h("div", { class: "card" },
      h("h2", {}, "Welcome"),
      h("p", {}, "Learn to read and understand Modern Standard Arabic."),
      h("p", { class: "ar", lang: "ar" }, "مَرْحَبًا"),
      h("div", { class: "row spaced" },
        h("a", { class: "btn secondary", href: "#/options" }, "Voice options"))),
    h("div", { class: "card" },
      h("h2", {}, "Ready to practice"),
      h("p", {}, "Go at your own pace. Practice as much or as little as you like."),
      h("h3", { class: "home-topic" }, "Letters"),
      pair("#/alphabet/practice", "#/alphabet"),
      h("h3", { class: "home-topic" }, "Words"),
      pair("#/cards/practice", "#/cards"),
      h("h3", { class: "home-topic" }, "Phrases"),
      pair("#/cards/phrases/practice", "#/cards/phrases"),
      h("a", { class: "btn wide", href: "#/quiz" }, "Take a quiz")));
}

const lettersScreen = createLettersScreen({ h });
const vocabScreen = createVocabScreen({ h });
const quizScreen = createQuizScreen({ h });
const optionsScreen = createOptionsScreen({ h });

// route name -> { title, render }
export const screens = {
  home: { title: "Big Brainer", render: homeScreen },
  alphabet: { title: "Letters", render: lettersScreen },
  cards: { title: "Flashcards", render: vocabScreen },
  quiz: { title: "Quiz", render: quizScreen },
  options: { title: "Voice options", render: optionsScreen },
  read: { title: "Read", render: comingSoon("Reading") },
};

/**
 * Apply the learner's saved voice and speed, so every pronunciation button uses them.
 * Anything unreadable or unusable just means the defaults. Never throws.
 */
export async function applySavedVoice({ store = db, speech = tts } = {}) {
  try {
    speech.setPreferences(await store.getMeta(PREFS_KEY, null));
  } catch {
    speech.setPreferences(null);
  }
}

let renderToken = 0;

async function navigate() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const name = parts[0] || "home";
  const screen = screens[name] ?? screens.home;
  const active = screens[name] ? name : "home";
  const token = ++renderToken;

  title.textContent = screen.title;
  const setTitle = (text) => {
    if (token === renderToken) title.textContent = text;
  };
  tabs.forEach((a) => {
    if (a.dataset.route === active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  try {
    const node = await screen.render({ parts: name === active ? parts : ["home"], setTitle });
    if (token !== renderToken) return; // a newer navigation superseded this one
    view.replaceChildren(node);
    window.scrollTo(0, 0);
  } catch (err) {
    if (token !== renderToken) return;
    view.replaceChildren(h("p", { class: "error" }, "Something went wrong: " + err.message));
  }
}

window.addEventListener("hashchange", navigate);
applySavedVoice(); // does not hold up the first screen; speech only happens when a button is pressed
navigate();
