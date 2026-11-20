// App shell: tiny hash router plus screen registry.
// Feature modules (alphabet, flashcards, quran) register screens here.
// Screens receive { parts, setTitle }: the hash path split on "/", and a title setter.

import { createLettersScreen } from "./letters-screen.js";

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
  return h("div", {},
    h("div", { class: "card" },
      h("h2", {}, "Welcome"),
      h("p", {}, "Learn Modern Standard Arabic, with a path to reading the Quran."),
      h("p", { class: "ar", lang: "ar" }, "مَرْحَبًا")),
    h("div", { class: "card" },
      h("h2", {}, "Ready to practice"),
      h("p", {}, "Go at your own pace. Practice as much or as little as you like."),
      h("div", { class: "row spaced" },
        h("a", { class: "btn", href: "#/alphabet/practice" }, "Practice letters"),
        h("a", { class: "btn secondary", href: "#/alphabet" }, "Browse the letters"))));
}

const lettersScreen = createLettersScreen({ h });

// route name -> { title, render }
export const screens = {
  home: { title: "Big Brainer", render: homeScreen },
  alphabet: { title: "Letters", render: lettersScreen },
  cards: { title: "Flashcards", render: comingSoon("Flashcards") },
  quran: { title: "Quran reading", render: comingSoon("Quran reading") },
};

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
navigate();
