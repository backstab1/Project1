import { APP_VERSION } from "../config.js";
import {
  MOVIE_STATUS,
  MOVIE_STATUS_LABELS,
  calculateAverageRating,
  collectLibraryTags,
} from "../domain/entities.js";
import {
  buildCategoryQueue,
  getMovieFranchiseMap,
} from "../domain/libraryRules.js";
import { setupDialog } from "./dialog.js";
import { drawWheel } from "./wheelCanvas.js";
import { isBackupReminderDue } from "../domain/backupReminder.js";
import { selectEnrichmentCandidates } from "../domain/tmdbEnrichment.js";
import {
  CATALOG_SORTS,
  filterCatalogMovies,
  getMovieStatus,
} from "../domain/catalogQuery.js";
import { buildInsights } from "../domain/insights.js";
import { icon } from "./icons.js";
import { renderWelcome } from "./welcomeScreen.js";
import { bindAccountMenu, initials, renderAccountMenu } from "./accountMenu.js";
import { renderFriends } from "./friendsScreen.js";
import { buildViewers, countIncoming } from "../domain/friends.js";
import { setScrollLock } from "./scrollLock.js";
import {
  escapeAttribute,
  escapeHtml,
  settingsGroup,
  settingsRow,
  smallButton,
  toggleControl,
} from "./settingsKit.js";

// «Главная» намеренно отсутствует в боковом меню: на неё ведёт логотип CV.
// Пункт остаётся только в мобильной нижней навигации, где логотипа нет.
const DASHBOARD_ITEM = ["dashboard", "Главная", "home"];

const NAV_GROUPS = [
  ["Библиотека", [
    ["catalog", "Каталог", "film"],
    ["franchises", "Коллекции", "collection"],
    ["categories", "Списки", "layers"],
    ["watched", "Просмотренные", "eye"],
  ]],
  ["Кинорулетка", [
    ["wheel", "Колесо", "wheel"],
    ["sessions", "История роллов", "history"],
  ]],
  ["Аналитика", [
    ["insights", "Статистика", "target"],
  ]],
  ["Люди", [
    ["friends", "Друзья", "users"],
  ]],
];

// Настройки живут значком в шапке, а не пунктом меню: это не раздел
// библиотеки. В мобильном листе «Ещё» им место есть — там шапка узкая.
const SETTINGS_ITEM = ["settings", "Настройки", "settings"];

const NAV_ITEMS = [
  DASHBOARD_ITEM,
  ...NAV_GROUPS.flatMap(([, items]) => items),
  SETTINGS_ITEM,
];

const VIEW_META = Object.freeze({
  welcome: { title: "CineVault", eyebrow: "Личное кинохранилище" },
  dashboard: { title: "Моя библиотека", eyebrow: "Обзор коллекции" },
  catalog: { title: "Каталог", eyebrow: "Все фильмы" },
  franchises: { title: "Коллекции", eyebrow: "Франшизы и циклы" },
  categories: { title: "Списки", eyebrow: "Структура и очереди" },
  watched: { title: "Просмотренные", eyebrow: "История и оценки" },
  wheel: { title: "Колесо", eyebrow: "Батл-рояль" },
  sessions: { title: "История роллов", eyebrow: "Завершённые сессии" },
  insights: { title: "Статистика", eyebrow: "Библиотека в цифрах" },
  friends: { title: "Друзья", eyebrow: "Заявки и доступ к библиотеке" },
  settings: { title: "Настройки", eyebrow: "Данные и интеграции" },
});

const MOBILE_VIEWS = ["dashboard", "catalog", "wheel", "watched"];

// Шпаргалка по клавишам: открывается вопросительным знаком и повторяет ровно
// то, что обрабатывает handleGlobalKeydown в main.js.
const SHORTCUTS = [
  [["Ctrl", "K"], "Палитра команд: разделы, действия и поиск по библиотеке"],
  [["/"], "Каталог и курсор сразу в поле поиска"],
  [["N"], "Добавить фильм"],
  [["R"], "Случайный фильм из текущей выборки"],
  [["Пробел"], "Крутить колесо — в разделе «Колесо»"],
  [["Esc"], "Закрыть карточку, палитру, диалог или эту шпаргалку"],
  [["?"], "Эта шпаргалка"],
];

let previousView = null;
// Оверлеи переживают перерисовку: звезда и статус в карточке фильма меняют
// библиотеку, а разметка собирается заново. Если появление проигрывать
// каждый раз, окно моргает на каждое нажатие, поэтому анимация включается
// только когда оверлей действительно открылся.
let previousDetailId = null;
let previousModalView = null;

export function renderAppShell(root, state) {
  const collapsed = Boolean(state.sidebarCollapsed);
  const counts = getNavCounts(state);
  const viewChanged = previousView !== state.view;
  previousView = state.view;
  const detailOpening = previousDetailId !== state.detailMovieId;
  const modalOpening = previousModalView !== state.modalView;
  previousDetailId = state.detailMovieId;
  previousModalView = state.modalView;
  // Перерисовка заменяет разметку целиком, поэтому позицию прокрутки нужно
  // запомнить до неё: иначе любое действие — звезда, фильтр, открытие
  // карточки — отбрасывало бы человека в начало длинного каталога.
  const keptScroll = viewChanged ? 0 : readScrollTop(root);
  const keptMovieScroll = detailOpening
    ? 0
    : root.querySelector(".movie-modal__scroll")?.scrollTop ?? 0;
  const keptOverlayScroll = modalOpening
    ? 0
    : root.querySelector(".overlay__body")?.scrollTop ?? 0;

  // Витрина занимает окно целиком: ни боковой панели, ни топбара,
  // только плавающая пилюля навигации, как на самой витрине.
  if (state.view === "welcome") {
    renderWelcomeShell(root, state);
    return;
  }

  root.innerHTML = `
    <div class="app" data-collapsed="${collapsed}">
      <div class="app__aurora" aria-hidden="true">
        <span class="app__aurora-blob app__aurora-blob--one"></span>
        <span class="app__aurora-blob app__aurora-blob--two"></span>
        <span class="app__aurora-blob app__aurora-blob--three"></span>
      </div>

      <aside class="sidebar">
        <div class="sidebar__top">
          <button class="brand ${state.view === "dashboard" ? "is-active" : ""}"
            type="button" data-view="dashboard"
            ${state.view === "dashboard" ? 'aria-current="page"' : ""}
            aria-label="CineVault — на главную">
            <span class="brand__mark"><span class="brand__mark-glyph">CV</span></span>
            <span class="brand__text">
              <strong>CineVault</strong>
              <small>личная фильмотека</small>
            </span>
          </button>
          <button class="sidebar__collapse" type="button" data-action="sidebar-toggle"
            aria-label="${collapsed ? "Развернуть меню" : "Свернуть меню"}"
            title="${collapsed ? "Развернуть меню" : "Свернуть меню"}">
            ${icon("sidebar")}
          </button>
        </div>

        <nav class="nav" aria-label="Основная навигация">
          ${NAV_GROUPS.map(([groupLabel, items]) => `
            <div class="nav__group">
              <p class="nav__group-label">${escapeHtml(groupLabel)}</p>
              ${items.map(([id, label, iconName]) => `
                <button
                  class="nav__item ${state.view === id ? "is-active" : ""}"
                  type="button"
                  data-view="${id}"
                  title="${escapeAttribute(label)}"
                  ${state.view === id ? 'aria-current="page"' : ""}
                >
                  <span class="nav__icon">${icon(iconName)}</span>
                  <span class="nav__label">${escapeHtml(label)}</span>
                  ${counts[id] ? `<span class="nav__badge">${counts[id]}</span>` : ""}
                </button>
              `).join("")}
            </div>
          `).join("")}
        </nav>

      </aside>

      <div class="main">
        <div class="content-scroll">
        <header class="topbar">
          <div class="topbar__lead">
            <button class="icon-btn topbar__menu" type="button"
              data-action="sidebar-toggle" aria-label="Меню">${icon("more")}</button>
            <div class="topbar__titles">
              <h1>${escapeHtml(getViewMeta(state.view).title)}</h1>
              <span class="topbar__hint">${escapeHtml(getViewMeta(state.view).eyebrow)}</span>
            </div>
          </div>

          <div class="topbar__tools">
            <button class="search-trigger" type="button" data-action="palette-open">
              ${icon("search")}
              <span>Поиск и команды</span>
              <kbd>Ctrl</kbd><kbd>K</kbd>
            </button>
            <button class="icon-btn" type="button" data-action="theme-toggle"
              aria-label="${state.theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}"
              title="${state.theme === "dark" ? "Светлая тема" : "Тёмная тема"}">
              ${state.theme === "dark" ? icon("sun") : icon("moon")}
            </button>
            <button class="icon-btn ${state.modalView === "settings" ? "is-active" : ""}"
              type="button" data-view="settings"
              aria-label="Настройки" title="Настройки">${icon("settings")}</button>
            ${renderAccountMenu(state)}
          </div>
        </header>

          <section class="content ${viewChanged ? "is-entering" : ""}" id="view-content"></section>
        </div>

        <button class="to-top" type="button" data-scroll-top
          aria-label="Наверх" title="Наверх">${icon("arrowUpLine")}</button>
      </div>

      <nav class="tabbar" aria-label="Мобильная навигация">
        ${NAV_ITEMS.filter(([id]) => MOBILE_VIEWS.includes(id)).map(([id, label, iconName]) => `
          <button class="${state.view === id ? "is-active" : ""}" type="button"
            data-view="${id}" ${state.view === id ? 'aria-current="page"' : ""}>
            ${icon(iconName)}<span>${escapeHtml(label)}</span>
          </button>
        `).join("")}
        <details class="tabbar__more">
          <summary aria-label="Ещё разделы">${icon("more")}<span>Ещё</span></summary>
          <div class="tabbar__sheet">
            <p class="tabbar__sheet-title">Все разделы</p>
            ${NAV_ITEMS.filter(([id]) => !MOBILE_VIEWS.includes(id)).map(([id, label, iconName]) => `
              <button type="button" data-view="${id}">${icon(iconName)}<span>${escapeHtml(label)}</span></button>
            `).join("")}
            <button type="button" data-action="theme-toggle">
              ${state.theme === "dark" ? icon("sun") : icon("moon")}
              <span>${state.theme === "dark" ? "Светлая тема" : "Тёмная тема"}</span>
            </button>
          </div>
        </details>
      </nav>

      ${renderMovieDetail(state, detailOpening)}
      ${renderModalView(state, modalOpening)}
      ${renderShortcuts(state)}

      <dialog class="modal" id="entity-dialog">
        <form method="dialog" class="modal__surface">
          <header class="modal__header">
            <div>
              <p class="eyebrow">CineVault</p>
              <h2 id="dialog-title"></h2>
            </div>
            <button class="icon-btn" type="button" data-dialog-close
              aria-label="Закрыть">${icon("close")}</button>
          </header>
          <div class="modal__body" id="dialog-body"></div>
          <p class="form-error" data-dialog-error role="alert"></p>
          <footer class="modal__footer">
            <button class="btn btn--ghost" type="button" data-dialog-close>Отмена</button>
            <button class="btn btn--primary" type="submit" data-dialog-submit>Сохранить</button>
          </footer>
        </form>
      </dialog>

    </div>
  `;

  renderCurrentView(root.querySelector("#view-content"), state);
  renderModalContent(root, state);
  restoreOverlayScroll(root, ".movie-modal__scroll", keptMovieScroll);
  restoreOverlayScroll(root, ".overlay__body", keptOverlayScroll);
  restoreScrollTop(root, keptScroll);
  // Шторка фильма — такой же оверлей, как модалка и палитра: фон под ней
  // ездить не должен.
  setScrollLock("movie", Boolean(state.detailMovieId));
  setScrollLock("shortcuts", Boolean(state.shortcutsOpen));
  setScrollLock("modal-view", Boolean(state.modalView));
  bindEvents(root, state);
  bindAccountMenu(root, state);

  setupDialog();
  const wheelCanvas = root.querySelector("#wheel-canvas");
  if (wheelCanvas) {
    drawWheel(wheelCanvas, state.activeSession?.pool ?? state.rollDraftPool, 0, {
      theme: state.theme,
    });
  }
  if (state.focusControl) {
    const control = root.querySelector(`[data-control="${state.focusControl}"]`);
    control?.focus();
    if (control?.setSelectionRange) {
      const end = control.value.length;
      control.setSelectionRange(end, end);
    }
  }
  setupImageFallbacks(root);
}

const WELCOME_LINKS = [
  ["feats", "Возможности"],
  ["wheel", "Колесо"],
  ["account", "Аккаунт"],
  ["faq", "Вопросы"],
];

function renderWelcomeShell(root, state) {
  const keptScroll = readScrollTop(root);
  root.innerHTML = `
    <div class="app app--welcome">
      <div class="app__aurora" aria-hidden="true">
        <span class="app__aurora-blob app__aurora-blob--one"></span>
        <span class="app__aurora-blob app__aurora-blob--two"></span>
        <span class="app__aurora-blob app__aurora-blob--three"></span>
      </div>

      <div class="content-scroll content-scroll--welcome">
        <header class="pillbar">
          <nav class="pillbar__pill">
            <span class="pillbar__brand">
              <span class="pillbar__mark">${icon("film")}</span>
              CineVault
            </span>
            <ul class="pillbar__links">
              ${WELCOME_LINKS.map(([target, label]) => `
                <li><button type="button" data-welcome-scroll="${target}">${escapeHtml(label)}</button></li>
              `).join("")}
            </ul>
            <span class="pillbar__spacer"></span>
            ${state.libraryLocked
              ? `<button class="btn btn--primary" type="button"
                  data-action="account-open" data-mode="signup">Создать аккаунт</button>`
              : `<button class="btn btn--primary" type="button" data-view="catalog">Открыть хранилище</button>`}
          </nav>
        </header>
        <section class="content" id="view-content"></section>
      </div>
    </div>
  `;

  renderWelcome(root.querySelector("#view-content"), state);
  restoreScrollTop(root, keptScroll);
  bindEvents(root, state);
  bindWelcomeScroll(root);
  setupImageFallbacks(root);
}

// Якоря внутри витрины: обычный hash здесь занят маршрутизацией видов,
// поэтому прокручиваем вручную по data-атрибуту.
function bindWelcomeScroll(root) {
  root.querySelectorAll("[data-welcome-scroll]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = root.querySelector(`#welcome-${button.dataset.welcomeScroll}`);
      if (!target) return;
      const reduced = document.documentElement.dataset.motion === "reduced";
      target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
  });
}

function readScrollTop(root) {
  return root.querySelector(".content-scroll")?.scrollTop ?? 0;
}

function restoreScrollTop(root, value) {
  if (!value) return;
  const scroller = root.querySelector(".content-scroll");
  if (scroller) scroller.scrollTop = value;
}

// У оверлеев своя прокрутка, и она тоже не должна прыгать в начало из-за
// нажатия на звезду или смены статуса.
function restoreOverlayScroll(root, selector, value) {
  if (!value) return;
  const scroller = root.querySelector(selector);
  if (scroller) scroller.scrollTop = value;
}

function renderShortcuts(state) {
  if (!state.shortcutsOpen) return "";
  return `
    <div class="sheet">
      <div class="sheet__scrim" data-action="shortcuts-close"></div>
      <section class="sheet__panel" role="dialog" aria-modal="true"
        aria-label="Горячие клавиши">
        <header class="sheet__head">
          <span class="sheet__glyph">${icon("keyboard")}</span>
          <div>
            <p class="eyebrow">Управление с клавиатуры</p>
            <h2>Горячие клавиши</h2>
          </div>
          <button class="icon-btn" type="button" data-action="shortcuts-close"
            aria-label="Закрыть">${icon("close")}</button>
        </header>
        <ul class="sheet__list">
          ${SHORTCUTS.map(([keys, text]) => `
            <li>
              <span class="sheet__keys">${keys.map((key) => `<kbd>${escapeHtml(key)}</kbd>`).join("")}</span>
              <span>${escapeHtml(text)}</span>
            </li>
          `).join("")}
        </ul>
        <p class="sheet__foot">Клавиши не срабатывают, пока курсор стоит в поле ввода.</p>
      </section>
    </div>`;
}

function bindEvents(root, state) {
  root.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => state.onNavigate(button.dataset.view));
  });
  root.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      state.onAction(button.dataset.action, { ...button.dataset });
    });
  });
  bindScrollBehaviour(root);
  // Поле без формы, но с очевидным действием: Enter делает то же, что кнопка
  // рядом. Иначе поиск друга требовал бы мыши.
  root.querySelectorAll("[data-submit-action]").forEach((field) => {
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      state.onAction(field.dataset.submitAction, {});
    });
  });
  root.querySelectorAll("[data-control]").forEach((control) => {
    const eventName = control.matches('input[type="search"], input[type="text"]')
      ? "input"
      : "change";
    control.addEventListener(eventName, () => {
      state.onControl(control.dataset.control, {
        value: control.value,
        files: control.files,
        checked: control.checked,
      });
    });
  });
}

// Всё, что зависит от прокрутки: кнопка «наверх» и подавление наведения.
//
// Курсор при прокрутке стоит на месте, а содержимое едет под ним — строки
// по очереди получают и теряют :hover, и их подсветка мигает. Пока страница
// едет, содержимое не принимает указатель: наведение гаснет один раз в начале
// и возвращается один раз в конце.
//
// Слушатель пассивный и лёгкий: раз в кадр переключает класс кнопки, а класс
// прокрутки ставится в начале и снимается по таймеру бездействия.
function bindScrollBehaviour(root) {
  const scroller = root.querySelector(".content-scroll");
  if (!scroller) return;

  const button = root.querySelector("[data-scroll-top]");
  // Порог с запасом: кнопка появляется на 640 и прячется только на 400,
  // иначе она мигала бы у самой границы.
  const SHOW_AT = 640;
  const HIDE_AT = 400;
  const IDLE_MS = 140;

  let queued = false;
  let idleTimer = 0;

  const sync = () => {
    queued = false;
    if (!button) return;
    const visible = button.classList.contains("is-visible");
    const top = scroller.scrollTop;
    if (!visible && top > SHOW_AT) button.classList.add("is-visible");
    else if (visible && top < HIDE_AT) button.classList.remove("is-visible");
  };

  scroller.addEventListener("scroll", () => {
    scroller.classList.add("is-scrolling");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => scroller.classList.remove("is-scrolling"), IDLE_MS);
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }, { passive: true });

  button?.addEventListener("click", () => {
    const reduced = document.documentElement.dataset.motion === "reduced";
    scroller.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  });

  sync();
}

// Кнопка раздела: в шапке её место занял личный кабинет, поэтому главное
// действие стоит в панели самого раздела, рядом со счётчиком.
function primaryAction(action, label, iconName) {
  return `
    <button class="btn btn--primary btn--sm" type="button" data-action="${action}">
      ${icon(iconName)}<span>${escapeHtml(label)}</span>
    </button>`;
}

function getNavCounts(state) {
  const library = state.library ?? {};
  return {
    catalog: (library.movies ?? []).length,
    franchises: (library.franchises ?? []).length,
    categories: (library.categories ?? []).length,
    watched: (library.movies ?? []).filter((movie) => movie.watchedAt).length,
    wheel: state.activeSession
      ? state.activeSession.pool.length
      : (state.rollDraftPool ?? []).length,
    sessions: (library.rollSessions ?? [])
      .filter((session) => session.status === "completed").length,
    // У «Друзей» счётчик значит другое: не размер раздела, а сколько заявок
    // ждут ответа. Ноль друзей — просто пустой раздел, а не повод для метки.
    friends: countIncoming(state.friends?.rows, state.account?.id),
  };
}

function getViewMeta(view) {
  return VIEW_META[view] ?? { title: "CineVault", eyebrow: "Раздел" };
}

function renderCurrentView(container, state) {
  if (state.error) {
    container.innerHTML = `
      <section class="notice notice--error">
        <span class="notice__icon">${icon("warning")}</span>
        <div>
          <p class="eyebrow">Хранилище недоступно</p>
          <h2>Не удалось открыть хранилище библиотеки</h2>
          <p>${escapeHtml(state.error.message)}</p>
          <p class="muted">Запускайте приложение через <code>launch.py</code>,
          а не открывайте <code>index.html</code> напрямую из файла.</p>
        </div>
      </section>
    `;
    return;
  }

  const views = {
    dashboard: renderDashboard,
    catalog: renderCatalog,
    categories: (node, appState) => renderCategories(node, appState.library),
    franchises: (node, appState) => renderFranchises(node, appState.library),
    wheel: renderWheel,
    watched: (node, appState) => renderWatched(node, appState.library),
    sessions: (node, appState) => renderSessions(node, appState.library.rollSessions),
    insights: (node, appState) => renderInsights(node, appState.library),
  };

  (views[state.view] ?? renderDashboard)(container, state);
}

/* ------------------------------------------------- Настройки и друзья */

// Оба экрана технические и не относятся к библиотеке, поэтому открываются
// поверх неё окном по центру, а фон под ними размывается. Раздел, в котором
// человек был, при этом никуда не уезжает.
const MODAL_VIEWS = Object.freeze({
  settings: { title: "Настройки", eyebrow: "Данные и интеграции", render: renderSettings },
  friends: { title: "Друзья", eyebrow: "Заявки и доступ к библиотеке", render: renderFriends },
});

export function isModalView(view) {
  return Object.hasOwn(MODAL_VIEWS, view);
}

function renderModalView(state, opening = true) {
  const modal = MODAL_VIEWS[state.modalView];
  if (!modal) return "";

  return `
    <div class="overlay ${opening ? "is-entering" : ""}">
      <div class="overlay__scrim" data-action="modal-close"></div>
      <section class="overlay__panel" role="dialog" aria-modal="true"
        aria-label="${escapeAttribute(modal.title)}">
        <header class="overlay__head">
          <div>
            <p class="eyebrow">${escapeHtml(modal.eyebrow)}</p>
            <h2>${escapeHtml(modal.title)}</h2>
          </div>
          <button class="icon-btn" type="button" data-action="modal-close"
            aria-label="Закрыть">${icon("close")}</button>
        </header>
        <div class="overlay__body" id="modal-content"></div>
      </section>
    </div>`;
}

function renderModalContent(root, state) {
  const modal = MODAL_VIEWS[state.modalView];
  const container = root.querySelector("#modal-content");
  if (!modal || !container) return;
  modal.render(container, state);
}

/* ---------------------------------------------------------------- Главная */

function renderDashboard(container, state) {
  const { statistics, library } = state;
  const recentMovies = [...library.movies]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 12);
  const movieById = new Map(library.movies.map((movie) => [movie.id, movie]));
  const collections = library.franchises.slice(0, 4);
  const heroMovie = pickHeroMovie(library.movies);
  const watchedShare = statistics.movieCount
    ? Math.round((statistics.watchedMovieCount / statistics.movieCount) * 100)
    : 0;
  const topGenres = getTopGenres(library.movies, 6);
  // Начатое важнее следующего в очереди, поэтому «смотрю» выносится отдельной
  // строкой и не дублируется ниже.
  const watchingNow = library.movies
    .filter((movie) => !movie.watchedAt && movie.status === MOVIE_STATUS.watching)
    .slice(0, 4);
  const watchingIds = new Set(watchingNow.map((movie) => movie.id));
  const nextUp = library.movies
    .filter((movie) => !movie.watchedAt && !watchingIds.has(movie.id))
    .sort((a, b) => a.categoryPosition - b.categoryPosition)
    .slice(0, 4);
  const backupDue = isBackupReminderDue({
    movieCount: library.movies.length,
    lastBackupAt: library.settings.lastBackupAt,
    dismissedUntil: library.settings.backupReminderDismissedUntil,
    reminderDays: library.settings.backupReminderDays,
  });

  container.innerHTML = `
    <section class="hero ${heroMovie?.coverUrl ? "has-poster" : ""}">
      ${heroMovie?.coverUrl
        ? `<div class="hero__backdrop" aria-hidden="true">
             <img src="${escapeAttribute(heroMovie.coverUrl)}" alt=""
               referrerpolicy="no-referrer"
               data-poster-fallback="">
           </div>`
        : ""}
      <div class="hero__grain" aria-hidden="true"></div>

      <div class="hero__content">
        <p class="eyebrow eyebrow--accent">
          ${icon("sparkles")} Личная киноколлекция
        </p>
        <h2 class="hero__title">
          ${statistics.movieCount
            ? "Что посмотрим<br>сегодня вечером?"
            : "Соберите свою<br>идеальную фильмотеку"}
        </h2>
        <p class="hero__lead">
          ${statistics.movieCount
            ? "Откройте каталог, чтобы выбрать вручную, или доверьте решение колесу с механикой выбывания."
            : "Добавьте первый фильм вручную или найдите его в TMDB — постер, год, жанры и описание заполнятся автоматически."}
        </p>
        <div class="hero__actions">
          ${statistics.movieCount ? `
            <button class="btn btn--primary btn--lg" type="button" data-action="movie-add">
              ${icon("plus")}<span>Добавить фильм</span>
            </button>
            <button class="btn btn--glass btn--lg" type="button" data-view="catalog">
              ${icon("film")}<span>Открыть каталог</span>
            </button>
          ` : `
            <button class="btn btn--primary btn--lg" type="button" data-action="movie-add">
              ${icon("plus")}<span>Добавить первый фильм</span>
            </button>
            <button class="btn btn--glass btn--lg" type="button" data-view="settings">
              ${icon("bolt")}<span>Подключить TMDB</span>
            </button>
          `}
        </div>

        <dl class="hero__facts">
          <div>
            <dt>Всего фильмов</dt>
            <dd>${statistics.movieCount.toLocaleString("ru-RU")}</dd>
          </div>
          <div>
            <dt>Просмотрено</dt>
            <dd>${watchedShare}<span>%</span></dd>
          </div>
          <div>
            <dt>Часов кино</dt>
            <dd>${formatWatchedHours(statistics.watchedDurationMinutes)}</dd>
          </div>
        </dl>
      </div>

      ${heroMovie ? `
        <figure class="hero__poster">
          <button class="hero__poster-card" type="button"
            data-action="movie-open" data-id="${heroMovie.id}"
            aria-label="Открыть карточку: ${escapeAttribute(heroMovie.title)}">
            <span class="hero__poster-frame">
              ${heroMovie.coverUrl
                ? `<img src="${escapeAttribute(heroMovie.coverUrl)}" alt=""
                     referrerpolicy="no-referrer"
                     data-poster-fallback="${escapeAttribute(initials(heroMovie.title))}">`
                : `<span class="poster-fallback">${escapeHtml(initials(heroMovie.title))}</span>`}
              <span class="hero__poster-hint">${icon("arrowRight")}</span>
            </span>
            <span class="hero__poster-meta">
              <span class="eyebrow">${heroMovie.watchedAt ? "Просмотрен" : "В очереди"}</span>
              <strong>${escapeHtml(heroMovie.title)}</strong>
              <small>${escapeHtml([heroMovie.releaseYear, heroMovie.country].filter(Boolean).join(" · ") || "Без метаданных")}</small>
            </span>
          </button>
        </figure>
      ` : ""}
    </section>

    <div class="stat-row">
      ${statCard("Фильмов в базе", statistics.movieCount, "film", "catalog")}
      ${statCard("Просмотрено", statistics.watchedMovieCount, "eye", "watched", watchedShare)}
      ${statCard("Ждут очереди", statistics.unwatchedMovieCount, "bookmark", "catalog")}
      ${statCard("Коллекций", statistics.franchiseCount, "collection", "franchises")}
    </div>

    ${statistics.movieCount ? `
      <section class="block">
        <header class="block__head">
          <div>
            <p class="eyebrow">Свежее пополнение</p>
            <h2>Недавно добавлено</h2>
          </div>
          <button class="btn btn--ghost btn--sm" type="button" data-view="catalog">
            Весь каталог ${icon("arrowRight")}
          </button>
        </header>
        <div class="rail">
          ${recentMovies.map(posterTile).join("")}
        </div>
      </section>
    ` : ""}

    ${watchingNow.length ? `
      <section class="block">
        <header class="block__head">
          <div>
            <p class="eyebrow">Начато</p>
            <h2>Смотрю сейчас</h2>
          </div>
          <button class="btn btn--ghost btn--sm" type="button"
            data-action="catalog-status-open" data-status="${MOVIE_STATUS.watching}">
            Все начатые ${icon("arrowRight")}
          </button>
        </header>
        <div class="queue-row">
          ${watchingNow.map((movie) => `
            <article class="queue-chip">
              <span class="queue-chip__poster">
                ${movie.coverUrl
                  ? `<img src="${escapeAttribute(movie.coverUrl)}" alt="" loading="lazy"
                      referrerpolicy="no-referrer"
                      data-poster-fallback="${escapeAttribute(initials(movie.title))}">`
                  : `<span class="poster-fallback">${escapeHtml(initials(movie.title))}</span>`}
              </span>
              <span class="queue-chip__text">
                <strong>${escapeHtml(movie.title)}</strong>
                <small>${movie.releaseYear ?? "—"}${movie.durationMinutes ? ` · ${movie.durationMinutes} мин` : ""}</small>
              </span>
              <button class="icon-btn icon-btn--sm" type="button"
                data-action="watch-add" data-id="${movie.id}"
                aria-label="Отметить просмотренным"
                title="Отметить просмотренным">${icon("check")}</button>
              <button class="icon-btn icon-btn--sm" type="button"
                data-action="movie-open" data-id="${movie.id}"
                aria-label="Открыть карточку">${icon("chevronRight")}</button>
            </article>
          `).join("")}
        </div>
      </section>
    ` : ""}

    ${nextUp.length ? `
      <section class="block">
        <header class="block__head">
          <div>
            <p class="eyebrow">Следующий шаг</p>
            <h2>Первые в очереди</h2>
          </div>
          <button class="btn btn--ghost btn--sm" type="button" data-view="wheel">
            К колесу ${icon("arrowRight")}
          </button>
        </header>
        <div class="queue-row">
          ${nextUp.map((movie, index) => `
            <article class="queue-chip">
              <span class="queue-chip__index">${index + 1}</span>
              <span class="queue-chip__poster">
                ${movie.coverUrl
                  ? `<img src="${escapeAttribute(movie.coverUrl)}" alt="" loading="lazy"
                      referrerpolicy="no-referrer"
                      data-poster-fallback="${escapeAttribute(initials(movie.title))}">`
                  : `<span class="poster-fallback">${escapeHtml(initials(movie.title))}</span>`}
              </span>
              <span class="queue-chip__text">
                <strong>${escapeHtml(movie.title)}</strong>
                <small>${movie.releaseYear ?? "—"}${movie.durationMinutes ? ` · ${movie.durationMinutes} мин` : ""}</small>
              </span>
              <button class="icon-btn icon-btn--sm" type="button"
                data-action="movie-open" data-id="${movie.id}"
                aria-label="Открыть карточку">${icon("chevronRight")}</button>
            </article>
          `).join("")}
        </div>
      </section>
    ` : ""}

    ${collections.length ? `
      <section class="block">
        <header class="block__head">
          <div>
            <p class="eyebrow">Циклы и саги</p>
            <h2>Коллекции</h2>
          </div>
          <button class="btn btn--ghost btn--sm" type="button" data-view="franchises">
            Все коллекции ${icon("arrowRight")}
          </button>
        </header>
        <div class="collection-row">
          ${collections.map((franchise) => collectionCard(franchise, movieById)).join("")}
        </div>
      </section>
    ` : ""}

    <section class="insight-grid">
      <article class="panel panel--chart">
        <p class="eyebrow">Профиль вкуса</p>
        <h3>Жанры коллекции</h3>
        ${topGenres.length ? `
          <ul class="bar-list">
            ${topGenres.map(([genre, count]) => `
              <li>
                <span class="bar-list__label">${escapeHtml(genre)}</span>
                <span class="bar-list__track">
                  <span class="bar-list__fill"
                    style="--value:${Math.round((count / topGenres[0][1]) * 100)}%"></span>
                </span>
                <span class="bar-list__value">${count}</span>
              </li>
            `).join("")}
          </ul>
        ` : `<p class="muted">Жанры появятся после добавления фильмов через TMDB
          или ручного заполнения поля «Жанры».</p>`}
      </article>

      <article class="panel">
        <p class="eyebrow">Рейтинг</p>
        <h3>Лидеры и аутсайдеры</h3>
        ${statistics.highestRatedMovie ? `
          <div class="rank-item">
            <span class="rank-item__badge rank-item__badge--top">${icon("trophy")}</span>
            <span>
              <strong>${escapeHtml(statistics.highestRatedMovie.movie.title)}</strong>
              <small>Лучшая средняя оценка</small>
            </span>
            <b>${formatRating(statistics.highestRatedMovie.rating)}</b>
          </div>
          ${statistics.lowestRatedMovie &&
            statistics.lowestRatedMovie.movie.id !== statistics.highestRatedMovie.movie.id ? `
            <div class="rank-item">
              <span class="rank-item__badge">${icon("target")}</span>
              <span>
                <strong>${escapeHtml(statistics.lowestRatedMovie.movie.title)}</strong>
                <small>Самая низкая оценка</small>
              </span>
              <b>${formatRating(statistics.lowestRatedMovie.rating)}</b>
            </div>
          ` : ""}
          <div class="mini-stats">
            <div><strong>${formatRating(statistics.libraryAverageRating)}</strong><small>средняя</small></div>
            <div><strong>${statistics.totalRatingCount}</strong><small>оценок</small></div>
            <div><strong>${statistics.watchedFranchiseCount}</strong><small>коллекций пройдено</small></div>
          </div>
        ` : `
          <p class="muted">${statistics.movieCount
            ? "Оцените просмотренные фильмы — здесь появится рейтинг коллекции."
            : "Добавьте фильмы, отметьте просмотр и поставьте оценки."}</p>
          <button class="btn btn--ghost btn--sm" type="button" data-view="watched">
            К просмотренным ${icon("arrowRight")}
          </button>
        `}
      </article>

      <article class="panel panel--cta">
        <span class="panel__glyph">${icon("wheel")}</span>
        <p class="eyebrow">Кинорулетка</p>
        <h3>${statistics.movieCount ? "Не знаете, что выбрать?" : "Колесо ждёт фильмы"}</h3>
        <p>${statistics.movieCount
          ? "Колесо соберёт участников по квотам списков и устроит батл-рояль с сейвами."
          : "Задайте квоты спискам — и колесо соберёт пул автоматически."}</p>
        <button class="btn btn--primary" type="button"
          ${statistics.movieCount ? 'data-view="wheel"' : 'data-action="movie-add"'}>
          ${statistics.movieCount ? "Открыть колесо" : "Добавить фильм"} ${icon("arrowRight")}
        </button>
      </article>
    </section>

    ${backupDue ? `
      <section class="notice notice--accent">
        <span class="notice__icon">${icon("download")}</span>
        <div>
          <p class="eyebrow">Резервная копия</p>
          <h2>${library.settings.lastBackupAt
            ? "Пора обновить резервную копию"
            : "Резервная копия ещё не создавалась"}</h2>
          <p>Резервная копия — вся библиотека одним файлом. Скачайте JSON сейчас
          или отложите напоминание на ${library.settings.backupReminderDays ?? 30} дней.</p>
        </div>
        <div class="notice__actions">
          <button class="btn btn--primary" type="button" data-action="backup-export">
            ${icon("download")}<span>Скачать JSON</span>
          </button>
          <button class="btn btn--ghost" type="button" data-action="backup-remind-later">
            Напомнить позже
          </button>
        </div>
      </section>
    ` : ""}

    ${state.legacyDataFound ? `
      <section class="notice">
        <span class="notice__icon">${icon("database")}</span>
        <div>
          <p class="eyebrow">Найдена старая версия</p>
          <h2>Данные Movie Manager готовы к переносу</h2>
          <p>Миграция объединит старую библиотеку с текущей и ничего не удалит.</p>
        </div>
        <div class="notice__actions">
          <button class="btn btn--primary" type="button" data-view="settings">
            Открыть настройки ${icon("arrowRight")}
          </button>
        </div>
      </section>
    ` : ""}
  `;
}

function statCard(label, value, iconName, view, progress = null) {
  return `
    <button class="stat-card" type="button" data-view="${view}">
      <span class="stat-card__icon">${icon(iconName)}</span>
      <span class="stat-card__value">${Number(value ?? 0).toLocaleString("ru-RU")}</span>
      <span class="stat-card__label">${escapeHtml(label)}</span>
      ${progress === null ? "" : `
        <span class="stat-card__progress" aria-hidden="true">
          <span style="--value:${progress}%"></span>
        </span>
        <span class="stat-card__hint">${progress}% библиотеки</span>
      `}
    </button>`;
}

function posterTile(movie) {
  const rating = calculateAverageRating(movie.ratings);
  return `
    <button class="poster-tile" type="button" data-action="movie-open" data-id="${movie.id}">
      <span class="poster-tile__art">
        ${movie.coverUrl
          ? `<img src="${escapeAttribute(movie.coverUrl)}" alt="" loading="lazy"
              referrerpolicy="no-referrer"
              data-poster-fallback="${escapeAttribute(initials(movie.title))}">`
          : `<span class="poster-fallback">${escapeHtml(initials(movie.title))}</span>`}
        ${rating === null ? "" : `<span class="poster-tile__rating">${icon("star")}${rating}</span>`}
        ${movie.watchedAt ? `<span class="poster-tile__seen">${icon("check")}</span>` : ""}
      </span>
      <strong>${escapeHtml(movie.title)}</strong>
      <small>${movie.releaseYear ?? "год неизвестен"}</small>
    </button>`;
}

function collectionCard(franchise, movieById) {
  const movies = franchise.movieIds.map((id) => movieById.get(id)).filter(Boolean);
  const watched = movies.filter((movie) => movie.watchedAt).length;
  const progress = movies.length ? Math.round((watched / movies.length) * 100) : 0;
  return `
    <article class="collection-card">
      <div class="collection-card__stack">
        ${movies.slice(0, 3).map((movie, index) => `
          <span class="collection-card__layer" style="--i:${index}">
            ${movie.coverUrl
              ? `<img src="${escapeAttribute(movie.coverUrl)}" alt="" loading="lazy"
                  referrerpolicy="no-referrer"
                  data-poster-fallback="${escapeAttribute(initials(movie.title))}">`
              : `<span class="poster-fallback">${escapeHtml(initials(movie.title))}</span>`}
          </span>
        `).join("") || '<span class="collection-card__layer"><span class="poster-fallback">CV</span></span>'}
      </div>
      <div class="collection-card__body">
        <p class="eyebrow">Коллекция</p>
        <h3>${escapeHtml(franchise.name)}</h3>
        <p class="muted">${movies.length} ${pluralize(movies.length, ["фильм", "фильма", "фильмов"])}
          · просмотрено ${watched}</p>
        <span class="progress" aria-hidden="true"><span style="--value:${progress}%"></span></span>
        <button class="btn btn--ghost btn--sm" type="button"
          data-action="franchise-edit" data-id="${franchise.id}">
          Открыть ${icon("arrowRight")}
        </button>
      </div>
    </article>`;
}

/* ----------------------------------------------------- Карточка фильма */

// Карточка фильма — окно по центру с размытым фоном, как настройки и друзья.
//
// Раньше это была выдвижная шторка, а метаданные лежали россыпью бордюрных
// чипов: год, длительность и страна занимали три рамки на всю ширину. Теперь
// постер стоит слева, справа — заголовок, одна строка метаданных через точку,
// описание и жанры; действия собраны внизу одной строкой.
function renderMovieDetail(state, opening = true) {
  const movie = state.library?.movies?.find((item) => item.id === state.detailMovieId);
  if (!movie) return "";

  const category = state.library.categories.find((item) => item.id === movie.categoryId);
  const franchise = getMovieFranchiseMap(state.library.franchises).get(movie.id);
  const rating = calculateAverageRating(movie.ratings);
  const status = getMovieStatus(movie);
  const meta = [
    movie.releaseYear,
    movie.durationMinutes ? `${movie.durationMinutes} мин` : "",
    movie.country,
  ].filter(Boolean);

  return `
    <div class="overlay overlay--movie ${opening ? "is-entering" : ""}">
      <div class="overlay__scrim" data-action="detail-close"></div>
      <article class="movie-modal" role="dialog" aria-modal="true"
        aria-label="${escapeAttribute(movie.title)}">
        <button class="icon-btn movie-modal__close" type="button" data-action="detail-close"
          aria-label="Закрыть">${icon("close")}</button>

        <div class="movie-modal__scroll">
          <div class="movie-modal__top">
            <div class="movie-modal__poster">
              ${movie.coverUrl
                ? `<img src="${escapeAttribute(movie.coverUrl)}"
                    alt="Постер: ${escapeAttribute(movie.title)}" referrerpolicy="no-referrer"
                    data-poster-fallback="${escapeAttribute(initials(movie.title))}">`
                : `<span class="poster-fallback">${escapeHtml(initials(movie.title))}</span>`}
            </div>

            <div class="movie-modal__head">
              <p class="eyebrow">${escapeHtml(category?.name ?? "Без списка")}</p>
              <h2>${escapeHtml(movie.title)}</h2>
              ${movie.originalTitle
                ? `<p class="movie-modal__original">${escapeHtml(movie.originalTitle)}</p>`
                : ""}

              ${meta.length
                ? `<p class="movie-modal__meta">${meta.map(escapeHtml).join(" · ")}</p>`
                : ""}

              <div class="movie-modal__badges">
                <span class="status-dot status-dot--${status}">
                  ${icon(STATUS_ICONS[status])}
                  ${movie.watchedAt
                    ? `Просмотрен ${escapeHtml(formatDate(movie.watchedAt))}`
                    : escapeHtml(MOVIE_STATUS_LABELS[status])}
                </span>
                ${rating === null ? "" : `
                  <span class="status-dot status-dot--score">${icon("starFilled")}${rating}</span>`}
                ${movie.isFavorite
                  ? `<span class="status-dot status-dot--fav">${icon("starFilled")}Избранное</span>`
                  : ""}
                ${franchise ? `
                  <span class="status-dot">${icon("collection")}${escapeHtml(franchise.name)}</span>`
                  : ""}
              </div>
            </div>
          </div>

          <p class="movie-modal__overview ${movie.overview ? "" : "is-empty"}">
            ${movie.overview ? escapeHtml(movie.overview) : "Описание не заполнено."}
          </p>

          ${(movie.genres ?? []).length || (movie.tags ?? []).length ? `
            <div class="chip-row chip-row--soft">
              ${(movie.genres ?? []).map((genre) =>
                `<span class="chip chip--soft">${escapeHtml(genre)}</span>`).join("")}
              ${(movie.tags ?? []).map((tag) => `
                <button class="chip chip--tag" type="button"
                  data-action="catalog-tag-open" data-tag="${escapeAttribute(tag)}"
                  title="Показать все фильмы с тегом">${icon("tag")}${escapeHtml(tag)}</button>
              `).join("")}
            </div>` : ""}

          ${movie.notes ? `
            <section class="movie-modal__block">
              <h3>${icon("note")}Заметка</h3>
              <p>${escapeHtml(movie.notes)}</p>
            </section>` : ""}

          <section class="movie-modal__block">
            <h3>${icon("star")}Оценки</h3>
            <div class="rating-list">
              ${(movie.ratings ?? []).map((item) => `
                <span class="rating-chip">
                  <b>${escapeHtml(item.participantName)}</b>
                  <span>${item.value}</span>
                  <button type="button" data-action="rating-delete" data-id="${movie.id}"
                    data-rating-id="${item.id}" aria-label="Удалить оценку">${icon("close")}</button>
                </span>
              `).join("") || '<span class="muted">Оценок пока нет</span>'}
            </div>
          </section>
        </div>

        <footer class="movie-modal__foot">
          ${movie.watchedAt ? "" : `
            <div class="status-switch" role="group" aria-label="Статус фильма">
              ${[MOVIE_STATUS.queued, MOVIE_STATUS.watching, MOVIE_STATUS.dropped].map((value) => `
                <button type="button" class="${status === value ? "is-active" : ""}"
                  data-action="movie-status-set" data-id="${movie.id}" data-status="${value}"
                  aria-pressed="${status === value}" title="${escapeAttribute(MOVIE_STATUS_LABELS[value])}">
                  ${icon(STATUS_ICONS[value])}<span>${escapeHtml(MOVIE_STATUS_LABELS[value])}</span>
                </button>
              `).join("")}
            </div>`}

          <div class="movie-modal__actions">
            <button class="icon-btn ${movie.isFavorite ? "is-favorite" : ""}" type="button"
              data-action="movie-favorite-toggle" data-id="${movie.id}"
              aria-pressed="${Boolean(movie.isFavorite)}"
              title="${movie.isFavorite ? "Убрать из избранного" : "В избранное"}"
              aria-label="${movie.isFavorite ? "Убрать из избранного" : "В избранное"}">
              ${icon(movie.isFavorite ? "starFilled" : "star")}
            </button>
            <button class="icon-btn" type="button" data-action="movie-edit" data-id="${movie.id}"
              title="Редактировать" aria-label="Редактировать">${icon("edit")}</button>
            ${movie.watchedAt ? `
              <button class="icon-btn" type="button" data-action="watch-remove" data-id="${movie.id}"
                title="Вернуть в очередь" aria-label="Вернуть в очередь">${icon("refresh")}</button>` : ""}
            <button class="icon-btn icon-btn--danger" type="button"
              data-action="movie-delete" data-id="${movie.id}"
              title="Удалить" aria-label="Удалить">${icon("trash")}</button>
            <button class="btn btn--primary btn--sm" type="button"
              data-action="${movie.watchedAt ? "rating-add" : "watch-add"}" data-id="${movie.id}">
              ${icon(movie.watchedAt ? "star" : "check")}
              <span>${movie.watchedAt ? "Поставить оценку" : "Отметить просмотренным"}</span>
            </button>
          </div>
        </footer>
      </article>
    </div>`;
}

/* --------------------------------------------------------------- Каталог */

function renderCatalog(container, state) {
  const { library, catalogFilters } = state;
  // Три режима: обычная плитка, плотная плитка для больших библиотек и список.
  const viewMode = ["list", "dense"].includes(state.catalogView)
    ? state.catalogView
    : "grid";
  const categories = new Map(library.categories.map((category) => [category.id, category]));
  const franchiseByMovieId = getMovieFranchiseMap(library.franchises);
  const genres = [...new Set(
    library.movies.flatMap((movie) => movie.genres ?? []).filter(Boolean),
  )].sort((a, b) => a.localeCompare(b, "ru-RU"));
  const tags = collectLibraryTags(library.movies);
  const favoriteCount = library.movies.filter((movie) => movie.isFavorite).length;
  const selection = Boolean(state.selectionMode);
  const selectedIds = state.selectedMovieIds ?? new Set();
  const activeChips = buildFilterChips(catalogFilters, categories);
  const hasCustomizedCatalog = activeChips.length > 0 || catalogFilters.sort !== "title";
  const movies = filterCatalogMovies(library, catalogFilters);

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar__count">
        <p class="eyebrow">Библиотека</p>
        <h2>${movies.length}
          <small>${pluralize(movies.length, ["фильм", "фильма", "фильмов"])}${
            activeChips.length ? ` из ${library.movies.length}` : ""}</small>
        </h2>
      </div>
      <div class="toolbar__actions">
        <div class="segmented" role="group" aria-label="Статус">
          ${[
            ["all", "Все"],
            [MOVIE_STATUS.queued, MOVIE_STATUS_LABELS.queued],
            [MOVIE_STATUS.watching, MOVIE_STATUS_LABELS.watching],
            [MOVIE_STATUS.watched, "Просмотрено"],
            [MOVIE_STATUS.dropped, MOVIE_STATUS_LABELS.dropped],
          ]
            .map(([value, label]) => `
              <button type="button" class="${catalogFilters.status === value ? "is-active" : ""}"
                data-action="catalog-status-set" data-value="${value}"
                aria-pressed="${catalogFilters.status === value}">${label}</button>
            `).join("")}
        </div>
        <button type="button"
          class="btn btn--ghost btn--sm favorite-filter ${catalogFilters.favoritesOnly ? "is-active" : ""}"
          data-action="catalog-favorites-toggle"
          aria-pressed="${Boolean(catalogFilters.favoritesOnly)}"
          ${favoriteCount ? "" : "disabled"}
          title="${favoriteCount ? "Только избранное" : "В библиотеке нет избранного"}">
          ${icon(catalogFilters.favoritesOnly ? "starFilled" : "star")}<span>Избранное</span>
        </button>
        <button type="button"
          class="btn btn--ghost btn--sm ${selection ? "is-active" : ""}"
          data-action="selection-toggle"
          aria-pressed="${Boolean(selection)}">
          ${icon("check")}<span>${selection ? "Выйти из выделения" : "Выбрать"}</span>
        </button>
        <button type="button" class="btn btn--ghost btn--sm"
          data-action="catalog-lucky" ${movies.length ? "" : "disabled"}
          title="${movies.length
            ? "Случайный фильм из текущей выборки"
            : "Сначала нужен хотя бы один фильм"}">
          ${icon("dice")}<span>Мне повезёт</span>
        </button>
        <div class="segmented segmented--icons" role="group" aria-label="Вид">
          ${[
            ["grid", "Плитка", "grid"],
            ["dense", "Плотная плитка", "gridDense"],
            ["list", "Список", "list"],
          ].map(([mode, label, iconName]) => `
            <button type="button" class="${viewMode === mode ? "is-active" : ""}"
              data-action="catalog-view" data-mode="${mode}"
              aria-label="${label}" title="${label}"
              aria-pressed="${viewMode === mode}">${icon(iconName)}</button>
          `).join("")}
        </div>
        ${primaryAction("movie-add", "Добавить фильм", "plus")}
      </div>
    </div>

    <div class="filters">
      <label class="search-field">
        <span class="sr-only">Поиск</span>
        ${icon("search")}
        <input type="search" data-control="catalog-query"
          placeholder="Название, страна, жанр, коллекция…"
          value="${escapeAttribute(catalogFilters.query)}">
      </label>
      <div class="select-field">
        ${icon("layers")}
        <select data-control="catalog-category" aria-label="Список">
          <option value="">Все списки</option>
          ${[...library.categories].sort(sortByPosition).map((category) => `
            <option value="${category.id}"
              ${catalogFilters.categoryId === category.id ? "selected" : ""}>
              ${escapeHtml(category.name)}
            </option>`).join("")}
        </select>
        ${icon("chevronDown", "select-field__caret")}
      </div>
      <div class="select-field">
        ${icon("ticket")}
        <select data-control="catalog-genre" aria-label="Жанр">
          <option value="">Все жанры</option>
          ${genres.map((genre) => `
            <option value="${escapeAttribute(genre)}"
              ${catalogFilters.genre === genre ? "selected" : ""}>${escapeHtml(genre)}</option>
          `).join("")}
        </select>
        ${icon("chevronDown", "select-field__caret")}
      </div>
      ${tags.length ? `
        <div class="select-field">
          ${icon("tag")}
          <select data-control="catalog-tag" aria-label="Тег">
            <option value="">Все теги</option>
            ${tags.map(({ tag, count }) => `
              <option value="${escapeAttribute(tag)}"
                ${catalogFilters.tag === tag ? "selected" : ""}>${escapeHtml(tag)} · ${count}</option>
            `).join("")}
          </select>
          ${icon("chevronDown", "select-field__caret")}
        </div>` : ""}
      <div class="select-field">
        ${icon("shuffle")}
        <select data-control="catalog-sort" aria-label="Сортировка">
          ${CATALOG_SORTS.map(([value, label]) => `
            <option value="${value}" ${catalogFilters.sort === value ? "selected" : ""}>
              ${escapeHtml(label)}
            </option>`).join("")}
        </select>
        ${icon("chevronDown", "select-field__caret")}
      </div>
      ${hasCustomizedCatalog ? `
        <button class="btn btn--ghost btn--sm" type="button" data-action="catalog-filters-reset">
          ${icon("refresh")}<span>Сбросить</span>
        </button>` : ""}
    </div>

    ${activeChips.length ? `
      <div class="active-filters">
        ${activeChips.map((chip) => `
          <button class="chip chip--removable" type="button"
            data-action="catalog-filter-clear" data-filter="${chip.key}">
            <small>${escapeHtml(chip.label)}</small>
            <b>${escapeHtml(chip.value)}</b>
            ${icon("close")}
          </button>
        `).join("")}
      </div>` : ""}

    ${selection ? `
      <div class="bulk-bar ${selectedIds.size ? "is-active" : ""}">
        <div class="bulk-bar__count">
          <strong>${selectedIds.size}</strong>
          <span>${pluralize(selectedIds.size, ["фильм выбран", "фильма выбрано", "фильмов выбрано"])}</span>
        </div>
        <div class="bulk-bar__actions">
          <button class="btn btn--ghost btn--sm" type="button" data-action="selection-all">
            ${icon("check")}<span>Все на экране</span>
          </button>
          <button class="btn btn--ghost btn--sm" type="button" data-action="bulk-watch"
            ${selectedIds.size ? "" : "disabled"}>${icon("eye")}<span>Просмотрены</span></button>
          <button class="btn btn--ghost btn--sm" type="button" data-action="bulk-favorite"
            ${selectedIds.size ? "" : "disabled"}>${icon("star")}<span>В избранное</span></button>
          <button class="btn btn--ghost btn--sm" type="button" data-action="bulk-move"
            ${selectedIds.size ? "" : "disabled"}>${icon("layers")}<span>В список</span></button>
          <button class="btn btn--ghost btn--sm" type="button" data-action="bulk-tag"
            ${selectedIds.size ? "" : "disabled"}>${icon("tag")}<span>Теги</span></button>
          <button class="btn btn--danger-ghost btn--sm" type="button" data-action="bulk-delete"
            ${selectedIds.size ? "" : "disabled"}>${icon("trash")}<span>Удалить</span></button>
        </div>
      </div>` : ""}

    ${movies.length === 0 ? emptyBlock(
      library.movies.length ? "Ничего не нашлось" : "Каталог пока пуст",
      library.movies.length
        ? "Попробуйте изменить запрос или сбросить фильтры списка, жанра и статуса."
        : "Добавьте первый фильм: найдите карточку в TMDB или заполните поля вручную.",
      library.movies.length
        ? { action: "catalog-filters-reset", label: "Сбросить фильтры", icon: "refresh" }
        : { action: "movie-add", label: "Добавить фильм", icon: "plus" },
    ) : viewMode !== "list" ? `
      <div class="movie-grid ${selection ? "is-selecting" : ""}" data-density="${viewMode}">
        ${movies.map((movie, index) => movieCard(
          movie,
          categories.get(movie.categoryId),
          franchiseByMovieId.get(movie.id),
          index,
          { selection, selected: selectedIds.has(movie.id) },
        )).join("")}
      </div>
    ` : `
      <div class="movie-list ${selection ? "is-selecting" : ""}">
        ${movies.map((movie) => movieRow(
          movie,
          categories.get(movie.categoryId),
          franchiseByMovieId.get(movie.id),
          { selection, selected: selectedIds.has(movie.id) },
        )).join("")}
      </div>
    `}
  `;
}

function buildFilterChips(filters, categories) {
  const chips = [];
  if (filters.query.trim()) {
    chips.push({ key: "query", label: "Поиск", value: filters.query.trim() });
  }
  if (filters.categoryId) {
    chips.push({
      key: "categoryId",
      label: "Список",
      value: categories.get(filters.categoryId)?.name ?? "—",
    });
  }
  if (filters.genre) {
    chips.push({ key: "genre", label: "Жанр", value: filters.genre });
  }
  if (filters.status !== "all") {
    chips.push({
      key: "status",
      label: "Статус",
      value: MOVIE_STATUS_LABELS[filters.status] ?? filters.status,
    });
  }
  if (filters.tag) {
    chips.push({ key: "tag", label: "Тег", value: filters.tag });
  }
  if (filters.favoritesOnly) {
    chips.push({ key: "favoritesOnly", label: "Отбор", value: "Избранное" });
  }
  return chips;
}

const STATUS_ICONS = Object.freeze({
  queued: "bookmark",
  watching: "play",
  watched: "check",
  dropped: "close",
});

function statusBadge(movie, { compact = false } = {}) {
  const status = getMovieStatus(movie);
  const label = MOVIE_STATUS_LABELS[status];
  return `<span class="badge badge--status badge--${status}" title="${escapeAttribute(label)}">
    ${icon(STATUS_ICONS[status])}${compact ? "" : escapeHtml(label)}
  </span>`;
}

function movieCard(movie, category, franchise, index = 0, options = {}) {
  const rating = calculateAverageRating(movie.ratings);
  const { selection = false, selected = false } = options;
  return `
    <article class="movie-card ${movie.watchedAt ? "is-watched" : ""} ${selected ? "is-selected" : ""}"
      style="--i:${index % 24}">
      <button class="movie-card__hit" type="button"
        data-action="${selection ? "selection-toggle-movie" : "movie-open"}" data-id="${movie.id}"
        aria-label="${selection
          ? `${selected ? "Снять выделение" : "Выделить"}: ${escapeAttribute(movie.title)}`
          : `Открыть карточку ${escapeAttribute(movie.title)}`}"></button>
      ${selection ? `
        <span class="movie-card__check ${selected ? "is-on" : ""}" aria-hidden="true">
          ${selected ? icon("check") : ""}
        </span>` : ""}
      <div class="movie-card__cover">
        ${movie.coverUrl
          ? `<img src="${escapeAttribute(movie.coverUrl)}" alt="" loading="lazy"
              referrerpolicy="no-referrer"
              data-poster-fallback="${escapeAttribute(initials(movie.title))}">`
          : `<span class="poster-fallback">${escapeHtml(initials(movie.title))}</span>`}
        ${movie.coverUrl ? `<div class="movie-card__gradient"></div>` : ""}
        <div class="movie-card__badges">
          ${movie.isFavorite
            ? `<span class="badge badge--favorite" title="В избранном">${icon("starFilled")}</span>`
            : ""}
          ${rating === null ? "" : `<span class="badge badge--score">${icon("star")}${rating}</span>`}
          ${getMovieStatus(movie) === MOVIE_STATUS.queued ? "" : statusBadge(movie)}
        </div>
        <div class="movie-card__tools">
          <button class="icon-btn icon-btn--glass ${movie.isFavorite ? "is-favorite" : ""}"
            type="button" data-action="movie-favorite-toggle" data-id="${movie.id}"
            aria-pressed="${Boolean(movie.isFavorite)}"
            aria-label="${movie.isFavorite ? "Убрать из избранного" : "В избранное"}"
            >${icon(movie.isFavorite ? "starFilled" : "star")}</button>
          <button class="icon-btn icon-btn--glass" type="button" data-action="movie-edit"
            data-id="${movie.id}" aria-label="Редактировать">${icon("edit")}</button>
          <button class="icon-btn icon-btn--glass icon-btn--danger" type="button"
            data-action="movie-delete" data-id="${movie.id}" aria-label="Удалить">${icon("trash")}</button>
        </div>
        ${!movie.watchedAt ? `
          <button class="movie-card__quick" type="button" data-action="watch-add" data-id="${movie.id}">
            ${icon("check")}<span>Просмотрен</span>
          </button>` : ""}
      </div>
      <div class="movie-card__body">
        <p class="movie-card__list">${escapeHtml(category?.name ?? "Без списка")}</p>
        <h3>${escapeHtml(movie.title)}</h3>
        <p class="movie-card__meta">
          ${movie.releaseYear ?? "—"}${movie.durationMinutes ? ` · ${movie.durationMinutes} мин` : ""}${movie.country ? ` · ${escapeHtml(movie.country)}` : ""}
        </p>
        ${(movie.genres ?? []).length ? `
          <p class="movie-card__genres">
            ${movie.genres.slice(0, 3).map((genre) =>
              `<span>${escapeHtml(genre)}</span>`).join("")}
          </p>` : ""}
        ${franchise ? `<span class="tag">${icon("collection")}${escapeHtml(franchise.name)}</span>` : ""}
      </div>
    </article>`;
}

function movieRow(movie, category, franchise, options = {}) {
  const rating = calculateAverageRating(movie.ratings);
  const { selection = false, selected = false } = options;
  return `
    <article class="movie-row ${movie.watchedAt ? "is-watched" : ""} ${selected ? "is-selected" : ""}">
      <button class="movie-row__hit" type="button"
        data-action="${selection ? "selection-toggle-movie" : "movie-open"}" data-id="${movie.id}"
        aria-label="${selection
          ? `${selected ? "Снять выделение" : "Выделить"}: ${escapeAttribute(movie.title)}`
          : `Открыть карточку ${escapeAttribute(movie.title)}`}"></button>
      ${selection ? `
        <span class="movie-row__check ${selected ? "is-on" : ""}" aria-hidden="true">
          ${selected ? icon("check") : ""}
        </span>` : ""}
      <span class="movie-row__cover">
        ${movie.coverUrl
          ? `<img src="${escapeAttribute(movie.coverUrl)}" alt="" loading="lazy"
              referrerpolicy="no-referrer"
              data-poster-fallback="${escapeAttribute(initials(movie.title))}">`
          : `<span class="poster-fallback">${escapeHtml(initials(movie.title))}</span>`}
      </span>
      <span class="movie-row__main">
        <strong>${escapeHtml(movie.title)}</strong>
        <small>${[
          category?.name ?? "Без списка",
          movie.releaseYear,
          movie.durationMinutes ? `${movie.durationMinutes} мин` : null,
          movie.country,
          franchise?.name,
        ].filter(Boolean).map((value) => escapeHtml(String(value))).join(" · ")}</small>
      </span>
      <span class="movie-row__status">${statusBadge(movie)}</span>
      <span class="movie-row__score">${rating === null ? "—" : `${icon("star")}${rating}`}</span>
      <span class="movie-row__tools">
        <button class="icon-btn icon-btn--sm ${movie.isFavorite ? "is-favorite" : ""}" type="button"
          data-action="movie-favorite-toggle" data-id="${movie.id}"
          aria-pressed="${Boolean(movie.isFavorite)}"
          aria-label="${movie.isFavorite ? "Убрать из избранного" : "В избранное"}"
          >${icon(movie.isFavorite ? "starFilled" : "star")}</button>
        ${!movie.watchedAt ? `
          <button class="icon-btn icon-btn--sm" type="button" data-action="watch-add"
            data-id="${movie.id}" aria-label="Отметить просмотренным">${icon("check")}</button>` : ""}
        <button class="icon-btn icon-btn--sm" type="button" data-action="movie-edit"
          data-id="${movie.id}" aria-label="Редактировать">${icon("edit")}</button>
        <button class="icon-btn icon-btn--sm icon-btn--danger" type="button"
          data-action="movie-delete" data-id="${movie.id}" aria-label="Удалить">${icon("trash")}</button>
      </span>
    </article>`;
}

/* --------------------------------------------------------- Просмотренные */

function renderWatched(container, library) {
  const watchedMovies = library.movies
    .filter((movie) => movie.watchedAt)
    .sort((a, b) => String(b.watchedAt).localeCompare(String(a.watchedAt)));
  const categoryById = new Map(library.categories.map((item) => [item.id, item]));
  const totalMinutes = watchedMovies.reduce(
    (sum, movie) => sum + (movie.durationMinutes ?? 0), 0,
  );
  const rated = watchedMovies
    .map((movie) => calculateAverageRating(movie.ratings))
    .filter((value) => value !== null);
  const average = rated.length
    ? Math.round((rated.reduce((sum, value) => sum + value, 0) / rated.length) * 10) / 10
    : null;

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar__count">
        <p class="eyebrow">История просмотров</p>
        <h2>${watchedMovies.length}
          <small>${pluralize(watchedMovies.length, ["фильм", "фильма", "фильмов"])}</small>
        </h2>
      </div>
      <div class="summary-pills">
        <span class="pill">${icon("clock")}${formatWatchedHours(totalMinutes)} ч</span>
        <span class="pill">${icon("star")}${average === null ? "—" : average}</span>
        ${primaryAction("movie-add", "Добавить фильм", "plus")}
      </div>
    </div>

    ${watchedMovies.length === 0 ? emptyBlock(
      "Просмотренных фильмов пока нет",
      "Победитель колеса попадёт сюда автоматически. Фильм также можно отметить вручную прямо из каталога.",
      { action: "movie-add", label: "Добавить фильм", icon: "plus" },
    ) : `
      <div class="watched-list">
        ${watchedMovies.map((movie) =>
          watchedRow(movie, categoryById.get(movie.categoryId))).join("")}
      </div>
    `}
  `;
}

function watchedRow(movie, category) {
  const average = calculateAverageRating(movie.ratings);
  return `
    <article class="watched-row">
      <button class="watched-row__cover" type="button" data-action="movie-open" data-id="${movie.id}"
        aria-label="Открыть ${escapeAttribute(movie.title)}">
        ${movie.coverUrl
          ? `<img src="${escapeAttribute(movie.coverUrl)}" alt="" loading="lazy"
              referrerpolicy="no-referrer"
              data-poster-fallback="${escapeAttribute(initials(movie.title))}">`
          : `<span class="poster-fallback">${escapeHtml(initials(movie.title))}</span>`}
      </button>
      <div class="watched-row__main">
        <p class="eyebrow">${escapeHtml(category?.name ?? "Без списка")}</p>
        <h3>${escapeHtml(movie.title)}</h3>
        <p class="watched-row__meta">
          ${icon("calendar")}<span>${formatDate(movie.watchedAt)}</span>
          ${movie.durationMinutes ? `${icon("clock")}<span>${movie.durationMinutes} мин</span>` : ""}
        </p>
        <div class="rating-list">
          ${(movie.ratings ?? []).map((rating) => `
            <span class="rating-chip">
              <b>${escapeHtml(rating.participantName)}</b>
              <span>${rating.value}</span>
              <button type="button" data-action="rating-delete" data-id="${movie.id}"
                data-rating-id="${rating.id}" aria-label="Удалить оценку">${icon("close")}</button>
            </span>
          `).join("") || '<span class="muted">Оценок пока нет</span>'}
        </div>
      </div>
      <div class="watched-row__aside">
        <span class="score-dial ${average === null ? "is-empty" : ""}"
          style="--value:${average === null ? 0 : Math.round((average / 10) * 100)}%">
          <b>${average === null ? "—" : average}</b>
        </span>
        <div class="watched-row__actions">
          <button class="btn btn--primary btn--sm" type="button"
            data-action="rating-add" data-id="${movie.id}">${icon("star")}<span>Оценить</span></button>
          <button class="icon-btn icon-btn--sm" type="button" data-action="watch-edit"
            data-id="${movie.id}" aria-label="Изменить дату">${icon("calendar")}</button>
          <button class="icon-btn icon-btn--sm icon-btn--danger" type="button"
            data-action="watch-remove" data-id="${movie.id}"
            aria-label="Вернуть в каталог">${icon("refresh")}</button>
        </div>
      </div>
    </article>`;
}

/* ------------------------------------------------------- История роллов */

function renderSessions(container, sessions) {
  const completed = [...sessions]
    .filter((session) => session.status === "completed")
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar__count">
        <p class="eyebrow">Архив кинорулетки</p>
        <h2>${completed.length}
          <small>${pluralize(completed.length, ["сессия", "сессии", "сессий"])}</small>
        </h2>
      </div>
      <div class="toolbar__actions">
        ${primaryAction("roll-configure", "Новый ролл", "wheel")}
      </div>
    </div>

    ${completed.length === 0 ? emptyBlock(
      "Завершённых роллов пока нет",
      "После первого победителя здесь появятся состав пула, журнал выбываний и использованные сейвы.",
      { action: "roll-configure", label: "Запустить колесо", icon: "wheel" },
    ) : `
      <div class="session-list">
        ${completed.map((session) => {
          const savesUsed = session.events.filter((event) => event.type === "save-used").length;
          return `
            <article class="session-card">
              <div class="session-card__medal">${icon("trophy")}</div>
              <div class="session-card__main">
                <p class="eyebrow">${escapeHtml(formatDateTime(session.completedAt))}</p>
                <h3>${escapeHtml(session.winner?.title ?? "Победитель не указан")}</h3>
                <div class="session-card__stats">
                  <span>${icon("target")}Старт: <b>${session.originalPool.length}</b></span>
                  <span>${icon("close")}Выбыли: <b>${session.eliminated.length}</b></span>
                  <span>${icon("shield")}Сейвы: <b>${savesUsed}</b></span>
                </div>
                <div class="session-card__players">
                  ${session.participants.map((participant) => `
                    <span class="pill pill--soft">${escapeHtml(participant.name)}
                      <b>${participant.savesRemaining}/${participant.savesInitial}</b></span>
                  `).join("")}
                </div>
              </div>
              <div class="session-card__actions">
                <button class="btn btn--ghost btn--sm" type="button"
                  data-action="session-repeat" data-id="${session.id}"
                  title="Собрать колесо из того же состава">
                  ${icon("refresh")}<span>Повторить пул</span>
                </button>
                <button class="btn btn--ghost btn--sm" type="button"
                  data-action="session-open" data-id="${session.id}">
                  Журнал ${icon("arrowRight")}
                </button>
              </div>
            </article>`;
        }).join("")}
      </div>
    `}
  `;
}

/* ---------------------------------------------------------------- Колесо */

function renderWheel(container, state) {
  if (!state.activeSession) {
    renderWheelSetup(container, state);
    return;
  }

  const session = state.activeSession;
  const pending = session.pendingIndex === null ? null : session.pool[session.pendingIndex];
  const total = session.originalPool.length;
  const progress = total ? Math.round((session.eliminated.length / (total - 1)) * 100) : 0;
  const savesLocked = session.pool.length <= session.savesEnabledAboveRemaining;

  container.innerHTML = `
    <div class="wheel-layout">
      <section class="wheel-stage ${state.isSpinning ? "is-spinning" : ""}">
        <div class="wheel-stage__glow" aria-hidden="true"></div>
        <div class="wheel-frame">
          <div class="wheel-pointer" aria-hidden="true"></div>
          <canvas id="wheel-canvas" width="620" height="620"
            aria-label="Колесо с участниками"></canvas>
        </div>

        <div class="wheel-status ${pending ? "is-pending" : ""}">
          ${pending ? `
            <p class="eyebrow eyebrow--danger">Кандидат на выбывание</p>
            <h2>${escapeHtml(pending.title)}</h2>
            <p class="muted">Подтвердите выбывание, потратьте сейв или перекрутите колесо.</p>
          ` : `
            <p class="eyebrow">В колесе осталось</p>
            <h2>${session.pool.length}
              <small>${pluralize(session.pool.length, ["участник", "участника", "участников"])}</small>
            </h2>
          `}
        </div>

        <div class="wheel-actions">
          ${pending ? `
            <button class="btn btn--glass btn--lg" type="button" data-action="roll-reroll">
              ${icon("refresh")}<span>Перекрутить</span>
            </button>
            <button class="btn btn--danger btn--lg" type="button" data-action="roll-confirm-elimination">
              ${icon("close")}<span>Подтвердить выбывание</span>
            </button>
          ` : `
            <button class="btn btn--primary btn--spin" type="button" data-action="roll-spin"
              ${state.isSpinning ? "disabled" : ""}>
              ${icon("wheel")}
              <span>${state.isSpinning ? "Колесо вращается…" : "Крутить"}</span>
              ${state.isSpinning ? "" : "<kbd>Space</kbd>"}
            </button>
          `}
        </div>

        <div class="wheel-progress">
          <span class="progress"><span style="--value:${progress}%"></span></span>
          <small>Выбыло ${session.eliminated.length} из ${Math.max(total - 1, 0)}</small>
        </div>
      </section>

      <aside class="wheel-side">
        <section class="panel">
          <header class="panel__head">
            <div>
              <p class="eyebrow">Сейвы</p>
              <h3>Игроки</h3>
            </div>
            <span class="pill pill--soft">${session.participants.length}</span>
          </header>
          <div class="save-list">
            ${session.participants.map((participant) => `
              <div class="save-list__row ${participant.savesRemaining <= 0 ? "is-empty" : ""}">
                <span class="save-list__avatar">${escapeHtml(initials(participant.name))}</span>
                <span class="save-list__name">
                  <strong>${escapeHtml(participant.name)}</strong>
                  <small>${participant.savesRemaining} из ${participant.savesInitial} сейвов</small>
                </span>
                ${pending ? `
                  <button class="btn btn--ghost btn--sm" type="button" data-action="roll-save"
                    data-id="${participant.id}"
                    ${participant.savesRemaining <= 0 || savesLocked ? "disabled" : ""}>
                    ${icon("shield")}<span>Спасти</span>
                  </button>` : ""}
              </div>
            `).join("")}
          </div>
          <p class="form-hint">${savesLocked
            ? `Сейвы отключены: осталось ${session.pool.length} участников.`
            : `Сейвы работают, пока участников больше ${session.savesEnabledAboveRemaining}.`}</p>
        </section>

        <section class="panel">
          <header class="panel__head">
            <div>
              <p class="eyebrow">Выбыли</p>
              <h3>Журнал</h3>
            </div>
            <span class="pill pill--soft">${session.eliminated.length}</span>
          </header>
          <div class="eliminated-list">
            ${session.eliminated.map((item) => `
              <div class="eliminated-list__row">
                <span>${escapeHtml(item.title)}</span>
                <button class="icon-btn icon-btn--sm" type="button" data-action="roll-restore"
                  data-id="${item.id}" data-entity-type="${item.type}"
                  aria-label="Вернуть в колесо">${icon("refresh")}</button>
              </div>
            `).join("") || '<p class="muted">Пока никто не выбыл.</p>'}
          </div>
        </section>
      </aside>
    </div>
  `;
}

function renderWheelSetup(container, state) {
  const quotaCategories = state.library.categories
    .filter((category) => category.rollQuota > 0)
    .sort(sortByPosition);
  const pool = state.rollDraftPool ?? [];
  const poolFilters = state.rollPoolFilters ?? { favoritesOnly: false, tag: "" };
  const poolTags = collectLibraryTags(
    state.library.movies.filter((movie) => !movie.watchedAt),
  );

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar__count">
        <p class="eyebrow">Подготовка сессии</p>
        <h2>${pool.length}
          <small>${pluralize(pool.length, ["участник", "участника", "участников"])} в пуле</small>
        </h2>
      </div>
      <div class="toolbar__actions">
        <div class="segmented" role="group" aria-label="Отбор в пул">
          <button type="button" class="${!poolFilters.favoritesOnly && !poolFilters.tag ? "is-active" : ""}"
            data-action="roll-filter-set" data-filter="all"
            aria-pressed="${!poolFilters.favoritesOnly && !poolFilters.tag}">Все</button>
          <button type="button" class="${poolFilters.favoritesOnly ? "is-active" : ""}"
            data-action="roll-filter-set" data-filter="favorites"
            aria-pressed="${Boolean(poolFilters.favoritesOnly)}">Избранное</button>
        </div>
        ${poolTags.length ? `
          <div class="select-field select-field--sm">
            ${icon("tag")}
            <select data-control="roll-tag" aria-label="Тег для пула">
              <option value="">Любой тег</option>
              ${poolTags.map(({ tag, count }) => `
                <option value="${escapeAttribute(tag)}"
                  ${poolFilters.tag === tag ? "selected" : ""}>${escapeHtml(tag)} · ${count}</option>
              `).join("")}
            </select>
            ${icon("chevronDown", "select-field__caret")}
          </div>` : ""}
        <button class="btn btn--ghost" type="button" data-action="roll-shuffle"
          ${pool.length < 2 ? "disabled" : ""}>
          ${icon("shuffle")}<span>Перемешать</span>
        </button>
        <button class="btn btn--primary" type="button" data-action="roll-configure"
          ${pool.length < 2 ? "disabled" : ""}>
          ${icon("play")}<span>Настроить и начать</span>
        </button>
      </div>
    </div>

    ${pool.length < 2 ? (poolFilters.favoritesOnly || poolFilters.tag
      ? emptyBlock(
        "Под этот отбор пула не хватает участников",
        "Снимите отбор по избранному или тегу — либо отметьте нужные фильмы, чтобы они попали в колесо.",
        { action: "roll-filter-set", label: "Показать все", icon: "refresh" },
      )
      : emptyBlock(
        "Пул пока не собран",
        "Задайте квоту колеса хотя бы одному списку и добавьте в него непросмотренные фильмы — участники подтянутся автоматически.",
        { action: "category-add", label: "Настроить списки", icon: "layers" },
      )) : `
      <div class="wheel-setup">
        <section class="wheel-preview">
          <div class="wheel-preview__glow" aria-hidden="true"></div>
          <div class="wheel-frame wheel-frame--preview">
            <div class="wheel-pointer" aria-hidden="true"></div>
            <canvas id="wheel-canvas" width="520" height="520"
              aria-label="Предварительный вид колеса"></canvas>
          </div>
          <p class="muted">Так будет выглядеть колесо. Порядок можно перемешать
          перед стартом.</p>
        </section>

        <div class="wheel-setup__side">
          <section class="panel">
            <header class="panel__head">
              <div>
                <p class="eyebrow">Состав</p>
                <h3>Участники</h3>
              </div>
              <span class="pill pill--soft">${pool.length}</span>
            </header>
            <ol class="pool-list">
              ${pool.map((item, index) => `
                <li>
                  <span class="pool-list__index">${index + 1}</span>
                  <span class="pool-list__title">${escapeHtml(item.title)}</span>
                  ${item.type === "franchise"
                    ? `<span class="pill pill--accent">${icon("collection")}Коллекция</span>`
                    : ""}
                </li>
              `).join("")}
            </ol>
          </section>

          <section class="panel">
            <header class="panel__head">
              <div>
                <p class="eyebrow">Источники</p>
                <h3>Квоты списков</h3>
              </div>
              <button class="icon-btn icon-btn--sm" type="button" data-view="categories"
                aria-label="Настроить списки">${icon("settings")}</button>
            </header>
            ${quotaCategories.length ? `
              <div class="quota-list">
                ${quotaCategories.map((category) => `
                  <div class="quota-list__row">
                    <span>${escapeHtml(category.name)}</span>
                    <b>${category.rollQuota}</b>
                  </div>
                `).join("")}
              </div>
            ` : '<p class="muted">Квоты ещё не настроены.</p>'}
          </section>
        </div>
      </div>
    `}
  `;
}

/* --------------------------------------------------------------- Списки */

function renderCategories(container, library) {
  const roots = library.categories.filter((category) => !category.parentId).sort(sortByPosition);
  const uncategorized = library.movies.filter((movie) => !movie.categoryId).length;

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar__count">
        <p class="eyebrow">Организация</p>
        <h2>${library.categories.length}
          <small>${pluralize(library.categories.length, ["список", "списка", "списков"])}</small>
        </h2>
      </div>
      <div class="toolbar__actions">
        <span class="pill">${icon("folder")}Без списка: <b>${uncategorized}</b></span>
        ${primaryAction("category-add", "Новый список", "plus")}
      </div>
    </div>

    ${roots.length === 0 ? emptyBlock(
      "Списков пока нет",
      "Списки задают структуру библиотеки и квоты для колеса. Жанры TMDB хранятся отдельно и на списки не влияют.",
      { action: "category-add", label: "Создать список", icon: "plus" },
    ) : `
      <div class="tree">
        ${roots.map((category) => categoryRows(category, library, 0)).join("")}
      </div>
    `}
  `;
}

// Дерево списков — плоский набор строк с отступом по глубине. Вложенные
// карточки внутри карточек читались хуже: рамка в рамке съедала ширину и
// прятала сам список за оформлением.
function categoryRows(category, library, depth) {
  const children = library.categories
    .filter((item) => item.parentId === category.id)
    .sort(sortByPosition);
  const queue = buildCategoryQueue(library, category.id);
  const subtreeCategoryIds = new Set([
    category.id,
    ...getDescendantIds(library.categories, category.id),
  ]);
  const subtreeMovies = library.movies.filter((movie) =>
    subtreeCategoryIds.has(movie.categoryId));
  const watchedCount = subtreeMovies.filter((movie) => movie.watchedAt).length;
  const progress = subtreeMovies.length
    ? Math.round((watchedCount / subtreeMovies.length) * 100)
    : 0;

  return `
    <div class="tree__row tree__row--list" style="--depth:${depth}">
      <span class="tree__mark">${icon(children.length ? "layers" : "folder")}</span>
      <span class="tree__name">${escapeHtml(category.name)}</span>
      <span class="tree__meta">
        ${category.rollQuota > 0
          ? `<span class="tree__quota" title="Квота колеса">${icon("wheel")}${category.rollQuota}</span>`
          : ""}
        ${subtreeMovies.length
          ? `<span>${subtreeMovies.length} ${pluralize(subtreeMovies.length, ["фильм", "фильма", "фильмов"])}</span>
             <span class="meter" title="Просмотрено ${watchedCount} из ${subtreeMovies.length}">
               <span class="meter__track"><span style="--value:${progress}%"></span></span>
             </span>`
          : `<span class="muted">пусто</span>`}
      </span>
      <span class="tree__tools">
        <button class="icon-btn icon-btn--sm" type="button" data-action="category-up"
          data-id="${category.id}" aria-label="Выше">${icon("arrowUp")}</button>
        <button class="icon-btn icon-btn--sm" type="button" data-action="category-down"
          data-id="${category.id}" aria-label="Ниже">${icon("arrowDown")}</button>
        <button class="icon-btn icon-btn--sm" type="button" data-action="category-child-add"
          data-id="${category.id}" aria-label="Вложенный список">${icon("plus")}</button>
        <button class="icon-btn icon-btn--sm" type="button" data-action="category-edit"
          data-id="${category.id}" aria-label="Редактировать">${icon("edit")}</button>
        <button class="icon-btn icon-btn--sm icon-btn--danger" type="button"
          data-action="category-delete" data-id="${category.id}"
          aria-label="Удалить">${icon("trash")}</button>
      </span>
    </div>

    ${queue.map((item, index) => `
      <div class="tree__row tree__row--movie" style="--depth:${depth + 1}">
        <span class="tree__index">${index + 1}</span>
        <span class="tree__name">${escapeHtml(item.title)}</span>
        <span class="tree__meta">
          ${item.type === "franchise"
            ? `<span class="tree__quota">${icon("collection")}коллекция</span>`
            : ""}
        </span>
        <span class="tree__tools">
          <button class="icon-btn icon-btn--sm" type="button" data-action="${item.type}-up"
            data-id="${item.id}" aria-label="Выше">${icon("arrowUp")}</button>
          <button class="icon-btn icon-btn--sm" type="button" data-action="${item.type}-down"
            data-id="${item.id}" aria-label="Ниже">${icon("arrowDown")}</button>
        </span>
      </div>
    `).join("")}

    ${children.map((child) => categoryRows(child, library, depth + 1)).join("")}`;
}

/* ------------------------------------------------------------ Коллекции */

function renderFranchises(container, library) {
  const movieById = new Map(library.movies.map((movie) => [movie.id, movie]));
  const categoryById = new Map(library.categories.map((item) => [item.id, item]));

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar__count">
        <p class="eyebrow">Циклы и саги</p>
        <h2>${library.franchises.length}
          <small>${pluralize(library.franchises.length, ["коллекция", "коллекции", "коллекций"])}</small>
        </h2>
      </div>
      <button class="btn btn--primary" type="button" data-action="franchise-add">
        ${icon("plus")}<span>Новая коллекция</span>
      </button>
    </div>

    ${library.franchises.length === 0 ? emptyBlock(
      "Коллекций пока нет",
      "Коллекция объединяет несколько фильмов и участвует в колесе как один объект — удобно для трилогий и сериалов-саг.",
      { action: "franchise-add", label: "Создать коллекцию", icon: "plus" },
    ) : `
      <div class="franchise-grid">
        ${library.franchises.map((franchise) => {
          const movies = franchise.movieIds.map((id) => movieById.get(id)).filter(Boolean);
          const watched = movies.filter((movie) => movie.watchedAt).length;
          const progress = movies.length ? Math.round((watched / movies.length) * 100) : 0;
          const cover = movies.find((movie) => movie.coverUrl)?.coverUrl;
          return `
            <article class="franchise-card">
              <div class="franchise-card__head">
                <span class="franchise-card__art">
                  ${cover
                    ? `<img src="${escapeAttribute(cover)}" alt="" loading="lazy"
                        referrerpolicy="no-referrer"
                        data-poster-fallback="${escapeAttribute(initials(franchise.name))}">`
                    : `<span class="poster-fallback">${escapeHtml(initials(franchise.name))}</span>`}
                </span>
                <div>
                  <p class="eyebrow">${escapeHtml(categoryById.get(franchise.categoryId)?.name ?? "Без списка")}</p>
                  <h3>${escapeHtml(franchise.name)}</h3>
                  <p class="muted">${movies.length}
                    ${pluralize(movies.length, ["фильм", "фильма", "фильмов"])} · просмотрено ${watched}</p>
                </div>
                <div class="row-actions">
                  <button class="icon-btn icon-btn--sm" type="button" data-action="franchise-edit"
                    data-id="${franchise.id}" aria-label="Редактировать">${icon("edit")}</button>
                  <button class="icon-btn icon-btn--sm icon-btn--danger" type="button"
                    data-action="franchise-delete" data-id="${franchise.id}"
                    aria-label="Удалить">${icon("trash")}</button>
                </div>
              </div>
              <span class="progress progress--thin"><span style="--value:${progress}%"></span></span>
              <ol class="franchise-movies">
                ${movies.map((movie) => `
                  <li class="${movie.watchedAt ? "is-watched" : ""}">
                    <span class="franchise-movies__marker">${icon(movie.watchedAt ? "check" : "play")}</span>
                    <button class="franchise-movies__title" type="button"
                      data-action="movie-open" data-id="${movie.id}">
                      ${escapeHtml(movie.title)}
                    </button>
                    <span class="queue-list__tools">
                      <button class="icon-btn icon-btn--sm" type="button"
                        data-action="franchise-member-up" data-id="${franchise.id}"
                        data-movie-id="${movie.id}" aria-label="Выше">${icon("arrowUp")}</button>
                      <button class="icon-btn icon-btn--sm" type="button"
                        data-action="franchise-member-down" data-id="${franchise.id}"
                        data-movie-id="${movie.id}" aria-label="Ниже">${icon("arrowDown")}</button>
                    </span>
                  </li>
                `).join("") || '<li class="muted">Фильмы ещё не добавлены</li>'}
              </ol>
            </article>`;
        }).join("")}
      </div>
    `}
  `;
}

/* ------------------------------------------------------------ Настройки */

/* ------------------------------------------------------------- Статистика */

function renderInsights(container, library) {
  const insights = buildInsights(library);
  const totalMovies = library.movies.length;

  if (totalMovies === 0) {
    container.innerHTML = emptyBlock(
      "Статистика появится с первым фильмом",
      "Здесь будут десятилетия, жанры, страны, темп просмотра и подсказки, что посмотреть дальше.",
      { action: "movie-add", label: "Добавить фильм", icon: "plus" },
    );
    return;
  }

  const maxPace = Math.max(1, ...insights.watchPace.map((bucket) => bucket.count));
  const paceMovies = insights.watchPace.reduce((sum, bucket) => sum + bucket.count, 0);
  const paceMinutes = insights.watchPace.reduce((sum, bucket) => sum + bucket.minutes, 0);
  const statusOrder = [
    [MOVIE_STATUS.queued, MOVIE_STATUS_LABELS.queued],
    [MOVIE_STATUS.watching, MOVIE_STATUS_LABELS.watching],
    [MOVIE_STATUS.watched, MOVIE_STATUS_LABELS.watched],
    [MOVIE_STATUS.dropped, MOVIE_STATUS_LABELS.dropped],
  ];

  container.innerHTML = `
    <section class="panel panel--wide">
      <header class="panel__head">
        <div>
          <p class="eyebrow">Состояние библиотеки</p>
          <h3>Где сейчас ${totalMovies} ${pluralize(totalMovies, ["фильм", "фильма", "фильмов"])}</h3>
        </div>
      </header>
      <div class="status-split">
        ${statusOrder.map(([status, label]) => {
          const count = insights.statusBreakdown[status];
          const share = totalMovies ? Math.round((count / totalMovies) * 100) : 0;
          return `
            <button class="status-split__item" type="button"
              data-action="catalog-status-open" data-status="${status}"
              ${count ? "" : "disabled"}>
              <span class="status-split__bar status-split__bar--${status}"
                style="--value:${share}%"></span>
              <strong>${count}</strong>
              <small>${escapeHtml(label)} · ${share}%</small>
            </button>`;
        }).join("")}
      </div>
    </section>

    <section class="insight-grid">
      <article class="panel panel--chart">
        <p class="eyebrow">Темп просмотра</p>
        <h3>Последние 12 месяцев</h3>
        ${paceMovies ? `
          <div class="pace-chart">
            ${insights.watchPace.map((bucket) => `
              <div class="pace-chart__column">
                <span class="pace-chart__bar"
                  style="--value:${Math.round((bucket.count / maxPace) * 100)}"
                  title="${bucket.count} ${pluralize(bucket.count, ["фильм", "фильма", "фильмов"])}"></span>
                <small>${MONTH_SHORT[bucket.month - 1]}</small>
              </div>
            `).join("")}
          </div>
          <p class="form-hint">За год: ${paceMovies}
            ${pluralize(paceMovies, ["фильм", "фильма", "фильмов"])},
            ${formatWatchedHours(paceMinutes)} ч экранного времени.</p>
        ` : `<p class="muted">Отметьте фильмы просмотренными — и здесь появится ритм года.</p>`}
      </article>

      <article class="panel panel--chart">
        <p class="eyebrow">Эпохи</p>
        <h3>Десятилетия</h3>
        ${insights.decades.length
          ? barList(insights.decades.map((entry) => [`${entry.decade}-е`, entry.count]))
          : `<p class="muted">Заполните год выпуска, чтобы увидеть эпохи.</p>`}
      </article>

      <article class="panel panel--chart">
        <p class="eyebrow">Жанры</p>
        <h3>Чего в библиотеке больше</h3>
        ${insights.genres.length ? barList(
          insights.genres.slice(0, 8).map((entry) => [
            entry.averageRating === null
              ? entry.genre
              : `${entry.genre} · ${entry.averageRating}`,
            entry.count,
          ]),
        ) : `<p class="muted">Жанры подтянутся из TMDB или заполняются вручную.</p>`}
      </article>

      <article class="panel panel--chart">
        <p class="eyebrow">География</p>
        <h3>Страны</h3>
        ${insights.countries.length
          ? barList(insights.countries.slice(0, 8).map((entry) => [entry.country, entry.count]))
          : `<p class="muted">Заполните страну, чтобы увидеть географию коллекции.</p>`}
      </article>
    </section>

    <section class="insight-grid">
      <article class="panel">
        <header class="panel__head">
          <div>
            <p class="eyebrow">Профиль вкуса</p>
            <h3>Жанры, которые вы оцениваете выше</h3>
          </div>
        </header>
        ${insights.tasteProfile.length ? `
          <div class="taste-list">
            ${insights.tasteProfile.map((entry) => `
              <div class="taste-list__row">
                <span class="taste-list__name">${escapeHtml(entry.genre)}</span>
                <span class="meter"><span style="--value:${entry.averageRating * 10}%"></span></span>
                <strong>${entry.averageRating}</strong>
                <small>${entry.ratedCount} ${pluralize(entry.ratedCount, ["оценка", "оценки", "оценок"])}</small>
              </div>
            `).join("")}
          </div>
        ` : `<p class="muted">Нужно минимум по две оценки в жанре — тогда вкус
          можно считать, а не угадывать.</p>`}
      </article>

      <article class="panel">
        <header class="panel__head">
          <div>
            <p class="eyebrow">Что посмотреть</p>
            <h3>Из очереди — под ваш вкус</h3>
          </div>
        </header>
        ${insights.recommendations.length ? `
          <div class="enrich-list">
            ${insights.recommendations.map(({ movie, reason }) => `
              <div class="enrich-list__row">
                <span>
                  <strong>${escapeHtml(movie.title)}</strong>
                  <small>${escapeHtml(reason ?? "по вашим оценкам")}${
                    movie.releaseYear ? ` · ${movie.releaseYear}` : ""}</small>
                </span>
                <button class="btn btn--ghost btn--sm" type="button"
                  data-action="movie-open" data-id="${movie.id}">Открыть</button>
              </div>
            `).join("")}
          </div>
        ` : `<p class="muted">Подсказки появятся, когда в библиотеке будут оценки
          и непросмотренные фильмы тех же жанров.</p>`}
      </article>
    </section>
  `;
}

const MONTH_SHORT = Object.freeze([
  "янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
]);

function barList(entries) {
  const max = Math.max(1, ...entries.map(([, value]) => value));
  return `
    <ul class="bar-list">
      ${entries.map(([label, value]) => `
        <li>
          <span class="bar-list__label">${escapeHtml(label)}</span>
          <span class="bar-list__track">
            <span class="bar-list__fill" style="--value:${Math.round((value / max) * 100)}%"></span>
          </span>
          <span class="bar-list__value">${value}</span>
        </li>
      `).join("")}
    </ul>`;
}

function renderSettings(container, state) {
  const tmdb = state.tmdbStatus;
  const settings = state.library.settings ?? {};
  const enrichmentCount = selectEnrichmentCandidates(state.library.movies).length;
  const autoBackupDays = Number(settings.autoBackupDays ?? 0);
  const localBackup = state.localBackup ?? { files: [], directory: "", error: null };
  // Зритель — это аккаунт: свой профиль и принятые друзья. Строки из старого
  // локального списка игроков остаются только как след прежнего ручного ввода.
  const viewers = buildViewers(state.account, state.friends?.rows);
  const legacyParticipants = state.library.participants ?? [];

  container.innerHTML = `
    <div class="settings">

      ${settingsGroup({
        title: "Интеграция с TMDB",
        status: `<span class="status-pill ${tmdb.configured ? "status-pill--ok" : ""}">
          <i></i>${tmdb.loading ? "проверка" : tmdb.configured ? "подключено" : "не подключено"}
        </span>`,
        rows: [
          settingsRow({
            title: "API Read Access Token",
            hint: "Хранится отдельно от библиотеки и не попадает в резервную копию.",
            control: tmdb.configured
              ? `${smallButton("tmdb-configure", "Заменить")}
                 ${smallButton("tmdb-clear", "Удалить", { danger: true })}`
              : smallButton("tmdb-configure", "Подключить"),
          }),
          settingsRow({
            title: "Обогащение метаданными",
            hint: tmdb.configured
              ? enrichmentCount
                ? `${enrichmentCount} ${pluralize(enrichmentCount, ["карточка", "карточки", "карточек"])} без части полей: год, страна, жанры, описание, постер.`
                : "Все карточки заполнены."
              : "Доступно после подключения токена.",
            control: tmdb.configured
              ? smallButton(
                  "tmdb-enrich",
                  enrichmentCount ? `Обогатить ${enrichmentCount}` : "Нечего обогащать",
                  { disabled: !enrichmentCount },
                )
              : `<span class="set-value">—</span>`,
          }),
          tmdb.error ? `<p class="set-alert" role="alert">${escapeHtml(tmdb.error)}</p>` : "",
        ],
        note: `<span class="set-attribution">
            <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer"
              aria-label="The Movie Database"><img src="./assets/tmdb.svg" alt="TMDB"></a>
            <span>This product uses the TMDB API but is not endorsed or certified by TMDB.</span>
          </span>`,
      })}

      ${settingsGroup({
        title: "Поведение",
        rows: [
          settingsRow({
            title: "Звук колеса",
            hint: "Щелчки при вращении и аккорд в конце.",
            control: toggleControl("setting-sound", settings.soundEnabled !== false),
          }),
          settingsRow({
            title: "Меньше движения",
            hint: "Отключает анимации появления и вращение колеса.",
            control: toggleControl("setting-reduced-motion", settings.reducedMotion === true),
          }),
          settingsRow({
            title: "Порог сейвов",
            hint: "Сейвы работают, пока участников в сессии больше этого числа.",
            control: numberControl(
              "setting-save-threshold",
              settings.savesEnabledAboveRemaining ?? 3,
              1,
              99,
            ),
          }),
          settingsRow({
            title: "Напоминание о копии",
            hint: "Через сколько дней без резервной копии показать напоминание.",
            control: numberControl(
              "setting-backup-days",
              settings.backupReminderDays ?? 30,
              1,
              365,
              "дней",
            ),
          }),
        ],
      })}

      ${settingsGroup({
        title: "Данные",
        rows: [
          settingsRow({
            title: "Резервная копия",
            hint: "Фильмы, списки, коллекции, оценки, игроки и история роллов одним файлом.",
            control: `${smallButton("backup-export", "Скачать JSON")}
              ${fileControl("backup-import", "Загрузить JSON", ".json,application/json")}`,
          }),
          settingsRow({
            title: "Выгрузка в CSV",
            hint: "Удобно открыть в таблице; восстановить библиотеку целиком можно только из JSON.",
            control: smallButton("csv-export", "Выгрузить"),
          }),
          settingsRow({
            title: "Импорт таблицы",
            hint: "CSV, TSV и XLSX. Столбцы: «Название», «Список», «Франшиза», «Год», «Длительность», «Страна», «Просмотрено», «Дата просмотра», «Оценка Имя».",
            control: fileControl("table-import", "Выбрать файл", ".csv,.tsv,.xlsx,text/csv"),
          }),
          settingsRow({
            title: "Копия на диск по расписанию",
            hint: "CineVault держит последние пять копий рядом с приложением.",
            control: `${autoBackupDays > 0
              ? numberControl("setting-auto-backup-days", autoBackupDays, 1, 90, "дней")
              : ""}
              ${toggleControl("setting-auto-backup", autoBackupDays > 0)}`,
          }),
          settingsRow({
            title: "Копия прямо сейчас",
            hint: localBackup.error
              ? `Лаунчер недоступен: ${escapeHtml(localBackup.error)}`
              : localBackup.directory
                ? `Папка: <code>${escapeHtml(localBackup.directory)}</code>`
                : "Копия сохраняется через лаунчер CineVault.",
            control: smallButton("local-backup-now", "Сохранить"),
          }),
          localBackup.files.length ? `
            <div class="set-table">
              ${localBackup.files.map((file) => `
                <div>
                  <span>${escapeHtml(formatDateTime(file.savedAt))}</span>
                  <b>${Math.max(1, Math.round(file.size / 1024))} КБ</b>
                </div>`).join("")}
            </div>` : "",
          settingsRow({
            title: "Перенос из Movie Manager V13",
            hint: state.legacyDataFound
              ? "Найдены старые данные. Миграция объединит их с текущей библиотекой и ничего не удалит."
              : "Старая база в этом браузере не найдена.",
            control: smallButton("legacy-migrate", "Перенести", {
              disabled: !state.legacyDataFound,
            }),
          }),
        ],
      })}

      ${settingsGroup({
        title: "Зрители",
        status: `<span class="set-value">${viewers.length}</span>`,
        rows: [
          `<div class="set-block">
            <div class="participant-tags">
              ${viewers.map((viewer) => `
                <span class="participant-tag">
                  <i>${escapeHtml(initials(viewer.name))}</i>
                  ${escapeHtml(viewer.name)}
                  <small>${viewer.isSelf ? "вы" : `@${escapeHtml(viewer.handle)}`}</small>
                </span>
              `).join("")}
            </div>
          </div>`,
          settingsRow({
            title: "Кто может оценивать и играть",
            hint: "Вы и принятые друзья. Имена берутся из аккаунтов, руками их не вводят.",
            control: smallButton("friends-open", "Друзья"),
          }),
          legacyParticipants.length
            ? settingsRow({
                title: "Имена из старых сессий",
                hint: `${legacyParticipants.map((participant) => escapeHtml(participant.name)).join(", ")}
                  — остались от версии с ручным вводом. В истории и оценках они
                  сохраняются, новые оценки на них поставить нельзя.`,
                control: smallButton("participants-forget", "Забыть", { danger: true }),
              })
            : "",
        ],
      })}

      ${settingsGroup({
        title: "Хранилище",
        status: `<span class="set-value">схема v3</span>`,
        rows: [`
          <div class="set-kv">
            ${[
              ["Фильмов", state.library.movies.length],
              ["Списков", state.library.categories.length],
              ["Коллекций", state.library.franchises.length],
              ["Сессий", state.library.rollSessions.length],
              ["Версия", APP_VERSION],
              ["Последняя копия", settings.lastBackupAt
                ? formatDateTime(settings.lastBackupAt)
                : "не создавалась"],
            ].map(([label, value]) => `
              <div><span>${escapeHtml(label)}</span><b>${escapeHtml(String(value))}</b></div>
            `).join("")}
          </div>`],
        note: "Библиотека сохраняется автоматически при каждом изменении и принадлежит вашему аккаунту.",
      })}

    </div>
  `;
}

function fileControl(control, label, accept) {
  return `
    <label class="btn btn--ghost btn--sm file-btn">
      ${escapeHtml(label)}
      <input type="file" accept="${accept}" data-control="${control}">
    </label>`;
}

function numberControl(control, value, min, max, suffix = "") {
  return `
    <span class="set-number">
      <input type="number" min="${min}" max="${max}" data-control="${control}"
        value="${Number(value)}">
      ${suffix ? `<small>${escapeHtml(suffix)}</small>` : ""}
    </span>`;
}

/* -------------------------------------------------------------- Хелперы */

function emptyBlock(title, text, action = null) {
  return `
    <section class="empty">
      <div class="empty__art" aria-hidden="true">
        <span class="empty__ring"></span>
        <span class="empty__glyph">${icon("sparkles")}</span>
      </div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(text)}</p>
      ${action ? `
        <button class="btn btn--primary" type="button" data-action="${action.action}">
          ${icon(action.icon ?? "plus")}<span>${escapeHtml(action.label)}</span>
        </button>` : ""}
    </section>`;
}

function pickHeroMovie(movies) {
  const sorted = [...movies].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt)));
  return sorted.find((movie) => movie.coverUrl && !movie.watchedAt)
    ?? sorted.find((movie) => movie.coverUrl)
    ?? sorted[0]
    ?? null;
}

function getTopGenres(movies, limit) {
  const counts = new Map();
  for (const movie of movies) {
    for (const genre of movie.genres ?? []) {
      if (!genre) continue;
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function formatWatchedHours(minutes) {
  return (Math.round(((Number(minutes) || 0) / 60) * 10) / 10)
    .toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function formatRating(value) {
  return value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function sortByPosition(a, b) {
  return a.position - b.position || a.name.localeCompare(b.name, "ru-RU");
}

function getDescendantIds(categories, categoryId) {
  const result = [];
  const visit = (parentId) => {
    for (const category of categories) {
      if (category.parentId === parentId) {
        result.push(category.id);
        visit(category.id);
      }
    }
  };
  visit(categoryId);
  return result;
}

function pluralize(number, forms) {
  const mod100 = number % 100;
  const mod10 = number % 10;
  if (mod100 >= 11 && mod100 <= 19) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return "Дата не указана";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

// Постер, который не загрузился, заменяется инициалами — этим занимается
// общий перехватчик в main.js. Здесь остаётся всё остальное: у оформления
// (фоны, логотипы, кадры витрины) подпись «CV» была бы мусором, поэтому
// декоративная картинка просто убирается, а осмысленная показывает alt.
function setupImageFallbacks(root) {
  root.querySelectorAll("img:not([data-poster-fallback])").forEach((image) => {
    image.addEventListener("error", () => {
      if (image.alt === "") image.hidden = true;
    }, { once: true });
  });
}
