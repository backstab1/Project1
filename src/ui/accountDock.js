// Личный кабинет — плавающая карточка в правом нижнем углу библиотеки.
//
// На витрине его нет: гостя туда ведут кнопки «Создать аккаунт», а форма
// открывается следующей страницей. Внутри библиотеки кабинет показывает
// профиль и выход, а если сессия оборвалась — вход прямо на месте. Формы
// собраны из тех же описаний полей, что и полноэкранный экран входа
// (authScreen.js), поэтому подписи и порядок полей нигде не расходятся.

import { APP_VERSION } from "../config.js";
import { AUTH_MODES, renderAuthField } from "./authScreen.js";
import { icon } from "./icons.js";

// Заголовки кабинета короче, чем на полноэкранном экране: карточка узкая,
// а человек уже видит, куда нажал.
const DOCK_TITLES = Object.freeze({
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

export function renderAccountDock(state) {
  const panel = state.accountPanel ?? {};
  const open = Boolean(panel.open);
  const account = state.account;

  return `
    <div class="account-dock" data-open="${open}">
      ${open ? (account ? renderProfilePanel(state, panel) : renderFormPanel(panel)) : ""}
      ${renderToggle(state, open)}
    </div>
  `;
}

function renderToggle(state, open) {
  const account = state.account;
  const label = account
    ? escapeHtml(account.display_name ?? account.handle ?? "Аккаунт")
    : "Личный кабинет";
  const hint = account
    ? `@${escapeHtml(account.handle ?? "")}`
    : "Вход и регистрация";

  return `
    <button class="account-dock__toggle" type="button" data-action="account-toggle"
      aria-expanded="${open}" aria-label="${account ? "Профиль" : "Личный кабинет"}">
      <span class="account-dock__avatar">${
        account ? escapeHtml(initials(account.display_name ?? account.handle)) : icon("user")
      }</span>
      <span class="account-dock__toggle-text">
        <strong>${label}</strong>
        <small>${hint}</small>
      </span>
      <span class="account-dock__chevron">${icon(open ? "close" : "chevronDown")}</span>
    </button>
  `;
}

function renderProfilePanel(state, panel) {
  const account = state.account;
  const name = escapeHtml(account.display_name ?? account.handle ?? "Аккаунт");

  return `
    <section class="account-dock__panel" role="dialog" aria-label="Личный кабинет">
      <header class="account-dock__head">
        <span class="account-dock__avatar account-dock__avatar--lg">${
          escapeHtml(initials(account.display_name ?? account.handle))
        }</span>
        <div class="account-dock__who">
          <strong>${name}</strong>
          <small>@${escapeHtml(account.handle ?? "")}</small>
        </div>
        <button class="icon-btn account-dock__close" type="button"
          data-action="account-close" aria-label="Свернуть кабинет">${icon("close")}</button>
      </header>

      ${panel.notice ? `<p class="account-dock__notice" role="status">${escapeHtml(panel.notice)}</p>` : ""}
      ${panel.errors?.general ? `<p class="account-dock__error" role="alert">${escapeHtml(panel.errors.general)}</p>` : ""}

      <div class="account-dock__actions">
        <button class="btn btn--primary" type="button" data-view="dashboard">
          ${icon("home")}<span>Открыть хранилище</span>
        </button>
        <button class="btn btn--ghost" type="button" data-view="settings">
          ${icon("settings")}<span>Настройки</span>
        </button>
        <button class="btn btn--ghost account-dock__signout" type="button"
          data-action="account-signout" ${panel.busy ? "disabled" : ""}>
          ${icon("logout")}<span>${panel.busy ? "Выходим…" : "Выйти"}</span>
        </button>
      </div>

      <p class="account-dock__foot">CineVault ${escapeHtml(APP_VERSION)}</p>
    </section>
  `;
}

function renderFormPanel(panel) {
  const mode = AUTH_MODES[panel.mode] ? panel.mode : "signin";
  const config = AUTH_MODES[mode];
  const [title, lead] = DOCK_TITLES[mode] ?? DOCK_TITLES.signin;
  const values = panel.values ?? {};
  const errors = panel.errors ?? {};
  const showTabs = mode === "signin" || mode === "signup";

  return `
    <section class="account-dock__panel" role="dialog" aria-label="Личный кабинет">
      <header class="account-dock__head">
        <span class="account-dock__avatar account-dock__avatar--lg">${icon("user")}</span>
        <div class="account-dock__who">
          <strong>${title}</strong>
          <small>${lead}</small>
        </div>
        <button class="icon-btn account-dock__close" type="button"
          data-action="account-close" aria-label="Свернуть кабинет">${icon("close")}</button>
      </header>

      ${showTabs ? `
        <div class="account-dock__tabs" role="tablist">
          ${TABS.map(([id, label]) => `
            <button class="${mode === id ? "is-active" : ""}" type="button"
              role="tab" aria-selected="${mode === id}"
              data-action="account-mode" data-mode="${id}">${label}</button>
          `).join("")}
        </div>` : ""}

      ${panel.notice ? `<p class="account-dock__notice" role="status">${escapeHtml(panel.notice)}</p>` : ""}
      ${errors.general ? `<p class="account-dock__error" role="alert">${escapeHtml(errors.general)}</p>` : ""}

      <form class="account-dock__form" novalidate data-account-form>
        ${config.fields.map((name) => renderAuthField(name, values[name], errors[name])).join("")}
        <button class="btn btn--primary account-dock__submit" type="submit"
          ${panel.busy ? "disabled" : ""}>${panel.busy ? "Подождите…" : config.submit}</button>
      </form>

      <div class="account-dock__links">${renderLinks(mode)}</div>
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

// Форма отправляется целиком: значения полей не поднимаются в состояние на
// каждое нажатие, иначе перерисовка забирала бы фокус из поля.
export function bindAccountDock(root, state) {
  const panel = state.accountPanel ?? {};
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
