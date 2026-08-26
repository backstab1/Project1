import { icon } from "./icons.js";
import { lockScroll, unlockScroll } from "./scrollLock.js";

/**
 * Палитра команд (Ctrl+K): единая точка входа для навигации, действий
 * и быстрого поиска по библиотеке.
 */

const MAX_VISIBLE = 40;

let overlay = null;
let inputNode = null;
let listNode = null;
let emptyNode = null;
let commands = [];
let matches = [];
let activeIndex = 0;
let lastFocused = null;

export function isPaletteOpen() {
  return Boolean(overlay && !overlay.hidden);
}

export function openPalette(nextCommands) {
  commands = Array.isArray(nextCommands) ? nextCommands : [];
  ensureNode();
  lastFocused = document.activeElement;
  overlay.hidden = false;
  lockScroll("palette");
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  inputNode.value = "";
  updateMatches("");
  requestAnimationFrame(() => inputNode.focus());
}

export function closePalette() {
  if (!overlay || overlay.hidden) return;
  overlay.classList.remove("is-open");
  unlockScroll("palette");
  setTimeout(() => {
    if (overlay && !overlay.classList.contains("is-open")) overlay.hidden = true;
  }, 180);
  if (lastFocused instanceof HTMLElement && lastFocused.isConnected) {
    lastFocused.focus();
  }
}

function ensureNode() {
  if (overlay) return;

  overlay = document.createElement("div");
  overlay.className = "palette";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Палитра команд");
  overlay.innerHTML = `
    <div class="palette__scrim" data-palette-close></div>
    <div class="palette__panel" role="combobox" aria-expanded="true"
      aria-haspopup="listbox" aria-owns="palette-list">
      <div class="palette__search">
        ${icon("search", "palette__search-icon")}
        <input type="text" class="palette__input" autocomplete="off"
          spellcheck="false" placeholder="Найдите фильм или команду…"
          aria-label="Поиск команд и фильмов" aria-controls="palette-list">
        <kbd class="palette__esc">ESC</kbd>
      </div>
      <div class="palette__results" id="palette-list" role="listbox"></div>
      <p class="palette__empty" hidden>Ничего не найдено</p>
      <footer class="palette__footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> выбор</span>
        <span><kbd>Enter</kbd> открыть</span>
        <span><kbd>Esc</kbd> закрыть</span>
      </footer>
    </div>
  `;
  document.body.append(overlay);

  inputNode = overlay.querySelector(".palette__input");
  listNode = overlay.querySelector(".palette__results");
  emptyNode = overlay.querySelector(".palette__empty");

  overlay.querySelector("[data-palette-close]")
    .addEventListener("click", closePalette);
  inputNode.addEventListener("input", () => updateMatches(inputNode.value));
  overlay.addEventListener("keydown", handleKeydown);
  listNode.addEventListener("click", (event) => {
    const button = event.target.closest("[data-command-index]");
    if (button) runCommand(Number(button.dataset.commandIndex));
  });
  listNode.addEventListener("mousemove", (event) => {
    const button = event.target.closest("[data-command-index]");
    if (!button) return;
    const index = Number(button.dataset.commandIndex);
    if (index !== activeIndex) {
      activeIndex = index;
      highlight(false);
    }
  });
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closePalette();
    return;
  }
  if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
    event.preventDefault();
    move(1);
    return;
  }
  if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
    event.preventDefault();
    move(-1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    runCommand(activeIndex);
  }
}

function move(step) {
  if (matches.length === 0) return;
  activeIndex = (activeIndex + step + matches.length) % matches.length;
  highlight(true);
}

function runCommand(index) {
  const command = matches[index];
  if (!command) return;
  closePalette();
  setTimeout(() => command.run?.(), 40);
}

function updateMatches(rawQuery) {
  const query = String(rawQuery ?? "").trim().toLocaleLowerCase("ru-RU");
  matches = (query
    ? commands
      .map((command) => ({ command, score: scoreCommand(command, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.command)
    : commands.filter((command) => !command.hiddenByDefault)
  ).slice(0, MAX_VISIBLE);

  activeIndex = 0;
  renderMatches();
}

function scoreCommand(command, query) {
  const haystack = [command.label, command.hint, command.keywords, command.group]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ru-RU");
  if (!haystack.includes(query)) return 0;
  const label = String(command.label ?? "").toLocaleLowerCase("ru-RU");
  if (label.startsWith(query)) return 100;
  if (label.includes(query)) return 60;
  return 25;
}

function renderMatches() {
  if (matches.length === 0) {
    listNode.innerHTML = "";
    emptyNode.hidden = false;
    return;
  }
  emptyNode.hidden = true;

  let currentGroup = null;
  listNode.innerHTML = matches.map((command, index) => {
    const groupHeader = command.group && command.group !== currentGroup
      ? `<p class="palette__group">${escapeHtml(command.group)}</p>`
      : "";
    currentGroup = command.group ?? currentGroup;
    return `
      ${groupHeader}
      <button class="palette__item" type="button" role="option"
        data-command-index="${index}" aria-selected="${index === 0}">
        <span class="palette__item-icon">${icon(command.icon ?? "sparkles")}</span>
        <span class="palette__item-text">
          <strong>${escapeHtml(command.label)}</strong>
          ${command.hint ? `<small>${escapeHtml(command.hint)}</small>` : ""}
        </span>
        ${command.shortcut ? `<kbd>${escapeHtml(command.shortcut)}</kbd>` : ""}
      </button>
    `;
  }).join("");

  highlight(false);
}

function highlight(shouldScroll) {
  listNode.querySelectorAll("[data-command-index]").forEach((node) => {
    const isActive = Number(node.dataset.commandIndex) === activeIndex;
    node.classList.toggle("is-active", isActive);
    node.setAttribute("aria-selected", String(isActive));
    if (isActive && shouldScroll) {
      node.scrollIntoView({ block: "nearest" });
    }
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
