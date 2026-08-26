// Экран входа. Отдельная страница, а не часть оболочки: до появления профиля
// приложения ещё нет и рисовать нечего.
//
// Выглядит он как первый экран витрины, с которого на него пришли: та же
// пилюля навигации сверху, тот же кадр киновечера во весь экран и та же
// строка-подпись внизу. Разница одна — вместо заголовка и кнопок посередине
// стоит форма.

import { APP_VERSION } from "../config.js";
import { icon } from "./icons.js";

export const AUTH_MODES = {
  signin: {
    title: "С возвращением",
    lead: "Войдите, чтобы открыть свою библиотеку.",
    submit: "Войти",
    fields: ["email", "password"],
  },
  signup: {
    title: "Создать аккаунт",
    lead: "Регистрация по приглашению — попросите код у того, кто уже здесь.",
    submit: "Создать аккаунт",
    fields: ["displayName", "handle", "email", "password", "passwordRepeat", "inviteCode"],
  },
  reset: {
    title: "Восстановление пароля",
    lead: "Пришлём ссылку для смены пароля на вашу почту.",
    submit: "Прислать ссылку",
    fields: ["email"],
  },
  recovery: {
    title: "Новый пароль",
    lead: "Придумайте пароль, с которым будете входить дальше.",
    submit: "Сохранить пароль",
    fields: ["password", "passwordRepeat"],
  },
  profile: {
    title: "Ещё один шаг",
    lead: "Код приглашения превращает аккаунт в библиотеку.",
    submit: "Открыть библиотеку",
    fields: ["inviteCode", "handle", "displayName"],
  },
};

export const AUTH_FIELDS = {
  email: { label: "Почта", type: "email", autocomplete: "email" },
  password: { label: "Пароль", type: "password", autocomplete: "current-password" },
  passwordRepeat: {
    label: "Пароль ещё раз",
    type: "password",
    autocomplete: "new-password",
  },
  handle: {
    label: "Имя пользователя",
    type: "text",
    autocomplete: "username",
    hint: "По нему вас найдут друзья: латиница, цифры и подчёркивание.",
    placeholder: "ilya_k",
  },
  displayName: {
    label: "Как вас показывать",
    type: "text",
    autocomplete: "name",
    placeholder: "Илья",
  },
  inviteCode: {
    label: "Код приглашения",
    type: "text",
    autocomplete: "one-time-code",
    placeholder: "CINEVLT1",
  },
};

export function renderAuthScreen(root, state) {
  const mode = AUTH_MODES[state.mode] ? state.mode : "signin";
  const config = AUTH_MODES[mode];
  const values = state.values ?? {};
  const errors = state.errors ?? {};

  root.innerHTML = `
    <main class="auth" data-mode="${mode}">
      <header class="pillbar">
        <nav class="pillbar__pill">
          <span class="pillbar__brand">
            <span class="pillbar__mark">${icon("film")}</span>
            CineVault
          </span>
          <span class="pillbar__spacer"></span>
          ${state.cancellable
            ? `<button class="btn btn--ghost" type="button" data-auth-mode="cancel">
                Вернуться на витрину
              </button>`
            : ""}
        </nav>
      </header>

      <section class="auth__hero">
        <div class="wl-hero__bg" aria-hidden="true">
          <img src="./assets/welcome/hero-night.jpg" width="1920" height="1081"
            alt="" fetchpriority="high" decoding="async">
        </div>
        <div class="auth__stage">
          <section class="auth__card">
            <div class="auth__brand">
              <div class="auth__mark">CV</div>
              <div>
                <h1>${config.title}</h1>
                <p>${config.lead}</p>
              </div>
            </div>
            ${state.serverConfigured ? "" : renderSetupWarning()}
            ${state.notice ? `<p class="auth__notice" role="status">${escapeHtml(state.notice)}</p>` : ""}
            ${errors.general ? `<p class="auth__error" role="alert">${escapeHtml(errors.general)}</p>` : ""}
            <form class="auth__form" novalidate>
              ${config.fields.map((name) => renderAuthField(name, values[name], errors[name])).join("")}
              <button
                class="btn btn--primary btn--lg auth__submit"
                type="submit"
                ${state.busy || state.canSubmit === false ? "disabled" : ""}
              >${state.busy ? "Подождите…" : config.submit}</button>
            </form>
            <div class="auth__links">${renderLinks(mode, state.cancellable)}</div>
          </section>
          <p class="wl-meta auth__meta">
            <span><i class="wl-dot"></i>Аккаунт по коду приглашения</span>
            <span><i class="wl-dot"></i>Версия ${APP_VERSION}</span>
            <span><i class="wl-dot"></i>Интерфейс полностью на русском</span>
          </p>
        </div>
      </section>
    </main>
  `;

  const form = root.querySelector(".auth__form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const collected = Object.fromEntries(
      config.fields.map((name) => [name, String(data.get(name) ?? "")]),
    );
    state.onSubmit(mode, collected);
  });

  for (const link of root.querySelectorAll("[data-auth-mode]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      state.onModeChange(link.dataset.authMode);
    });
  }

  const firstInvalid = config.fields.find((name) => errors[name]);
  const focusName = firstInvalid ?? config.fields[0];
  root.querySelector(`[name="${focusName}"]`)?.focus();
}

export function renderAuthField(name, value = "", error = "") {
  const field = AUTH_FIELDS[name];
  return `
    <label class="field${error ? " field--invalid" : ""}">
      <span>${field.label}</span>
      <input
        name="${name}"
        type="${field.type}"
        autocomplete="${field.autocomplete}"
        ${field.placeholder ? `placeholder="${field.placeholder}"` : ""}
        value="${escapeHtml(value)}"
        ${error ? 'aria-invalid="true"' : ""}
      >
      ${error ? `<em class="field__error">${escapeHtml(error)}</em>` : ""}
      ${!error && field.hint ? `<em class="field__hint">${field.hint}</em>` : ""}
    </label>
  `;
}

function renderLinks(mode, cancellable = false) {
  const links = {
    signin: [
      ["signup", "Создать аккаунт"],
      ["reset", "Забыли пароль?"],
    ],
    signup: [["signin", "У меня уже есть аккаунт"]],
    reset: [["signin", "Вернуться ко входу"]],
    recovery: [],
    profile: [["signout", "Выйти из аккаунта"]],
  };

  // С витрины на форму приходят по своей воле, поэтому нужен и путь обратно.
  // На обязательных шагах (новый пароль, приглашение) уходить некуда.
  const items = [...(links[mode] ?? [])];
  if (cancellable && mode !== "recovery" && mode !== "profile") {
    items.push(["cancel", "Вернуться на витрину"]);
  }

  return items
    .map(
      ([target, label]) =>
        `<a href="#" data-auth-mode="${target}">${label}</a>`,
    )
    .join("");
}

function renderSetupWarning() {
  return `
    <p class="auth__error" role="alert">
      Сервер не настроен: в <code>src/config.js</code> пустые
      <code>SUPABASE_URL</code> и <code>SUPABASE_ANON_KEY</code>.
      Форма показана, но вход невозможен — см. docs/STAGE_14.md.
    </p>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
