import { APP_NAME, APP_VERSION } from "../config.js";
import { calculateAverageRating } from "../domain/entities.js";
import {
  buildCategoryQueue,
  getMovieFranchiseMap,
} from "../domain/libraryRules.js";
import { setupDialog } from "./dialog.js";
import { drawWheel } from "./wheelCanvas.js";

const NAV_ITEMS = [
  ["dashboard", "Главная", "⌂"],
  ["catalog", "Каталог", "▦"],
  ["categories", "Категории", "☷"],
  ["franchises", "Франшизы", "◫"],
  ["watched", "Просмотренные", "✓"],
  ["wheel", "Колесо", "◉"],
  ["sessions", "История роллов", "↺"],
  ["settings", "Настройки", "⚙"],
];

export function renderAppShell(root, state) {
  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <button class="brand" type="button" data-view="dashboard">
          <span class="brand__mark">CV</span>
          <span class="brand__name">CINE<span>VAULT</span></span>
        </button>

        <nav class="navigation" aria-label="Основная навигация">
          ${NAV_ITEMS.map(([id, label, icon]) => `
            <button
              class="navigation__item ${state.view === id ? "is-active" : ""}"
              type="button"
              data-view="${id}"
            >
              <span aria-hidden="true">${icon}</span>
              <span>${label}</span>
            </button>
          `).join("")}
        </nav>

        <div class="sidebar__footer">
          <span>Локальная база</span>
          <strong>v${APP_VERSION}</strong>
        </div>
      </aside>

      <main class="main-area">
        <header class="topbar">
          <div>
            <p class="eyebrow">${APP_NAME}</p>
            <h1>${escapeHtml(getViewTitle(state.view))}</h1>
          </div>
          <div class="storage-status ${state.error ? "is-error" : ""}">
            <span class="storage-status__dot"></span>
            ${state.error ? "Ошибка хранилища" : "Сохранение включено"}
          </div>
        </header>

        <section class="content" id="view-content"></section>
      </main>

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

  setupDialog();
  const wheelCanvas = root.querySelector("#wheel-canvas");
  if (wheelCanvas) {
    drawWheel(
      wheelCanvas,
      state.activeSession?.pool ?? state.rollDraftPool,
    );
  }
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
    renderDashboard(container, state.statistics, state.legacyDataFound);
    return;
  }

  if (state.view === "catalog") {
    renderCatalog(container, state.library);
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

function renderCatalog(container, library) {
  const categories = new Map(
    library.categories.map((category) => [category.id, category]),
  );
  const franchiseByMovieId = getMovieFranchiseMap(library.franchises);
  const movies = [...library.movies].sort((a, b) =>
    a.title.localeCompare(b.title, "ru-RU"),
  );

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

function renderDashboard(container, statistics, legacyDataFound) {
  container.innerHTML = `
    ${legacyDataFound ? `
      <section class="notice">
        <p class="eyebrow">Найдена старая версия</p>
        <h2>Данные Movie Manager готовы к миграции</h2>
        <p>Импорт появится на этапе переноса данных. Исходные записи пока
        не изменяются.</p>
      </section>
    ` : ""}

    <div class="metric-grid">
      ${metricCard("Фильмов", statistics.movieCount, "Вся библиотека")}
      ${metricCard("Просмотрено", statistics.watchedMovieCount, "Без повторных просмотров")}
      ${metricCard("В очереди", statistics.unwatchedMovieCount, "Ожидают выбора")}
      ${metricCard("Категорий", statistics.categoryCount, "Включая подкатегории")}
      ${metricCard("Средняя оценка", statistics.libraryAverageRating ?? "—", "По всем оценкам")}
      ${metricCard("Оценок", statistics.totalRatingCount, "От всех зрителей")}
      ${metricCard("Франшиз", statistics.franchiseCount, "Коллекции фильмов")}
      ${metricCard("Просмотрено часов", formatHours(statistics.watchedDurationMinutes), "По указанной длительности")}
    </div>

    <div class="dashboard-grid">
      <section class="panel">
        <p class="eyebrow">Библиотека</p>
        <h2>${statistics.highestRatedMovie
          ? `Лидер: ${escapeHtml(statistics.highestRatedMovie.movie.title)}`
          : "База готова к наполнению"}</h2>
        <p>${statistics.highestRatedMovie
          ? `Средняя оценка ${statistics.highestRatedMovie.rating}. Худший оценённый фильм: ${
              escapeHtml(statistics.lowestRatedMovie.movie.title)
            } (${statistics.lowestRatedMovie.rating}).`
          : "Автоматические демонстрационные фильмы отключены. Пустая библиотека является нормальным состоянием."}</p>
      </section>

      <section class="panel panel--accent">
        <p class="eyebrow">Следующий этап</p>
        <h2>Каталог и очереди</h2>
        <p>Добавим создание фильмов, дерево категорий и ручной порядок,
        который будет определять состав будущего колеса.</p>
      </section>
    </div>
  `;
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

function metricCard(label, value, description) {
  const displayValue = typeof value === "number"
    ? value.toLocaleString("ru-RU")
    : escapeHtml(value);
  return `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${displayValue}</strong>
      <small>${escapeHtml(description)}</small>
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

  return `
    <section class="category-node" style="--depth:${depth}">
      <header class="category-node__header">
        <div>
          <p class="eyebrow">Квота колеса: ${category.rollQuota}</p>
          <h3>${escapeHtml(category.name)}</h3>
          <small>${movieCount} фильмов · ${children.length} подкатегорий</small>
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

function formatHours(minutes) {
  if (!minutes) return "0";
  return Math.round((minutes / 60) * 10) / 10;
}

function getViewTitle(view) {
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
