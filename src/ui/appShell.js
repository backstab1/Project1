import { APP_VERSION } from "../config.js";
import { calculateAverageRating } from "../domain/entities.js";
import {
  buildCategoryQueue,
  getMovieFranchiseMap,
} from "../domain/libraryRules.js";
import { setupDialog } from "./dialog.js";
import { drawWheel } from "./wheelCanvas.js";
import { isBackupReminderDue } from "../domain/backupReminder.js";

const NAV_ITEMS = [
  ["dashboard", "Главная", "home"],
  ["catalog", "Каталог", "film"],
  ["franchises", "Коллекции", "collection"],
  ["categories", "Категории", "categories"],
  ["watched", "Просмотренные", "eye"],
  ["wheel", "Колесо", "wheel"],
  ["sessions", "История роллов", "history"],
  ["settings", "Настройки", "settings"],
];

const ICONS = Object.freeze({
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>',
  film: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4v16M17 4v16M3 9h4m10 0h4M3 15h4m10 0h4"/></svg>',
  collection: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 2h8M8 22h8m-6-13 6 3-6 3z"/></svg>',
  categories: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  wheel: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m12 3 2 7 7 2-7 2-2 7-2-7-7-2 7-2z"/></svg>',
  history: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5m4-1v5l3 2"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
});

export function renderAppShell(root, state) {
  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <button class="brand" type="button" data-view="dashboard">
          <span class="brand__mark">CV</span>
          <span class="brand__name">CineVault</span>
        </button>

        <nav class="navigation" aria-label="Основная навигация">
          ${NAV_ITEMS.map(([id, label, iconName]) => `
            <button
              class="navigation__item ${state.view === id ? "is-active" : ""}"
              type="button"
              data-view="${id}"
              ${state.view === id ? 'aria-current="page"' : ""}
            >
              <span class="navigation__icon">${ICONS[iconName]}</span>
              <span>${label}</span>
            </button>
          `).join("")}
        </nav>

        <div class="sidebar__footer">
          <button class="theme-toggle" type="button" data-action="theme-toggle"
            aria-label="${state.theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}">
            <span>${state.theme === "dark" ? ICONS.sun : ICONS.moon}</span>
            <span>${state.theme === "dark" ? "Светлая тема" : "Тёмная тема"}</span>
          </button>
          <div class="storage-summary">
            <span><i class="storage-summary__dot"></i> Локальная база</span>
            <strong>v${APP_VERSION}</strong>
          </div>
        </div>
      </aside>

      <main class="main-area">
        <header class="topbar">
          <div>
            <h1>${escapeHtml(getViewTitle(state.view))}</h1>
          </div>
          <div class="storage-status ${state.error ? "is-error" : ""}">
            <span class="storage-status__dot"></span>
            ${state.error ? "Ошибка хранилища" : "Сохранение включено"}
          </div>
        </header>

        <section class="content" id="view-content"></section>
      </main>

      <nav class="mobile-navigation" aria-label="Мобильная навигация">
        ${NAV_ITEMS.filter(([id]) => ["dashboard", "catalog", "wheel"].includes(id))
          .map(([id, label, iconName]) => `
            <button class="${state.view === id ? "is-active" : ""}" type="button"
              data-view="${id}" ${state.view === id ? 'aria-current="page"' : ""}>
              ${ICONS[iconName]}<span>${label}</span>
            </button>
          `).join("")}
        <details class="mobile-more">
          <summary>${ICONS.more}<span>Ещё</span></summary>
          <div class="mobile-more__menu">
            ${NAV_ITEMS.filter(([id]) => !["dashboard", "catalog", "wheel"].includes(id))
              .map(([id, label, iconName]) => `
                <button type="button" data-view="${id}">${ICONS[iconName]}<span>${label}</span></button>
              `).join("")}
            <button type="button" data-action="theme-toggle">
              ${state.theme === "dark" ? ICONS.sun : ICONS.moon}
              <span>${state.theme === "dark" ? "Светлая тема" : "Тёмная тема"}</span>
            </button>
          </div>
        </details>
      </nav>

      <dialog class="dialog" id="entity-dialog">
        <form method="dialog" class="dialog__surface">
          <header class="dialog__header">
            <div>
              <p class="eyebrow">CineVault</p>
              <h2 id="dialog-title"></h2>
            </div>
            <button
              class="icon-button"
              type="button"
              data-dialog-close
              aria-label="Закрыть"
            >×</button>
          </header>
          <div class="dialog__body" id="dialog-body"></div>
          <p class="form-error" data-dialog-error role="alert"></p>
          <footer class="dialog__footer">
            <button class="button button--ghost" type="button" data-dialog-close>
              Отмена
            </button>
            <button class="button button--primary" type="submit" data-dialog-submit>
              Сохранить
            </button>
          </footer>
        </form>
      </dialog>
    </div>
  `;

  renderCurrentView(root.querySelector("#view-content"), state);

  root.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => state.onNavigate(button.dataset.view));
  });
  root.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      state.onAction(button.dataset.action, { ...button.dataset });
    });
  });
  root.querySelectorAll("[data-control]").forEach((control) => {
    const eventName = control.matches('input[type="search"]') ? "input" : "change";
    control.addEventListener(eventName, () => {
      state.onControl(control.dataset.control, {
        value: control.value,
        files: control.files,
        checked: control.checked,
      });
    });
  });

  setupDialog();
  const wheelCanvas = root.querySelector("#wheel-canvas");
  if (wheelCanvas) {
    drawWheel(
      wheelCanvas,
      state.activeSession?.pool ?? state.rollDraftPool,
    );
  }
  if (state.focusControl) {
    const control = root.querySelector(
      `[data-control="${state.focusControl}"]`,
    );
    control?.focus();
    if (control?.setSelectionRange) {
      const end = control.value.length;
      control.setSelectionRange(end, end);
    }
  }
  setupImageFallbacks(root);
}

function renderCurrentView(container, state) {
  if (state.error) {
    container.innerHTML = `
      <section class="notice notice--error">
        <p class="eyebrow">Хранилище недоступно</p>
        <h2>Не удалось открыть локальную базу</h2>
        <p>${escapeHtml(state.error.message)}</p>
        <p>Запускайте приложение через <code>launch.py</code>, а не напрямую
        из файла.</p>
      </section>
    `;
    return;
  }

  if (state.view === "dashboard") {
    renderDashboard(container, state);
    return;
  }

  if (state.view === "catalog") {
    renderCatalog(container, state);
    return;
  }

  if (state.view === "categories") {
    renderCategories(container, state.library);
    return;
  }

  if (state.view === "franchises") {
    renderFranchises(container, state.library);
    return;
  }

  if (state.view === "wheel") {
    renderWheel(container, state);
    return;
  }

  if (state.view === "watched") {
    renderWatched(container, state.library);
    return;
  }

  if (state.view === "sessions") {
    renderSessions(container, state.library.rollSessions);
    return;
  }

  if (state.view === "settings") {
    renderSettings(container, state);
    return;
  }

  const descriptions = {
    catalog: "Здесь появятся фильмы, поиск, фильтры и создание карточек.",
    categories: "Здесь будет дерево категорий и ручное управление очередями.",
    franchises: "Здесь будут франшизы и порядок фильмов внутри них.",
    watched: "Здесь появятся просмотренные фильмы и оценки зрителей.",
    wheel: "Здесь будет формирование пула и колесо батл-рояля.",
    sessions: "Здесь будет история завершённых розыгрышей и применения сейвов.",
    settings: "Здесь будут участники, резервные копии, импорт и параметры.",
  };

  container.innerHTML = `
    <section class="empty-state">
      <div class="empty-state__icon">✦</div>
      <p class="eyebrow">Этап основания</p>
      <h2>${escapeHtml(getViewTitle(state.view))}</h2>
      <p>${escapeHtml(descriptions[state.view] ?? "Раздел находится в разработке.")}</p>
    </section>
  `;
}

function renderWatched(container, library) {
  const watchedMovies = library.movies
    .filter((movie) => movie.watchedAt)
    .sort((a, b) => String(b.watchedAt).localeCompare(String(a.watchedAt)));
  const categoryById = new Map(
    library.categories.map((category) => [category.id, category]),
  );

  container.innerHTML = `
    <div class="view-toolbar">
      <div>
        <p class="eyebrow">История просмотров</p>
        <h2>${watchedMovies.length}
          ${pluralize(watchedMovies.length, ["фильм", "фильма", "фильмов"])}
        </h2>
      </div>
    </div>

    ${watchedMovies.length === 0 ? emptyBlock(
      "Просмотренных фильмов пока нет",
      "Победитель колеса появится здесь автоматически. Фильм также можно отметить вручную из каталога.",
    ) : `
      <div class="watched-list">
        ${watchedMovies.map((movie) => watchedRow(
          movie,
          categoryById.get(movie.categoryId),
        )).join("")}
      </div>
    `}
  `;
}

function renderSessions(container, sessions) {
  const completed = [...sessions]
    .filter((session) => session.status === "completed")
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));

  container.innerHTML = `
    <div class="view-toolbar">
      <div>
        <p class="eyebrow">Архив</p>
        <h2>${completed.length}
          ${pluralize(completed.length, ["сессия", "сессии", "сессий"])}
        </h2>
      </div>
    </div>

    ${completed.length === 0 ? emptyBlock(
      "Завершённых роллов пока нет",
      "После определения первого победителя здесь появится состав, журнал выбываний и использованные сейвы.",
    ) : `
      <div class="session-list">
        ${completed.map((session) => {
          const savesUsed = session.events.filter(
            (event) => event.type === "save-used",
          ).length;
          return `
            <article class="session-card">
              <div>
                <p class="eyebrow">${formatDateTime(session.completedAt)}</p>
                <h3>${escapeHtml(session.winner?.title ?? "Победитель не указан")}</h3>
                <p class="card-meta">
                  Старт: ${session.originalPool.length} ·
                  Выбыли: ${session.eliminated.length} ·
                  Сейвы: ${savesUsed}
                </p>
              </div>
              <div class="session-players">
                ${session.participants.map((participant) => `
                  <span>${escapeHtml(participant.name)}
                    <small>${participant.savesRemaining}/${participant.savesInitial}</small>
                  </span>
                `).join("")}
                <button class="button button--ghost" type="button"
                  data-action="session-open" data-id="${session.id}">
                  Подробнее
                </button>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    `}
  `;
}

function renderWheel(container, state) {
  if (!state.activeSession) {
    const quotaCategories = state.library.categories
      .filter((category) => category.rollQuota > 0)
      .sort(sortByPosition);
    container.innerHTML = `
      <div class="view-toolbar">
        <div>
          <p class="eyebrow">Подготовка сессии</p>
          <h2>${state.rollDraftPool.length}
            ${pluralize(state.rollDraftPool.length, ["участник", "участника", "участников"])}
          </h2>
        </div>
        <div class="toolbar-actions">
          <button class="button button--ghost" type="button"
            data-action="roll-shuffle">Перемешать</button>
          <button class="button button--primary" type="button"
            data-action="roll-configure">Настроить и начать</button>
        </div>
      </div>

      <div class="wheel-setup-grid">
        <section class="panel">
          <p class="eyebrow">Предварительный состав</p>
          ${state.rollDraftPool.length ? `
            <ol class="pool-preview">
              ${state.rollDraftPool.map((item, index) => `
                <li>
                  <span>${index + 1}</span>
                  <strong>${escapeHtml(item.title)}</strong>
                  <small>${item.type === "franchise" ? "Франшиза" : "Фильм"}</small>
                </li>
              `).join("")}
            </ol>
          ` : `
            <p class="muted">Пул пуст. Задайте квоту минимум одной категории
            и добавьте в очередь непросмотренные фильмы.</p>
          `}
        </section>
        <section class="panel panel--accent">
          <p class="eyebrow">Квоты категорий</p>
          ${quotaCategories.length ? `
            <div class="quota-list">
              ${quotaCategories.map((category) => `
                <div>
                  <span>${escapeHtml(category.name)}</span>
                  <strong>${category.rollQuota}</strong>
                </div>
              `).join("")}
            </div>
          ` : `<p class="muted">Квоты ещё не настроены.</p>`}
        </section>
      </div>
    `;
    return;
  }

  const session = state.activeSession;
  const pending = session.pendingIndex === null
    ? null
    : session.pool[session.pendingIndex];

  container.innerHTML = `
    <div class="wheel-layout">
      <section class="wheel-stage">
        <div class="wheel-frame">
          <div class="wheel-pointer" aria-hidden="true"></div>
          <canvas id="wheel-canvas" width="560" height="560"
            aria-label="Колесо с участниками"></canvas>
        </div>
        <div class="wheel-status">
          ${pending ? `
            <p>Выбывает</p>
            <h2>${escapeHtml(pending.title)}</h2>
          ` : `
            <p>В колесе осталось</p>
            <h2>${session.pool.length}
              ${pluralize(session.pool.length, ["участник", "участника", "участников"])}
            </h2>
          `}
        </div>
        <div class="wheel-actions">
          ${pending ? `
            <button class="button button--ghost" type="button"
              data-action="roll-reroll">Перекрутить</button>
            <button class="button button--danger" type="button"
              data-action="roll-confirm-elimination">Подтвердить выбывание</button>
          ` : `
            <button class="button button--primary button--spin" type="button"
              data-action="roll-spin" ${state.isSpinning ? "disabled" : ""}>
              ${state.isSpinning ? "Колесо вращается…" : "Крутить · Пробел"}
            </button>
          `}
        </div>
      </section>

      <aside class="wheel-sidebar">
        <section class="wheel-panel">
          <p class="eyebrow">Сейвы</p>
          <div class="save-list">
            ${session.participants.map((participant) => `
              <div>
                <span>
                  <strong>${escapeHtml(participant.name)}</strong>
                  <small>${participant.savesRemaining} из ${participant.savesInitial}</small>
                </span>
                ${pending ? `
                  <button class="mini-button mini-button--wide" type="button"
                    data-action="roll-save" data-id="${participant.id}"
                    ${participant.savesRemaining <= 0 ||
                      session.pool.length <= session.savesEnabledAboveRemaining
                      ? "disabled" : ""}>
                    Спасти
                  </button>
                ` : ""}
              </div>
            `).join("")}
          </div>
          <p class="form-hint">Сейвы работают, пока остаётся больше
          ${session.savesEnabledAboveRemaining} участников.</p>
        </section>

        <section class="wheel-panel">
          <div class="panel-heading">
            <p class="eyebrow">Выбыли</p>
            <strong>${session.eliminated.length}</strong>
          </div>
          <div class="eliminated-list">
            ${session.eliminated.map((item) => `
              <div>
                <span>${escapeHtml(item.title)}</span>
                <button class="mini-button" type="button"
                  data-action="roll-restore" data-id="${item.id}"
                  data-entity-type="${item.type}" aria-label="Вернуть">↺</button>
              </div>
            `).join("") || '<p class="muted">Пока никто не выбыл.</p>'}
          </div>
        </section>
      </aside>
    </div>
  `;
}

function renderCatalog(container, state) {
  const { library, catalogFilters } = state;
  const categories = new Map(
    library.categories.map((category) => [category.id, category]),
  );
  const franchiseByMovieId = getMovieFranchiseMap(library.franchises);
  const query = catalogFilters.query.trim().toLocaleLowerCase("ru-RU");
  const movies = library.movies
    .filter((movie) => {
      if (
        query &&
        ![
          movie.title,
          movie.originalTitle,
          movie.country,
          movie.overview,
          ...(movie.genres ?? []),
          categories.get(movie.categoryId)?.name,
          franchiseByMovieId.get(movie.id)?.name,
          movie.releaseYear,
        ].some((value) =>
          String(value ?? "").toLocaleLowerCase("ru-RU").includes(query)
        )
      ) {
        return false;
      }
      if (
        catalogFilters.categoryId &&
        movie.categoryId !== catalogFilters.categoryId
      ) {
        return false;
      }
      if (catalogFilters.status === "watched" && !movie.watchedAt) return false;
      if (catalogFilters.status === "unwatched" && movie.watchedAt) return false;
      return true;
    })
    .sort(getMovieSorter(catalogFilters.sort));

  container.innerHTML = `
    <div class="view-toolbar">
      <div>
        <p class="eyebrow">Библиотека</p>
        <h2>${movies.length} ${pluralize(movies.length, ["фильм", "фильма", "фильмов"])}</h2>
      </div>
      <button class="button button--primary" type="button" data-action="movie-add">
        + Добавить фильм
      </button>
    </div>

    <div class="filter-bar">
      <label class="filter-search">
        <span class="sr-only">Поиск</span>
        <input type="search" data-control="catalog-query"
          placeholder="Поиск по названию, стране, категории…"
          value="${escapeAttribute(catalogFilters.query)}">
      </label>
      <select data-control="catalog-category" aria-label="Категория">
        <option value="">Все категории</option>
        ${[...library.categories].sort(sortByPosition).map((category) => `
          <option value="${category.id}"
            ${catalogFilters.categoryId === category.id ? "selected" : ""}>
            ${escapeHtml(category.name)}
          </option>
        `).join("")}
      </select>
      <select data-control="catalog-status" aria-label="Статус">
        <option value="all" ${catalogFilters.status === "all" ? "selected" : ""}>Все статусы</option>
        <option value="unwatched" ${catalogFilters.status === "unwatched" ? "selected" : ""}>Не просмотрено</option>
        <option value="watched" ${catalogFilters.status === "watched" ? "selected" : ""}>Просмотрено</option>
      </select>
      <select data-control="catalog-sort" aria-label="Сортировка">
        <option value="title" ${catalogFilters.sort === "title" ? "selected" : ""}>По названию</option>
        <option value="year" ${catalogFilters.sort === "year" ? "selected" : ""}>По году</option>
        <option value="rating" ${catalogFilters.sort === "rating" ? "selected" : ""}>По рейтингу</option>
        <option value="queue" ${catalogFilters.sort === "queue" ? "selected" : ""}>По очереди</option>
      </select>
    </div>

    ${movies.length === 0 ? emptyBlock(
      "Каталог пока пуст",
      "Добавьте первый фильм. Обязательны только название и категория.",
    ) : `
      <div class="movie-grid">
        ${movies.map((movie) => movieCard(
          movie,
          categories.get(movie.categoryId),
          franchiseByMovieId.get(movie.id),
        )).join("")}
      </div>
    `}
  `;
}

function renderSettings(container, state) {
  container.innerHTML = `
    <div class="view-toolbar">
      <div>
        <p class="eyebrow">Обслуживание</p>
        <h2>Настройки и данные</h2>
      </div>
    </div>

    <div class="settings-grid">
      <section class="panel tmdb-settings ${state.tmdbStatus.configured ? "panel--accent" : ""}">
        <div class="tmdb-settings__header">
          <div>
            <p class="eyebrow">Каталог фильмов</p>
            <h2>TMDB</h2>
          </div>
          <span class="status-pill ${state.tmdbStatus.configured ? "status-pill--success" : ""}">
            ${state.tmdbStatus.loading
              ? "Проверка…"
              : state.tmdbStatus.configured ? "Подключён" : "Не подключён"}
          </span>
        </div>
        <p>${state.tmdbStatus.configured
          ? "Поиск доступен в форме добавления фильма. Название, год, длительность, страна, жанры, описание и постер заполняются автоматически."
          : "Подключите API Read Access Token, чтобы искать фильмы и сохранять постеры локально."}</p>
        ${state.tmdbStatus.error
          ? `<p class="dialog-error">${escapeHtml(state.tmdbStatus.error)}</p>`
          : ""}
        <div class="settings-actions">
          <button class="button button--primary" type="button"
            data-action="tmdb-configure">
            ${state.tmdbStatus.configured ? "Заменить токен" : "Подключить TMDB"}
          </button>
          ${state.tmdbStatus.configured ? `
            <button class="button button--ghost" type="button"
              data-action="tmdb-clear">Удалить токен</button>
          ` : ""}
        </div>
        <div class="tmdb-attribution">
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer"
            aria-label="The Movie Database">
            <img src="./assets/tmdb.svg" alt="The Movie Database (TMDB)">
          </a>
          <small>This product uses the TMDB API but is not endorsed or certified by TMDB.</small>
        </div>
      </section>

      <section class="panel">
        <p class="eyebrow">Резервная копия</p>
        <h2>Экспорт и импорт</h2>
        <p>Экспорт содержит фильмы, категории, франшизы, оценки, игроков и
        историю завершённых роллов.</p>
        <div class="settings-actions">
          <button class="button button--primary" type="button"
            data-action="backup-export">Скачать JSON</button>
          <label class="button button--ghost file-button">
            Импортировать JSON
            <input type="file" accept=".json,application/json"
              data-control="backup-import">
          </label>
        </div>
        <p class="form-hint">Последняя резервная копия:
          ${state.library.settings.lastBackupAt
            ? formatDateTime(state.library.settings.lastBackupAt)
            : "не создавалась"}.
        </p>
      </section>

      <section class="panel">
        <p class="eyebrow">Google Таблицы и Excel</p>
        <h2>Импорт CSV, TSV или XLSX</h2>
        <p>Поддерживаются столбцы «Название», «Категория», «Франшиза»,
        «Год», «Длительность», «Страна», «Просмотрено», «Дата просмотра»
        и оценки вида «Оценка Антон».</p>
        <label class="button button--primary file-button">
          Выбрать таблицу
          <input type="file" accept=".csv,.tsv,.xlsx,text/csv"
            data-control="table-import">
        </label>
      </section>

      <section class="panel ${state.legacyDataFound ? "panel--accent" : ""}">
        <p class="eyebrow">Movie Manager V13</p>
        <h2>${state.legacyDataFound
          ? "Найдены старые данные"
          : "Старая база не обнаружена"}</h2>
        <p>${state.legacyDataFound
          ? "Миграция объединит старую библиотеку с новой и не удалит текущие записи."
          : "Если старая версия использовалась в другом браузере, сначала экспортируйте её данные там."}</p>
        <button class="button button--primary" type="button"
          data-action="legacy-migrate" ${state.legacyDataFound ? "" : "disabled"}>
          Перенести данные
        </button>
      </section>

      <section class="panel">
        <p class="eyebrow">Игроки</p>
        <h2>Сохранённые имена</h2>
        <div class="participant-tags">
          ${state.library.participants.map((participant) =>
            `<span>
              ${escapeHtml(participant.name)}
              <button type="button" data-action="participant-edit"
                data-id="${participant.id}" aria-label="Редактировать">✎</button>
              <button type="button" data-action="participant-delete"
                data-id="${participant.id}" aria-label="Удалить">×</button>
            </span>`
          ).join("") || '<span class="muted">Имена появятся после первой сессии или оценки.</span>'}
        </div>
      </section>

      <section class="panel">
        <p class="eyebrow">Формат данных</p>
        <h2>IndexedDB · схема v3</h2>
        <p>Данные сохраняются автоматически в профиле текущего браузера.
        Для переноса на другой компьютер используйте резервный JSON.</p>
      </section>
    </div>
  `;
}

function renderCategories(container, library) {
  const roots = library.categories
    .filter((category) => !category.parentId)
    .sort(sortByPosition);

  container.innerHTML = `
    <div class="view-toolbar">
      <div>
        <p class="eyebrow">Организация</p>
        <h2>Категории и очереди</h2>
      </div>
      <button class="button button--primary" type="button" data-action="category-add">
        + Новая категория
      </button>
    </div>

    <section class="uncategorized-row">
      <div>
        <strong>Без категории</strong>
        <small>${library.movies.filter((movie) => !movie.categoryId).length} фильмов</small>
      </div>
    </section>

    ${roots.length === 0 ? emptyBlock(
      "Категорий пока нет",
      "Создайте категории и настройте порядок фильмов, который будет использовать колесо.",
    ) : `
      <div class="category-tree">
        ${roots.map((category) => categoryNode(category, library, 0)).join("")}
      </div>
    `}
  `;
}

function renderFranchises(container, library) {
  const movieById = new Map(library.movies.map((movie) => [movie.id, movie]));
  const categoryById = new Map(
    library.categories.map((category) => [category.id, category]),
  );

  container.innerHTML = `
    <div class="view-toolbar">
      <div>
        <p class="eyebrow">Коллекции</p>
        <h2>${library.franchises.length}
          ${pluralize(library.franchises.length, ["франшиза", "франшизы", "франшиз"])}
        </h2>
      </div>
      <button class="button button--primary" type="button" data-action="franchise-add">
        + Новая франшиза
      </button>
    </div>

    ${library.franchises.length === 0 ? emptyBlock(
      "Франшиз пока нет",
      "Франшиза объединяет несколько фильмов и участвует в колесе как один объект.",
    ) : `
      <div class="franchise-grid">
        ${library.franchises.map((franchise) => `
          <article class="franchise-card">
            <div class="card-actions">
              <button class="icon-button" type="button"
                data-action="franchise-edit" data-id="${franchise.id}"
                aria-label="Редактировать">✎</button>
              <button class="icon-button icon-button--danger" type="button"
                data-action="franchise-delete" data-id="${franchise.id}"
                aria-label="Удалить">×</button>
            </div>
            <p class="eyebrow">Франшиза</p>
            <h3>${escapeHtml(franchise.name)}</h3>
            <p class="card-meta">
              ${escapeHtml(categoryById.get(franchise.categoryId)?.name ?? "Без категории")}
            </p>
            <ol class="franchise-movies">
              ${franchise.movieIds.map((id) => movieById.get(id)).filter(Boolean)
                .map((movie) => `
                  <li>
                    <span>${escapeHtml(movie.title)}</span>
                    <span class="queue-list__actions">
                      <button class="mini-button" type="button"
                        data-action="franchise-member-up"
                        data-id="${franchise.id}" data-movie-id="${movie.id}"
                        aria-label="Выше">↑</button>
                      <button class="mini-button" type="button"
                        data-action="franchise-member-down"
                        data-id="${franchise.id}" data-movie-id="${movie.id}"
                        aria-label="Ниже">↓</button>
                    </span>
                  </li>
                `).join("")
                || "<li class=\"muted\">Фильмы ещё не добавлены</li>"}
            </ol>
          </article>
        `).join("")}
      </div>
    `}
  `;
}

function renderDashboard(container, state) {
  const { statistics, legacyDataFound } = state;
  const recentMovies = [...state.library.movies]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 5);
  const movieById = new Map(state.library.movies.map((movie) => [movie.id, movie]));
  const recentCollections = state.library.franchises.slice(0, 3);
  const heroMovie = recentMovies.find((movie) => movie.coverUrl) ?? recentMovies[0];
  const backupDue = isBackupReminderDue({
    movieCount: state.library.movies.length,
    lastBackupAt: state.library.settings.lastBackupAt,
    dismissedUntil: state.library.settings.backupReminderDismissedUntil,
    reminderDays: state.library.settings.backupReminderDays,
  });
  container.innerHTML = `
    <section class="dashboard-hero ${heroMovie?.coverUrl ? "has-poster" : ""}">
      <div class="dashboard-hero__visual">
        ${heroMovie?.coverUrl
          ? `<img src="${escapeAttribute(heroMovie.coverUrl)}"
              alt="Постер фильма ${escapeAttribute(heroMovie.title)}">`
          : '<span aria-hidden="true">CV</span>'}
      </div>
      <div class="dashboard-hero__content">
        <p class="eyebrow">Личная киноколлекция</p>
        <h2>${statistics.movieCount ? "Что посмотрим сегодня?" : "Начните свою библиотеку"}</h2>
        <p>${statistics.movieCount
          ? "Откройте каталог или запустите колесо, чтобы выбрать фильм для следующего вечера."
          : "Добавьте первый фильм вручную или найдите его через TMDB — постер и основные данные заполнятся автоматически."}</p>
        <button class="button button--primary" type="button"
          ${statistics.movieCount ? 'data-view="catalog"' : 'data-action="movie-add"'}>
          ${statistics.movieCount ? "Открыть каталог" : "Добавить первый фильм"}
          <span aria-hidden="true">→</span>
        </button>
      </div>
      <div class="dashboard-hero__counter">
        <span>Всего фильмов</span>
        <strong>${statistics.movieCount.toLocaleString("ru-RU")}</strong>
      </div>
    </section>

    <div class="dashboard-metrics">
      ${dashboardMetric("Фильмов", statistics.movieCount, "film")}
      ${dashboardMetric("Просмотрено", statistics.watchedMovieCount, "eye")}
      ${dashboardMetric("В очереди", statistics.unwatchedMovieCount, "history")}
      ${dashboardMetric("Коллекций", statistics.franchiseCount, "collection")}
    </div>

    ${statistics.movieCount ? `
      <div class="dashboard-sections ${recentCollections.length ? "has-collections" : ""}">
        <section class="dashboard-section">
          <header class="section-heading">
            <h2>Недавно добавлено</h2>
            <button type="button" data-view="catalog">Все <span aria-hidden="true">→</span></button>
          </header>
          <div class="recent-movies">
            ${recentMovies.map(dashboardMovieCard).join("")}
          </div>
        </section>

        ${recentCollections.length ? `
          <section class="dashboard-section">
            <header class="section-heading">
              <h2>Коллекции</h2>
              <button type="button" data-view="franchises">Все <span aria-hidden="true">→</span></button>
            </header>
            <div class="dashboard-collections">
              ${recentCollections.map((franchise) =>
                dashboardCollectionCard(franchise, movieById)).join("")}
            </div>
          </section>
        ` : ""}
      </div>
    ` : ""}

    <section class="dashboard-overview">
      <header class="dashboard-overview__heading">
        <div>
          <p class="eyebrow">Сводка библиотеки</p>
          <h2>Ваша коллекция в цифрах</h2>
        </div>
        <button type="button" data-view="catalog">Открыть каталог <span aria-hidden="true">→</span></button>
      </header>

      <div class="dashboard-overview__metrics">
        ${dashboardMetric("Категорий", statistics.categoryCount, "categories")}
        ${dashboardMetric(
          "Средняя оценка",
          statistics.libraryAverageRating == null
            ? "—"
            : statistics.libraryAverageRating.toLocaleString("ru-RU", { maximumFractionDigits: 1 }),
          "star",
        )}
        ${dashboardMetric("Всего оценок", statistics.totalRatingCount, "wheel")}
        ${dashboardMetric("Просмотрено часов", formatWatchedHours(statistics.watchedDurationMinutes), "clock")}
      </div>

      <div class="dashboard-overview__panels">
        <article class="dashboard-summary-card">
          <p class="eyebrow">Библиотека</p>
          ${statistics.highestRatedMovie ? `
            <h3>Лидер — ${escapeHtml(statistics.highestRatedMovie.movie.title)}</h3>
            <p>Самая высокая средняя оценка в вашей коллекции: <strong>${statistics.highestRatedMovie.rating.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}</strong>.</p>
            ${statistics.lowestRatedMovie && statistics.lowestRatedMovie.movie.id !== statistics.highestRatedMovie.movie.id
              ? `<small>Самая низкая оценка сейчас у фильма «${escapeHtml(statistics.lowestRatedMovie.movie.title)}» — ${statistics.lowestRatedMovie.rating.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}.</small>`
              : ""}
          ` : `
            <h3>${statistics.movieCount ? "Оценок пока нет" : "Библиотека ждёт первые фильмы"}</h3>
            <p>${statistics.movieCount
              ? "Оцените просмотренные фильмы — здесь появятся лидер коллекции и полезная сводка."
              : "Начните с фильма, который точно хочется сохранить. Остальная статистика заполнится автоматически."}</p>
          `}
        </article>

        <article class="dashboard-summary-card dashboard-summary-card--accent">
          <p class="eyebrow">Быстрый старт</p>
          <h3>${statistics.movieCount ? "Не знаете, что посмотреть?" : "Добавьте первый фильм"}</h3>
          <p>${statistics.movieCount
            ? "Колесо соберёт доступные фильмы и поможет выбрать следующий без долгого просмотра каталога."
            : "Найдите фильм через TMDB или заполните карточку вручную — данные останутся на этом устройстве."}</p>
          <button class="button button--ghost" type="button"
            ${statistics.movieCount ? 'data-view="wheel"' : 'data-action="movie-add"'}>
            ${statistics.movieCount ? "Запустить колесо" : "Открыть форму добавления"}
            <span aria-hidden="true">→</span>
          </button>
        </article>
      </div>
    </section>

    ${backupDue ? `
      <section class="notice backup-notice">
        <div>
          <p class="eyebrow">Резервная копия</p>
          <h2>${state.library.settings.lastBackupAt
            ? "Пора обновить резервную копию"
            : "Резервная копия ещё не создавалась"}</h2>
          <p>Библиотека хранится локально в браузере. Экспортируйте JSON
          сейчас или отложите напоминание на ${
            state.library.settings.backupReminderDays ?? 30
          } дней.</p>
        </div>
        <div class="notice-actions">
          <button class="button button--primary" type="button"
            data-action="backup-export">Скачать JSON</button>
          <button class="button button--ghost" type="button"
            data-action="backup-remind-later">Напомнить позже</button>
        </div>
      </section>
    ` : ""}

    ${legacyDataFound ? `
      <section class="notice">
        <p class="eyebrow">Найдена старая версия</p>
        <h2>Данные Movie Manager готовы к миграции</h2>
        <p>Откройте «Настройки» и нажмите «Перенести данные». Текущая
        библиотека при этом не удаляется.</p>
      </section>
    ` : ""}

  `;
}

function dashboardMetric(label, value, iconName) {
  const displayValue = typeof value === "number"
    ? value.toLocaleString("ru-RU")
    : escapeHtml(String(value ?? 0));
  return `
    <article class="dashboard-metric">
      <span class="dashboard-metric__icon">${ICONS[iconName]}</span>
      <span><strong>${displayValue}</strong>
        <small>${escapeHtml(label)}</small></span>
    </article>`;
}

function formatWatchedHours(minutes) {
  return (Math.round(((Number(minutes) || 0) / 60) * 10) / 10)
    .toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function dashboardMovieCard(movie) {
  return `
    <article class="recent-movie">
      <button type="button" data-action="movie-edit" data-id="${movie.id}"
        aria-label="Открыть ${escapeAttribute(movie.title)}">
        <span class="recent-movie__poster">
          ${movie.coverUrl
            ? `<img src="${escapeAttribute(movie.coverUrl)}" alt="" loading="lazy">`
            : `<span aria-hidden="true">${escapeHtml(movie.title.slice(0, 2).toUpperCase())}</span>`}
        </span>
        <strong>${escapeHtml(movie.title)}</strong>
        <small>${movie.releaseYear ?? "Год не указан"}</small>
      </button>
    </article>`;
}

function dashboardCollectionCard(franchise, movieById) {
  const movies = franchise.movieIds.map((id) => movieById.get(id)).filter(Boolean);
  const cover = movies.find((movie) => movie.coverUrl)?.coverUrl;
  return `
    <article class="dashboard-collection">
      <div class="dashboard-collection__image">
        ${cover
          ? `<img src="${escapeAttribute(cover)}" alt="" loading="lazy">`
          : '<span aria-hidden="true">CV</span>'}
      </div>
      <div>
        <h3>${escapeHtml(franchise.name)}</h3>
        <p>${movies.length} ${pluralize(movies.length, ["фильм", "фильма", "фильмов"])}</p>
        <button type="button" data-action="franchise-edit" data-id="${franchise.id}">
          Открыть коллекцию
        </button>
      </div>
    </article>`;
}

function watchedRow(movie, category) {
  const average = calculateAverageRating(movie.ratings);
  return `
    <article class="watched-row">
      <div class="watched-row__cover">
        ${movie.coverUrl
          ? `<img src="${escapeAttribute(movie.coverUrl)}" alt="" loading="lazy"
              referrerpolicy="no-referrer">`
          : '<span aria-hidden="true">CV</span>'}
      </div>
      <div class="watched-row__main">
        <p class="eyebrow">${escapeHtml(category?.name ?? "Без категории")}</p>
        <h3>${escapeHtml(movie.title)}</h3>
        <p class="card-meta">Просмотрен: ${formatDate(movie.watchedAt)}
          ${movie.durationMinutes ? ` · ${movie.durationMinutes} мин` : ""}</p>
        <div class="rating-list">
          ${(movie.ratings ?? []).map((rating) => `
            <span class="rating-chip">
              ${escapeHtml(rating.participantName)}: <strong>${rating.value}</strong>
              <button type="button" data-action="rating-delete"
                data-id="${movie.id}" data-rating-id="${rating.id}"
                aria-label="Удалить оценку">×</button>
            </span>
          `).join("") || '<span class="muted">Оценок пока нет</span>'}
        </div>
      </div>
      <div class="watched-row__aside">
        <strong class="watched-rating">${average === null ? "—" : `★ ${average}`}</strong>
        <button class="button button--primary" type="button"
          data-action="rating-add" data-id="${movie.id}">Оценить</button>
        <button class="button button--ghost" type="button"
          data-action="watch-edit" data-id="${movie.id}">Изменить дату</button>
        <button class="button button--danger" type="button"
          data-action="watch-remove" data-id="${movie.id}">Вернуть в каталог</button>
      </div>
    </article>
  `;
}

function movieCard(movie, category, franchise) {
  const rating = calculateAverageRating(movie.ratings);
  const cover = movie.coverUrl
    ? `<img src="${escapeAttribute(movie.coverUrl)}" alt="" loading="lazy"
        referrerpolicy="no-referrer">`
    : `<div class="movie-card__placeholder" aria-hidden="true">CV</div>`;

  return `
    <article class="movie-card">
      <div class="movie-card__cover">
        ${cover}
        <div class="card-actions card-actions--overlay">
          <button class="icon-button" type="button" data-action="movie-edit"
            data-id="${movie.id}" aria-label="Редактировать">✎</button>
          <button class="icon-button icon-button--danger" type="button"
            data-action="movie-delete" data-id="${movie.id}"
            aria-label="Удалить">×</button>
        </div>
      </div>
      <div class="movie-card__content">
        <p class="eyebrow">${escapeHtml(category?.name ?? "Без категории")}</p>
        <h3>${escapeHtml(movie.title)}</h3>
        <p class="card-meta">
          ${movie.releaseYear ?? "Год не указан"}
          ${movie.durationMinutes ? ` · ${movie.durationMinutes} мин` : ""}
        </p>
        ${(movie.genres ?? []).length
          ? `<p class="movie-card__genres">${escapeHtml(movie.genres.slice(0, 3).join(" · "))}</p>`
          : ""}
        ${franchise ? `<span class="tag">${escapeHtml(franchise.name)}</span>` : ""}
        <div class="movie-card__footer">
          <span>${movie.watchedAt ? "Просмотрен" : "Не просмотрен"}</span>
          <strong>${rating === null ? "—" : `★ ${rating}`}</strong>
        </div>
        ${!movie.watchedAt ? `
          <button class="text-button" type="button"
            data-action="watch-add" data-id="${movie.id}">
            Отметить просмотренным
          </button>
        ` : ""}
      </div>
    </article>
  `;
}

function categoryNode(category, library, depth) {
  const children = library.categories
    .filter((item) => item.parentId === category.id)
    .sort(sortByPosition);
  const queue = buildCategoryQueue(library, category.id);
  const movieCount = queue.filter((item) => item.type === "movie").length;
  const subtreeCategoryIds = new Set([
    category.id,
    ...getDescendantIds(library.categories, category.id),
  ]);
  const subtreeMovies = library.movies.filter((movie) =>
    subtreeCategoryIds.has(movie.categoryId),
  );
  const watchedCount = subtreeMovies.filter((movie) => movie.watchedAt).length;

  return `
    <section class="category-node" style="--depth:${depth}">
      <header class="category-node__header">
        <div>
          <p class="eyebrow">Квота колеса: ${category.rollQuota}</p>
          <h3>${escapeHtml(category.name)}</h3>
          <small>
            В ветке: ${subtreeMovies.length} · просмотрено: ${watchedCount} ·
            осталось: ${subtreeMovies.length - watchedCount} ·
            напрямую: ${movieCount}
          </small>
        </div>
        <div class="row-actions">
          <button class="icon-button" type="button" data-action="category-up"
            data-id="${category.id}" aria-label="Переместить выше">↑</button>
          <button class="icon-button" type="button" data-action="category-down"
            data-id="${category.id}" aria-label="Переместить ниже">↓</button>
          <button class="icon-button" type="button" data-action="category-child-add"
            data-id="${category.id}" aria-label="Добавить подкатегорию">+</button>
          <button class="icon-button" type="button" data-action="category-edit"
            data-id="${category.id}" aria-label="Редактировать">✎</button>
          <button class="icon-button icon-button--danger" type="button"
            data-action="category-delete" data-id="${category.id}"
            aria-label="Удалить">×</button>
        </div>
      </header>
      ${queue.length ? `
        <ol class="queue-list">
          ${queue.map((item, index) => `
            <li>
              <span class="queue-list__number">${index + 1}</span>
              <span>
                ${escapeHtml(item.title)}
                ${item.type === "franchise" ? '<small class="queue-kind">Франшиза</small>' : ""}
              </span>
              <span class="queue-list__actions">
                <button class="mini-button" type="button"
                  data-action="${item.type}-up"
                  data-id="${item.id}" aria-label="Выше">↑</button>
                <button class="mini-button" type="button"
                  data-action="${item.type}-down"
                  data-id="${item.id}" aria-label="Ниже">↓</button>
              </span>
            </li>
          `).join("")}
        </ol>
      ` : ""}
      ${children.length ? `
        <div class="category-node__children">
          ${children.map((child) => categoryNode(child, library, depth + 1)).join("")}
        </div>
      ` : ""}
    </section>
  `;
}

function emptyBlock(title, text) {
  return `
    <section class="empty-state empty-state--compact">
      <div class="empty-state__icon">✦</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(text)}</p>
    </section>
  `;
}

function sortByPosition(a, b) {
  return a.position - b.position || a.name.localeCompare(b.name, "ru-RU");
}

function getMovieSorter(sort) {
  if (sort === "year") {
    return (a, b) =>
      (b.releaseYear ?? -1) - (a.releaseYear ?? -1) ||
      a.title.localeCompare(b.title, "ru-RU");
  }
  if (sort === "rating") {
    return (a, b) =>
      (calculateAverageRating(b.ratings) ?? -1) -
        (calculateAverageRating(a.ratings) ?? -1) ||
      a.title.localeCompare(b.title, "ru-RU");
  }
  if (sort === "queue") {
    return (a, b) =>
      String(a.categoryId ?? "").localeCompare(String(b.categoryId ?? "")) ||
      a.categoryPosition - b.categoryPosition;
  }
  return (a, b) => a.title.localeCompare(b.title, "ru-RU");
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

function getViewTitle(view) {
  if (view === "dashboard") return "Моя библиотека";
  return NAV_ITEMS.find(([id]) => id === view)?.[1] ?? "CineVault";
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
  root.querySelectorAll(".movie-card__cover img, .watched-row__cover img, .dashboard-hero img, .recent-movie img, .dashboard-collection img")
    .forEach((image) => {
      image.addEventListener("error", () => {
        image.hidden = true;
        const parent = image.parentElement;
        if (parent && !parent.querySelector(".image-error")) {
          const fallback = document.createElement("span");
          fallback.className = "image-error";
          fallback.textContent = "Постер недоступен";
          parent.append(fallback);
        }
      }, { once: true });
    });
}
