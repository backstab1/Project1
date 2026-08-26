// Личный кабинет — закреплённая кнопка справа в шапке.
//
// На витрине его нет: гостя туда ведут кнопки «Создать аккаунт», а форма
// открывается следующей страницей. Внутри библиотеки кнопка показывает, кто
// вошёл, и раскрывает меню: разделы, тема профиля и выход. Если сессия
// оборвалась, в том же меню появляется форма входа — она собрана из тех же
// описаний полей, что и полноэкранный экран (authScreen.js), поэтому подписи
// и порядок полей нигде не расходятся.

import { APP_VERSION } from "../config.js";
import { AUTH_MODES, renderAuthField } from "./authScreen.js";
import { icon } from "./icons.js";

// Заголовки меню короче, чем на полноэкранном экране: панель узкая,
// а человек уже видит, куда нажал.
const MENU_TITLES = Object.freeze({
  signin: ["Вход", "Почта и пароль — и библиотека на месте."],
  signup: ["Регистрация", "Нужен код приглашения от того, кто уже здесь."],
  reset: ["Пароль", "Пришлём ссылку для смены пароля на почту."],
  profile: ["Приглашение", "Код превращает аккаунт в библиотеку."],
  recovery: ["Новый пароль", "Придумайте пароль, с которым будете входить."],
});

const TABS = [
  ["signin", "Вход"],
  ["signup", "Регистрация"],
];

export function renderAccountMenu(state) {
  const panel = state.accountPanel ?? {};
  const open = Boolean(panel.open);
  const account = state.account;

  return `
    <div class="account-menu" data-open="${open}">
      ${renderTrigger(account, open)}
      ${open ? (account ? renderProfilePanel(state, panel) : renderFormPanel(panel)) : ""}
    </div>
  `;
}

function renderTrigger(account, open) {
  const name = account
    ? escapeHtml(account.display_name ?? account.handle ?? "Аккаунт")
    : "Войти";
  const hint = account ? `@${escapeHtml(account.handle ?? "")}` : "Нет аккаунта";

  return `
    <button class="account-menu__trigger" type="button" data-action="account-toggle"
      aria-expanded="${open}" aria-haspopup="dialog"
      aria-label="${account ? "Личный кабинет" : "Вход в аккаунт"}">
      <span class="account-menu__avatar">${
        account ? escapeHtml(initials(account.display_name ?? account.handle)) : icon("user")
      }</span>
      <span class="account-menu__text">
        <strong>${name}</strong>
        <small>${hint}</small>
      </span>
      ${icon("chevronDown", "account-menu__caret")}
    </button>
  `;
}

function renderProfilePanel(state, panel) {
  const account = state.account;
  const name = escapeHtml(account.display_name ?? account.handle ?? "Аккаунт");

  return `
    <section class="account-menu__panel" role="dialog" aria-label="Личный кабинет">
      <header class="account-menu__head">
        <span class="account-menu__avatar account-menu__avatar--lg">${
          escapeHtml(initials(account.display_name ?? account.handle))
        }</span>
        <div class="account-menu__who">
          <strong>${name}</strong>
          <small>@${escapeHtml(account.handle ?? "")}</small>
        </div>
      </header>

      ${panel.notice ? `<p class="account-menu__notice" role="status">${escapeHtml(panel.notice)}</p>` : ""}
      ${panel.errors?.general ? `<p class="account-menu__error" role="alert">${escapeHtml(panel.errors.general)}</p>` : ""}

      <div class="account-menu__links">
        <button type="button" data-view="friends">${icon("users")}<span>Друзья</span></button>
        <button type="button" data-view="settings">${icon("settings")}<span>Настройки</span></button>
        <button type="button" data-view="welcome">${icon("film")}<span>Витрина CineVault</span></button>
      </div>

      <div class="account-menu__foot">
        <button class="account-menu__signout" type="button"
          data-action="account-signout" ${panel.busy ? "disabled" : ""}>
          ${icon("logout")}<span>${panel.busy ? "Выходим…" : "Выйти"}</span>
        </button>
        <small>CineVault ${escapeHtml(APP_VERSION)}</small>
      </div>
    </section>
  `;
}

function renderFormPanel(panel) {
  const mode = AUTH_MODES[panel.mode] ? panel.mode : "signin";
  const config = AUTH_MODES[mode];
  const [title, lead] = MENU_TITLES[mode] ?? MENU_TITLES.signin;
  const values = panel.values ?? {};
  const errors = panel.errors ?? {};
  const showTabs = mode === "signin" || mode === "signup";

  return `
    <section class="account-menu__panel" role="dialog" aria-label="Вход в аккаунт">
      <header class="account-menu__head">
        <span class="account-menu__avatar account-menu__avatar--lg">${icon("user")}</span>
        <div class="account-menu__who">
          <strong>${title}</strong>
          <small>${lead}</small>
        </div>
      </header>

      ${showTabs ? `
        <div class="account-menu__tabs" role="tablist">
          ${TABS.map(([id, label]) => `
            <button class="${mode === id ? "is-active" : ""}" type="button"
              role="tab" aria-selected="${mode === id}"
              data-action="account-mode" data-mode="${id}">${label}</button>
          `).join("")}
        </div>` : ""}

      ${panel.notice ? `<p class="account-menu__notice" role="status">${escapeHtml(panel.notice)}</p>` : ""}
      ${errors.general ? `<p class="account-menu__error" role="alert">${escapeHtml(errors.general)}</p>` : ""}

      <form class="account-menu__form" novalidate data-account-form>
        ${config.fields.map((name) => renderAuthField(name, values[name], errors[name])).join("")}
        <button class="btn btn--primary account-menu__submit" type="submit"
          ${panel.busy ? "disabled" : ""}>${panel.busy ? "Подождите…" : config.submit}</button>
      </form>

      <div class="account-menu__hints">${renderLinks(mode)}</div>
    </section>
  `;
}

function renderLinks(mode) {
  const links = {
    signin: [["reset", "Забыли пароль?"]],
    signup: [["signin", "У меня уже есть аккаунт"]],
    reset: [["signin", "Вернуться ко входу"]],
    profile: [],
    recovery: [],
  };

  const items = (links[mode] ?? [])
    .map(([target, label]) =>
      `<button type="button" data-action="account-mode" data-mode="${target}">${label}</button>`)
    .join("");

  const hint = mode === "signup"
    ? "<small>Код приглашения — восемь латинских букв и цифр.</small>"
    : "";

  return items + hint;
}

// Клик мимо меню закрывает его так же, как повторное нажатие на кнопку.
// Ссылка на слушатель хранится здесь: перерисовка при открытом меню не
// должна оставлять после себя ещё один такой же.
let outsideClickListener = null;

// Форма отправляется целиком: значения полей не поднимаются в состояние на
// каждое нажатие, иначе перерисовка забирала бы фокус из поля.
export function bindAccountMenu(root, state) {
  const panel = state.accountPanel ?? {};

  if (outsideClickListener) {
    document.removeEventListener("pointerdown", outsideClickListener, true);
    outsideClickListener = null;
  }
  if (!panel.open) return;

  const menu = root.querySelector(".account-menu");
  if (menu) {
    outsideClickListener = (event) => {
      if (menu.contains(event.target)) return;
      document.removeEventListener("pointerdown", outsideClickListener, true);
      outsideClickListener = null;
      state.onAction("account-close", {});
    };
    document.addEventListener("pointerdown", outsideClickListener, true);
  }

  const form = root.querySelector("[data-account-form]");
  if (!form) return;

  const mode = AUTH_MODES[panel.mode] ? panel.mode : "signin";
  const fields = AUTH_MODES[mode].fields;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const values = Object.fromEntries(
      fields.map((name) => [name, String(data.get(name) ?? "")]),
    );
    state.onAction("account-submit", { mode, values });
  });

  if (!panel.autofocus) return;
  const invalid = fields.find((name) => panel.errors?.[name]);
  const target = form.querySelector(`[name="${invalid ?? fields[0]}"]`);
  target?.focus({ preventScroll: true });
}

export function initials(value) {
  const text = String(value ?? "").trim();
  if (!text) return "CV";
  const words = text.split(/\s+/).slice(0, 2);
  return words.map((word) => word[0]).join("").toLocaleUpperCase("ru-RU");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
