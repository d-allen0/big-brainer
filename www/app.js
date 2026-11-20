// App shell: tiny hash router plus screen registry.
// Feature modules (alphabet, flashcards, quran) register screens here later.

import { getDueCards } from "./db.js";

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

async function homeScreen() {
  const wrap = h("div");
  const dueCard = h("div", { class: "card" },
    h("h2", {}, "Due for review"),
    h("p", {}, "Loading…"));
  wrap.append(
    h("div", { class: "card" },
      h("h2", {}, "Welcome"),
      h("p", {}, "Learn Modern Standard Arabic, with a path to reading the Quran."),
      h("p", { class: "ar", lang: "ar" }, "مَرْحَبًا")),
    dueCard);

  try {
    const due = await getDueCards(Date.now());
    dueCard.replaceChildren(
      h("h2", {}, "Due for review"),
      h("div", { class: "stat" }, String(due.length)),
      h("p", {}, due.length === 0 ? "Nothing due. Start with the letters." : "cards waiting"));
  } catch (err) {
    dueCard.replaceChildren(
      h("h2", {}, "Due for review"),
      h("p", { class: "error" }, "Could not open local storage: " + err.message));
  }
  return wrap;
}

// route name -> { title, render }
export const screens = {
  home: { title: "Arabic Learner", render: homeScreen },
  alphabet: { title: "Letters", render: comingSoon("Alphabet") },
  cards: { title: "Flashcards", render: comingSoon("Flashcards") },
  quran: { title: "Quran reading", render: comingSoon("Quran reading") },
};

let renderToken = 0;

async function navigate() {
  const name = (location.hash.replace(/^#\/?/, "") || "home").split("/")[0];
  const screen = screens[name] ?? screens.home;
  const active = screens[name] ? name : "home";
  const token = ++renderToken;

  title.textContent = screen.title;
  tabs.forEach((a) => {
    if (a.dataset.route === active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  try {
    const node = await screen.render();
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
