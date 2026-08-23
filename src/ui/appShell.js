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
  filterCatalogMovies,
  getMovieStatus,
} from "../domain/catalogQuery.js";
import { buildInsights } from "../domain/insights.js";
import { icon } from "./icons.js";

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
  ["Система", [
    ["settings", "Настройки", "settings"],
  ]],
];

const NAV_ITEMS = [DASHBOARD_ITEM, ...NAV_GROUPS.flatMap(([, items]) => items)];

const VIEW_META = Object.freeze({
  dashboard: { title: "Моя библиотека", eyebrow: "Обзор коллекции" },
  catalog: { title: "Каталог", eyebrow: "Все фильмы" },
  franchises: { title: "Коллекции", eyebrow: "Франшизы и циклы" },
  categories: { title: "Списки", eyebrow: "Структура и очереди" },
  watched: { title: "Просмотренные", eyebrow: "История и оценки" },
  wheel: { title: "Колесо", eyebrow: "Батл-рояль" },
  sessions: { title: "История роллов", eyebrow: "Завершённые сессии" },
  insights: { title: "Статистика", eyebrow: "Библиотека в цифрах" },
  settings: { title: "Настройки", eyebrow: "Данные и интеграции" },
});

const MOBILE_VIEWS = ["dashboard", "catalog", "wheel", "watched"];

let previousView = null;

export function renderAppShell(root, state) {
  const collapsed = Boolean(state.sidebarCollapsed);
  const counts = getNavCounts(state);
  const viewChanged = previousView !== state.view;
  previousView = state.view;

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

        <div class="sidebar__bottom">
          <div class="theme-switch" role="group" aria-label="Тема оформления">
            <button type="button" class="${state.theme === "light" ? "is-active" : ""}"
              data-action="theme-set" data-theme="light"
              aria-pressed="${state.theme === "light"}">
              ${icon("sun")}<span>Светлая</span>
            </button>
            <button type="button" class="${state.theme === "dark" ? "is-active" : ""}"
              data-action="theme-set" data-theme="dark"
              aria-pressed="${state.theme === "dark"}">
              ${icon("moon")}<span>Тёмная</span>
            </button>
          </div>
          <div class="storage-chip ${state.error ? "is-error" : ""}">
            <span class="storage-chip__icon">${icon(state.error ? "warning" : "shield")}</span>
            <span class="storage-chip__text">
              <strong>${state.error ? "Хранилище недоступно" : "Данные на устройстве"}</strong>
              <small>CineVault ${escapeHtml(APP_VERSION)}</small>
            </span>
          </div>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <div class="topbar__lead">
            <button class="icon-btn topbar__menu" type="button"
              data-action="sidebar-toggle" aria-label="Меню">${icon("more")}</button>
            <div class="topbar__titles">
              <p class="eyebrow">${escapeHtml(getViewMeta(state.view).eyebrow)}</p>
              <h1>${escapeHtml(getViewMeta(state.view).title)}</h1>
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
            ${renderPrimaryAction(state)}
          </div>
        </header>

        <div class="content-scroll">
          <section class="content ${viewChanged ? "is-entering" : ""}" id="view-content"></section>
        </div>
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

      ${renderMovieDetail(state)}

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
  bindEvents(root, state);

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
  setupScrollShadow(root);
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

function setupScrollShadow(root) {
  const scroller = root.querySelector(".content-scroll");
  const topbar = root.querySelector(".topbar");
  if (!scroller || !topbar) return;
  const update = () => topbar.classList.toggle("is-stuck", scroller.scrollTop > 8);
  scroller.addEventListener("scroll", update, { passive: true });
  update();
}

function renderPrimaryAction(state) {
  const actions = {
    dashboard: ["movie-add", "Добавить фильм", "plus"],
    catalog: ["movie-add", "Добавить фильм", "plus"],
    watched: ["movie-add", "Добавить фильм", "plus"],
    sessions: ["roll-configure", "Новый ролл", "wheel"],
  };
  const action = actions[state.view];
  if (!action) return "";
  const [id, label, iconName] = action;
  return `
    <button class="btn btn--primary topbar__cta" type="button" data-action="${id}">
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
          <h2>Не удалось открыть локальную базу</h2>
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
    settings: renderSettings,
  };

  (views[state.view] ?? renderDashboard)(container, state);
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
  const nextUp = library.movies
    .filter((movie) => !movie.watchedAt)
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
            <button class="btn btn--primary btn--lg" type="button" data-view="wheel">
              ${icon("wheel")}<span>Запустить колесо</span>
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
          <p>Библиотека живёт локально в браузере. Скачайте JSON сейчас или
          отложите напоминание на ${library.settings.backupReminderDays ?? 30} дней.</p>
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

/* -------------------------------------------------- Карточка фильма (drawer) */

function renderMovieDetail(state) {
  const movie = state.library?.movies?.find((item) => item.id === state.detailMovieId);
  if (!movie) return "";

  const category = state.library.categories.find((item) => item.id === movie.categoryId);
  const franchise = getMovieFranchiseMap(state.library.franchises).get(movie.id);
  const rating = calculateAverageRating(movie.ratings);

  return `
    <div class="drawer">
      <div class="drawer__scrim" data-action="detail-close"></div>
      <aside class="drawer__panel" role="dialog" aria-modal="true"
        aria-label="${escapeAttribute(movie.title)}">
        <div class="drawer__hero">
          ${movie.coverUrl
            ? `<img class="drawer__hero-bg" src="${escapeAttribute(movie.coverUrl)}" alt=""
                referrerpolicy="no-referrer"
                data-poster-fallback="">`
            : ""}
          <button class="icon-btn drawer__close" type="button" data-action="detail-close"
            aria-label="Закрыть">${icon("close")}</button>
          <div class="drawer__hero-poster">
            ${movie.coverUrl
              ? `<img src="${escapeAttribute(movie.coverUrl)}"
                  alt="Постер: ${escapeAttribute(movie.title)}" referrerpolicy="no-referrer"
                  data-poster-fallback="${escapeAttribute(initials(movie.title))}">`
              : `<span class="poster-fallback">${escapeHtml(initials(movie.title))}</span>`}
          </div>
        </div>

        <div class="drawer__body">
          <p class="eyebrow">${escapeHtml(category?.name ?? "Без списка")}</p>
          <h2>${escapeHtml(movie.title)}</h2>
          ${movie.originalTitle
            ? `<p class="drawer__original">${escapeHtml(movie.originalTitle)}</p>`
            : ""}

          <div class="chip-row">
            ${movie.releaseYear ? `<span class="chip">${icon("calendar")}${movie.releaseYear}</span>` : ""}
            ${movie.durationMinutes ? `<span class="chip">${icon("clock")}${movie.durationMinutes} мин</span>` : ""}
            ${movie.country ? `<span class="chip">${icon("globe")}${escapeHtml(movie.country)}</span>` : ""}
            ${franchise ? `<span class="chip chip--accent">${icon("collection")}${escapeHtml(franchise.name)}</span>` : ""}
            <span class="chip ${movie.watchedAt ? "chip--success" : ""}">
              ${icon(STATUS_ICONS[getMovieStatus(movie)])}
              ${movie.watchedAt
                ? `Просмотрен ${formatDate(movie.watchedAt)}`
                : escapeHtml(MOVIE_STATUS_LABELS[getMovieStatus(movie)])}
            </span>
          </div>

          ${(movie.genres ?? []).length ? `
            <div class="chip-row chip-row--soft">
              ${movie.genres.map((genre) => `<span class="chip chip--soft">${escapeHtml(genre)}</span>`).join("")}
            </div>
          ` : ""}

          ${movie.overview
            ? `<p class="drawer__overview">${escapeHtml(movie.overview)}</p>`
            : `<p class="muted">Описание не заполнено.</p>`}

          ${(movie.tags ?? []).length ? `
            <div class="chip-row chip-row--soft">
              ${movie.tags.map((tag) => `
                <button class="chip chip--tag" type="button"
                  data-action="catalog-tag-open" data-tag="${escapeAttribute(tag)}"
                  title="Показать все фильмы с тегом">${icon("tag")}${escapeHtml(tag)}</button>
              `).join("")}
            </div>
          ` : ""}

          ${movie.notes ? `
            <section class="drawer__notes">
              <h3>${icon("note")}Заметка</h3>
              <p>${escapeHtml(movie.notes)}</p>
            </section>
          ` : ""}

          <section class="drawer__ratings">
            <header>
              <h3>Оценки</h3>
              <strong class="score ${rating === null ? "is-empty" : ""}">
                ${rating === null ? "—" : `${icon("star")}${rating}`}
              </strong>
            </header>
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

          ${movie.watchedAt ? "" : `
            <div class="status-switch" role="group" aria-label="Статус фильма">
              ${[MOVIE_STATUS.queued, MOVIE_STATUS.watching, MOVIE_STATUS.dropped].map((status) => `
                <button type="button" class="${getMovieStatus(movie) === status ? "is-active" : ""}"
                  data-action="movie-status-set" data-id="${movie.id}" data-status="${status}"
                  aria-pressed="${getMovieStatus(movie) === status}">
                  ${icon(STATUS_ICONS[status])}<span>${escapeHtml(MOVIE_STATUS_LABELS[status])}</span>
                </button>
              `).join("")}
            </div>`}

          <div class="drawer__actions">
            <button class="btn btn--primary" type="button"
              data-action="${movie.watchedAt ? "rating-add" : "watch-add"}" data-id="${movie.id}">
              ${icon(movie.watchedAt ? "star" : "check")}
              <span>${movie.watchedAt ? "Поставить оценку" : "Отметить просмотренным"}</span>
            </button>
            <button class="btn btn--ghost ${movie.isFavorite ? "is-favorite" : ""}" type="button"
              data-action="movie-favorite-toggle" data-id="${movie.id}"
              aria-pressed="${Boolean(movie.isFavorite)}">
              ${icon(movie.isFavorite ? "starFilled" : "star")}
              <span>${movie.isFavorite ? "В избранном" : "В избранное"}</span>
            </button>
            <button class="btn btn--ghost" type="button" data-action="movie-edit" data-id="${movie.id}">
              ${icon("edit")}<span>Редактировать</span>
            </button>
            ${movie.watchedAt ? `
              <button class="btn btn--ghost" type="button" data-action="watch-remove" data-id="${movie.id}">
                ${icon("refresh")}<span>Вернуть в очередь</span>
              </button>
            ` : ""}
            <button class="btn btn--danger-ghost" type="button" data-action="movie-delete" data-id="${movie.id}">
              ${icon("trash")}<span>Удалить</span>
            </button>
          </div>
        </div>
      </aside>
    </div>`;
}

/* --------------------------------------------------------------- Каталог */

function renderCatalog(container, state) {
  const { library, catalogFilters } = state;
  const viewMode = state.catalogView === "list" ? "list" : "grid";
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
        <div class="segmented segmented--icons" role="group" aria-label="Вид">
          <button type="button" class="${viewMode === "grid" ? "is-active" : ""}"
            data-action="catalog-view" data-mode="grid" aria-label="Плитка"
            aria-pressed="${viewMode === "grid"}">${icon("grid")}</button>
          <button type="button" class="${viewMode === "list" ? "is-active" : ""}"
            data-action="catalog-view" data-mode="list" aria-label="Список"
            aria-pressed="${viewMode === "list"}">${icon("list")}</button>
        </div>
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
          <option value="title" ${catalogFilters.sort === "title" ? "selected" : ""}>По названию</option>
          <option value="year" ${catalogFilters.sort === "year" ? "selected" : ""}>По году</option>
          <option value="rating" ${catalogFilters.sort === "rating" ? "selected" : ""}>По рейтингу</option>
          <option value="queue" ${catalogFilters.sort === "queue" ? "selected" : ""}>По очереди</option>
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
    ) : viewMode === "grid" ? `
      <div class="movie-grid ${selection ? "is-selecting" : ""}">
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
        <div class="movie-card__gradient"></div>
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
        <button class="btn btn--primary" type="button" data-action="category-add">
          ${icon("plus")}<span>Новый список</span>
        </button>
      </div>
    </div>

    ${roots.length === 0 ? emptyBlock(
      "Списков пока нет",
      "Списки задают структуру библиотеки и квоты для колеса. Жанры TMDB хранятся отдельно и на списки не влияют.",
      { action: "category-add", label: "Создать список", icon: "plus" },
    ) : `
      <div class="category-tree">
        ${roots.map((category) => categoryNode(category, library, 0)).join("")}
      </div>
    `}
  `;
}

function categoryNode(category, library, depth) {
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
    <section class="category-node" style="--depth:${depth}">
      <header class="category-node__head">
        <div class="category-node__title">
          <span class="category-node__icon">${icon(depth ? "chevronRight" : "layers")}</span>
          <div>
            <h3>${escapeHtml(category.name)}</h3>
            <p class="category-node__meta">
              <span class="pill pill--soft">${icon("wheel")}Квота: <b>${category.rollQuota}</b></span>
              <span>${subtreeMovies.length} ${pluralize(subtreeMovies.length, ["фильм", "фильма", "фильмов"])}</span>
              ${subtreeMovies.length ? `
                <span class="meter" title="Просмотрено ${watchedCount} из ${subtreeMovies.length}">
                  <span class="meter__track"><span style="--value:${progress}%"></span></span>
                  <b>${progress}%</b>
                </span>` : ""}
            </p>
          </div>
        </div>
        <div class="row-actions">
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
        </div>
      </header>

      ${queue.length ? `
        <ol class="queue-list">
          ${queue.map((item, index) => `
            <li>
              <span class="queue-list__index">${index + 1}</span>
              <span class="queue-list__title">
                ${escapeHtml(item.title)}
                ${item.type === "franchise"
                  ? `<span class="pill pill--accent">${icon("collection")}Коллекция</span>`
                  : ""}
              </span>
              <span class="queue-list__tools">
                <button class="icon-btn icon-btn--sm" type="button" data-action="${item.type}-up"
                  data-id="${item.id}" aria-label="Выше">${icon("arrowUp")}</button>
                <button class="icon-btn icon-btn--sm" type="button" data-action="${item.type}-down"
                  data-id="${item.id}" aria-label="Ниже">${icon("arrowDown")}</button>
              </span>
            </li>
          `).join("")}
        </ol>
      ` : '<p class="muted category-node__empty">В списке пока нет непросмотренных фильмов.</p>'}

      ${children.length ? `
        <div class="category-node__children">
          ${children.map((child) => categoryNode(child, library, depth + 1)).join("")}
        </div>` : ""}
    </section>`;
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

  container.innerHTML = `
    <div class="settings-grid">
      <section class="panel panel--wide ${tmdb.configured ? "panel--ok" : ""}">
        <header class="panel__head">
          <div class="panel__lead">
            <span class="panel__glyph">${icon("bolt")}</span>
            <div>
              <p class="eyebrow">Каталог фильмов</p>
              <h3>Интеграция с TMDB</h3>
            </div>
          </div>
          <span class="status-pill ${tmdb.configured ? "status-pill--ok" : ""}">
            <i></i>${tmdb.loading ? "Проверка…" : tmdb.configured ? "Подключён" : "Не подключён"}
          </span>
        </header>
        <p>${tmdb.configured
          ? "Поиск доступен в форме добавления фильма: название, год, длительность, страна, жанры, описание и постер заполняются автоматически, а постеры кэшируются локально."
          : "Подключите API Read Access Token, чтобы искать фильмы по названию и сохранять постеры на этом компьютере."}</p>
        ${tmdb.error ? `<p class="form-error is-visible">${escapeHtml(tmdb.error)}</p>` : ""}
        ${tmdb.configured && enrichmentCount ? `
          <p class="notice">
            ${icon("info")}
            <span>${enrichmentCount} ${pluralize(enrichmentCount, ["фильм", "фильма", "фильмов"])}
            без карточки TMDB или без части метаданных: постеры, жанры и описания
            можно подтянуть одним проходом.</span>
          </p>` : ""}
        <div class="panel__actions">
          ${tmdb.configured ? `
            <button class="btn btn--primary" type="button" data-action="tmdb-enrich"
              ${enrichmentCount ? "" : "disabled"}>
              ${icon("sparkles")}<span>${enrichmentCount
                ? `Обогатить ${enrichmentCount}`
                : "Всё уже обогащено"}</span>
            </button>` : ""}
          <button class="btn ${tmdb.configured ? "btn--ghost" : "btn--primary"}" type="button"
            data-action="tmdb-configure">
            ${icon("bolt")}<span>${tmdb.configured ? "Заменить токен" : "Подключить TMDB"}</span>
          </button>
          ${tmdb.configured ? `
            <button class="btn btn--ghost" type="button" data-action="tmdb-clear">
              ${icon("trash")}<span>Удалить токен</span>
            </button>` : ""}
        </div>
        <div class="attribution">
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer"
            aria-label="The Movie Database">
            <img src="./assets/tmdb.svg" alt="The Movie Database (TMDB)">
          </a>
          <small>This product uses the TMDB API but is not endorsed or certified by TMDB.</small>
        </div>
      </section>

      <section class="panel">
        <header class="panel__head">
          <div class="panel__lead">
            <span class="panel__glyph">${icon("settings")}</span>
            <div>
              <p class="eyebrow">Поведение приложения</p>
              <h3>Звук, движение и сейвы</h3>
            </div>
          </div>
        </header>
        <div class="preferences">
          <label class="switch-field">
            <input type="checkbox" data-control="setting-sound"
              ${settings.soundEnabled === false ? "" : "checked"}>
            <span class="switch-field__box">${icon("check")}</span>
            <span class="switch-field__text">
              <strong>Звук колеса</strong>
              <small>Щелчки при вращении и аккорд в конце.</small>
            </span>
          </label>
          <label class="switch-field">
            <input type="checkbox" data-control="setting-reduced-motion"
              ${settings.reducedMotion === true ? "checked" : ""}>
            <span class="switch-field__box">${icon("check")}</span>
            <span class="switch-field__text">
              <strong>Меньше движения</strong>
              <small>Отключает анимации появления и вращение колеса.</small>
            </span>
          </label>
          <label class="field">
            <span>Сейвы работают, пока участников больше</span>
            <input type="number" min="1" max="99" data-control="setting-save-threshold"
              value="${Number(settings.savesEnabledAboveRemaining ?? 3)}">
            <small class="field__hint">Значение подставляется в диалог настройки
            сессии колеса.</small>
          </label>
          <label class="field">
            <span>Напоминать о резервной копии, дней</span>
            <input type="number" min="1" max="365" data-control="setting-backup-days"
              value="${Number(settings.backupReminderDays ?? 30)}">
          </label>
        </div>
      </section>

      <section class="panel">
        <header class="panel__head">
          <div class="panel__lead">
            <span class="panel__glyph">${icon("download")}</span>
            <div>
              <p class="eyebrow">Резервная копия</p>
              <h3>Экспорт и импорт</h3>
            </div>
          </div>
        </header>
        <p>Копия содержит фильмы, списки, коллекции, оценки, игроков и историю
        завершённых роллов.</p>
        <div class="panel__actions">
          <button class="btn btn--primary" type="button" data-action="backup-export">
            ${icon("download")}<span>Скачать JSON</span>
          </button>
          <label class="btn btn--ghost file-btn">
            ${icon("upload")}<span>Импортировать JSON</span>
            <input type="file" accept=".json,application/json" data-control="backup-import">
          </label>
          <button class="btn btn--ghost" type="button" data-action="csv-export">
            ${icon("table")}<span>Выгрузить CSV</span>
          </button>
        </div>
        <p class="form-hint">CSV удобно открыть в таблице, но восстановить
        библиотеку целиком можно только из JSON.</p>

        <div class="backup-local">
          <label class="switch-field">
            <input type="checkbox" data-control="setting-auto-backup"
              ${autoBackupDays > 0 ? "checked" : ""}>
            <span class="switch-field__box">${icon("check")}</span>
            <span class="switch-field__text">
              <strong>Копия на диск автоматически</strong>
              <small>Хранится рядом с данными приложения и переживает очистку
              браузера. CineVault держит последние пять копий.</small>
            </span>
          </label>
          ${autoBackupDays > 0 ? `
            <label class="field">
              <span>Как часто, дней</span>
              <input type="number" min="1" max="90" data-control="setting-auto-backup-days"
                value="${autoBackupDays}">
            </label>` : ""}
          <div class="panel__actions">
            <button class="btn btn--ghost btn--sm" type="button" data-action="local-backup-now">
              ${icon("shield")}<span>Сохранить копию сейчас</span>
            </button>
          </div>
          ${localBackup.error
            ? `<p class="form-hint">Лаунчер недоступен, копия на диск не делается:
               ${escapeHtml(localBackup.error)}</p>`
            : localBackup.files.length ? `
              <div class="kv-list kv-list--files">
                ${localBackup.files.map((file) => `
                  <div>
                    <span>${escapeHtml(formatDateTime(file.savedAt))}</span>
                    <b>${Math.max(1, Math.round(file.size / 1024))} КБ</b>
                  </div>
                `).join("")}
              </div>
              <p class="form-hint">Папка: <code>${escapeHtml(localBackup.directory)}</code></p>
            ` : `<p class="form-hint">Копий на диске пока нет.</p>`}
        </div>
        <p class="form-hint">Последняя копия: ${state.library.settings.lastBackupAt
          ? escapeHtml(formatDateTime(state.library.settings.lastBackupAt))
          : "не создавалась"}.</p>
      </section>

      <section class="panel">
        <header class="panel__head">
          <div class="panel__lead">
            <span class="panel__glyph">${icon("table")}</span>
            <div>
              <p class="eyebrow">Google Таблицы и Excel</p>
              <h3>Импорт CSV, TSV, XLSX</h3>
            </div>
          </div>
        </header>
        <p>Поддерживаются столбцы «Название», «Список» или «Категория», «Франшиза»,
        «Год», «Длительность», «Страна», «Просмотрено», «Дата просмотра» и оценки
        вида «Оценка Антон».</p>
        <div class="panel__actions">
          <label class="btn btn--primary file-btn">
            ${icon("upload")}<span>Выбрать таблицу</span>
            <input type="file" accept=".csv,.tsv,.xlsx,text/csv" data-control="table-import">
          </label>
        </div>
      </section>

      <section class="panel ${state.legacyDataFound ? "panel--ok" : ""}">
        <header class="panel__head">
          <div class="panel__lead">
            <span class="panel__glyph">${icon("database")}</span>
            <div>
              <p class="eyebrow">Movie Manager V13</p>
              <h3>${state.legacyDataFound ? "Найдены старые данные" : "Старая база не найдена"}</h3>
            </div>
          </div>
        </header>
        <p>${state.legacyDataFound
          ? "Миграция объединит старую библиотеку с новой и не удалит текущие записи."
          : "Если старая версия использовалась в другом браузере, сначала экспортируйте её данные там."}</p>
        <div class="panel__actions">
          <button class="btn btn--primary" type="button" data-action="legacy-migrate"
            ${state.legacyDataFound ? "" : "disabled"}>
            ${icon("refresh")}<span>Перенести данные</span>
          </button>
        </div>
      </section>

      <section class="panel">
        <header class="panel__head">
          <div class="panel__lead">
            <span class="panel__glyph">${icon("users")}</span>
            <div>
              <p class="eyebrow">Игроки</p>
              <h3>Сохранённые имена</h3>
            </div>
          </div>
        </header>
        <div class="participant-tags">
          ${state.library.participants.map((participant) => `
            <span class="participant-tag">
              <i>${escapeHtml(initials(participant.name))}</i>
              ${escapeHtml(participant.name)}
              <button type="button" data-action="participant-edit" data-id="${participant.id}"
                aria-label="Редактировать">${icon("edit")}</button>
              <button type="button" data-action="participant-delete" data-id="${participant.id}"
                aria-label="Удалить">${icon("close")}</button>
            </span>
          `).join("") || '<span class="muted">Имена появятся после первой сессии или оценки.</span>'}
        </div>
      </section>

      <section class="panel">
        <header class="panel__head">
          <div class="panel__lead">
            <span class="panel__glyph">${icon("shield")}</span>
            <div>
              <p class="eyebrow">Формат данных</p>
              <h3>IndexedDB · схема v3</h3>
            </div>
          </div>
        </header>
        <p>Библиотека сохраняется автоматически в профиле текущего браузера и
        никуда не отправляется. Для переноса на другой компьютер используйте
        резервный JSON.</p>
        <div class="kv-list">
          <div><span>Фильмов</span><b>${state.library.movies.length}</b></div>
          <div><span>Списков</span><b>${state.library.categories.length}</b></div>
          <div><span>Коллекций</span><b>${state.library.franchises.length}</b></div>
          <div><span>Сессий</span><b>${state.library.rollSessions.length}</b></div>
        </div>
      </section>
    </div>
  `;
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

function initials(value) {
  const text = String(value ?? "").trim();
  if (!text) return "CV";
  const words = text.split(/\s+/).slice(0, 2);
  return words.map((word) => word[0]).join("").toLocaleUpperCase("ru-RU");
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function setupImageFallbacks(root) {
  root.querySelectorAll("img").forEach((image) => {
    image.addEventListener("error", () => {
      image.hidden = true;
      const parent = image.parentElement;
      if (parent && !parent.querySelector(".poster-fallback")) {
        const fallback = document.createElement("span");
        fallback.className = "poster-fallback poster-fallback--error";
        fallback.textContent = "CV";
        parent.append(fallback);
      }
    }, { once: true });
  });
}
