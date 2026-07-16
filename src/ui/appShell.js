import { APP_NAME, APP_VERSION } from "../config.js";

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
    </div>
  `;

  root.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => state.onNavigate(button.dataset.view));
  });

  renderCurrentView(root.querySelector("#view-content"), state);
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
    </div>

    <div class="dashboard-grid">
      <section class="panel">
        <p class="eyebrow">Библиотека</p>
        <h2>База готова к наполнению</h2>
        <p>Автоматические демонстрационные фильмы отключены. Пустая библиотека
        теперь является нормальным состоянием и не заполнится снова после
        перезапуска.</p>
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

function metricCard(label, value, description) {
  return `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${Number(value).toLocaleString("ru-RU")}</strong>
      <small>${escapeHtml(description)}</small>
    </article>
  `;
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

