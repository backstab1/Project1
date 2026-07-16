import { LEGACY_STORAGE_KEYS, STORE_NAMES } from "./config.js";
import { initializeDatabase } from "./data/database.js";
import {
  commitLibraryChanges,
  deleteFranchiseRecord,
  loadLibrary,
  saveCategory,
  saveFranchise,
  saveMovie,
} from "./data/libraryRepository.js";
import {
  createCategory,
  createFranchise,
  createMovie,
  normalizeText,
} from "./domain/entities.js";
import {
  buildCategoryDeletionCommands,
  buildMovieDeletionCommands,
  findDuplicateCategory,
  findDuplicateMovie,
  getMovieFranchiseMap,
  moveCategoryQueueEntity,
  moveWithinGroup,
} from "./domain/libraryRules.js";
import { buildLibraryStatistics } from "./domain/statistics.js";
import { renderAppShell } from "./ui/appShell.js";
import { openDialog } from "./ui/dialog.js";

const root = document.querySelector("#app");

const state = {
  view: "dashboard",
  library: {
    movies: [],
    categories: [],
    franchises: [],
    participants: [],
    rollSessions: [],
  },
  statistics: {
    movieCount: 0,
    watchedMovieCount: 0,
    unwatchedMovieCount: 0,
    categoryCount: 0,
  },
  legacyDataFound: detectLegacyData(),
  error: null,
  onNavigate(view) {
    state.view = view;
    render();
  },
  onAction(action, payload) {
    handleAction(action, payload).catch(showUnexpectedError);
  },
};

start();

async function start() {
  try {
    await initializeDatabase();
    state.library = await loadLibrary();
    state.statistics = buildLibraryStatistics(state.library);
  } catch (error) {
    console.error(error);
    state.error = error instanceof Error ? error : new Error(String(error));
  }

  render();
}

function render() {
  renderAppShell(root, state);
}

async function reloadLibrary() {
  state.library = await loadLibrary();
  state.statistics = buildLibraryStatistics(state.library);
  render();
}

async function handleAction(action, payload) {
  const handlers = {
    "movie-add": () => openMovieDialog(),
    "movie-edit": () => openMovieDialog(payload.id),
    "movie-delete": () => confirmMovieDeletion(payload.id),
    "movie-up": () => moveMovie(payload.id, -1),
    "movie-down": () => moveMovie(payload.id, 1),
    "franchise-up": () => moveFranchise(payload.id, -1),
    "franchise-down": () => moveFranchise(payload.id, 1),
    "category-add": () => openCategoryDialog(),
    "category-child-add": () => openCategoryDialog(null, payload.id),
    "category-edit": () => openCategoryDialog(payload.id),
    "category-delete": () => confirmCategoryDeletion(payload.id),
    "category-up": () => moveCategory(payload.id, -1),
    "category-down": () => moveCategory(payload.id, 1),
    "franchise-add": () => openFranchiseDialog(),
    "franchise-edit": () => openFranchiseDialog(payload.id),
    "franchise-delete": () => confirmFranchiseDeletion(payload.id),
  };

  await handlers[action]?.();
}

function openMovieDialog(movieId = null) {
  const movie = state.library.movies.find((item) => item.id === movieId);
  const categoryOptions = buildCategoryOptions(movie?.categoryId);

  openDialog({
    title: movie ? "Редактировать фильм" : "Добавить фильм",
    body: `
      <label class="field">
        <span>Название *</span>
        <input name="title" required maxlength="180"
          value="${escapeAttribute(movie?.title ?? "")}">
      </label>
      <label class="field">
        <span>Оригинальное название</span>
        <input name="originalTitle" maxlength="180"
          value="${escapeAttribute(movie?.originalTitle ?? "")}">
      </label>
      <label class="field">
        <span>Категория</span>
        <select name="categoryId">
          <option value="">Без категории</option>
          ${categoryOptions}
        </select>
      </label>
      <div class="field-row">
        <label class="field">
          <span>Год</span>
          <input name="releaseYear" type="number" min="1888" max="2200"
            value="${movie?.releaseYear ?? ""}">
        </label>
        <label class="field">
          <span>Продолжительность, мин</span>
          <input name="durationMinutes" type="number" min="1" max="2000"
            value="${movie?.durationMinutes ?? ""}">
        </label>
      </div>
      <label class="field">
        <span>Страна</span>
        <input name="country" maxlength="100"
          value="${escapeAttribute(movie?.country ?? "")}">
      </label>
      <label class="field">
        <span>URL постера</span>
        <input name="coverUrl" type="url" maxlength="2000"
          value="${escapeAttribute(movie?.coverUrl ?? "")}">
      </label>
    `,
    onSubmit: async (formData) => {
      const categoryId = formData.get("categoryId") || null;
      const candidate = {
        ...(movie ?? {}),
        title: formData.get("title"),
        originalTitle: formData.get("originalTitle"),
        categoryId,
        coverUrl: formData.get("coverUrl"),
        releaseYear: formData.get("releaseYear"),
        durationMinutes: formData.get("durationMinutes"),
        country: formData.get("country"),
      };
      const duplicate = findDuplicateMovie(
        state.library.movies,
        candidate,
        movie?.id,
      );
      if (duplicate) {
        throw new Error(`Фильм «${duplicate.title}» уже есть в библиотеке.`);
      }

      if (!movie || movie.categoryId !== categoryId) {
        candidate.categoryPosition = getNextMoviePosition(categoryId);
      }

      await saveMovie(createMovie(candidate));
      await reloadLibrary();
    },
  });
}

function openCategoryDialog(categoryId = null, requestedParentId = null) {
  const category = state.library.categories.find((item) => item.id === categoryId);
  const excludedIds = category ? getCategoryDescendantIds(category.id) : new Set();
  if (category) {
    excludedIds.add(category.id);
  }
  const selectedParentId = category?.parentId ?? requestedParentId ?? null;

  openDialog({
    title: category ? "Редактировать категорию" : "Новая категория",
    body: `
      <label class="field">
        <span>Название *</span>
        <input name="name" required maxlength="120"
          value="${escapeAttribute(category?.name ?? "")}">
      </label>
      <label class="field">
        <span>Родительская категория</span>
        <select name="parentId">
          <option value="">Корневая категория</option>
          ${buildCategoryOptions(selectedParentId, excludedIds)}
        </select>
      </label>
      <label class="field">
        <span>Количество элементов в колесе</span>
        <input name="rollQuota" type="number" min="0" max="500"
          value="${category?.rollQuota ?? 0}">
      </label>
    `,
    onSubmit: async (formData) => {
      const parentId = formData.get("parentId") || null;
      const candidate = {
        ...(category ?? {}),
        name: formData.get("name"),
        parentId,
        rollQuota: Number.parseInt(formData.get("rollQuota"), 10) || 0,
      };
      const duplicate = findDuplicateCategory(
        state.library.categories,
        {
          ...candidate,
          normalizedName: normalizeText(candidate.name),
        },
        category?.id,
      );
      if (duplicate) {
        throw new Error("Категория с таким названием уже существует на этом уровне.");
      }

      if (!category || category.parentId !== parentId) {
        candidate.position = getNextCategoryPosition(parentId);
      }

      await saveCategory(createCategory(candidate));
      await reloadLibrary();
    },
  });
}

function openFranchiseDialog(franchiseId = null) {
  const franchise = state.library.franchises.find(
    (item) => item.id === franchiseId,
  );
  const membership = getMovieFranchiseMap(state.library.franchises);
  const availableMovies = state.library.movies.filter((movie) => {
    const owner = membership.get(movie.id);
    return !owner || owner.id === franchiseId;
  });

  openDialog({
    title: franchise ? "Редактировать франшизу" : "Новая франшиза",
    body: `
      <label class="field">
        <span>Название *</span>
        <input name="name" required maxlength="160"
          value="${escapeAttribute(franchise?.name ?? "")}">
      </label>
      <label class="field">
        <span>Категория</span>
        <select name="categoryId">
          <option value="">Без категории</option>
          ${buildCategoryOptions(franchise?.categoryId)}
        </select>
      </label>
      <fieldset class="field checkbox-list">
        <legend>Фильмы и порядок</legend>
        ${availableMovies.length
          ? availableMovies.map((movie) => `
              <label>
                <input type="checkbox" name="movieIds" value="${movie.id}"
                  ${franchise?.movieIds.includes(movie.id) ? "checked" : ""}>
                <span>${escapeHtml(movie.title)}</span>
              </label>
            `).join("")
          : "<p class=\"muted\">Свободных фильмов пока нет.</p>"}
      </fieldset>
      <p class="form-hint">Порядок выбранных фильмов пока соответствует порядку
      списка. Отдельное перетаскивание добавим следующим улучшением.</p>
    `,
    onSubmit: async (formData) => {
      const name = String(formData.get("name"));
      const duplicate = state.library.franchises.find(
        (item) =>
          item.id !== franchiseId &&
          item.normalizedName === normalizeText(name),
      );
      if (duplicate) {
        throw new Error("Франшиза с таким названием уже существует.");
      }

      const categoryId = formData.get("categoryId") || null;
      const candidate = {
        ...(franchise ?? {}),
        name,
        categoryId,
        movieIds: formData.getAll("movieIds"),
      };
      if (!franchise || franchise.categoryId !== categoryId) {
        candidate.categoryPosition = getNextFranchisePosition(categoryId);
      }

      await saveFranchise(createFranchise(candidate));
      await reloadLibrary();
    },
  });
}

function confirmMovieDeletion(movieId) {
  const movie = state.library.movies.find((item) => item.id === movieId);
  if (!movie) return;

  openConfirmation(
    "Удалить фильм?",
    `«${movie.title}» будет удалён из библиотеки и всех франшиз.`,
    async () => {
      await commitLibraryChanges(
        buildMovieDeletionCommands(state.library, movieId),
      );
      await reloadLibrary();
    },
  );
}

function confirmCategoryDeletion(categoryId) {
  const category = state.library.categories.find((item) => item.id === categoryId);
  if (!category) return;

  openConfirmation(
    "Удалить категорию?",
    `Фильмы из «${category.name}» перейдут в «Без категории», а дочерние категории поднимутся на уровень выше.`,
    async () => {
      await commitLibraryChanges(
        buildCategoryDeletionCommands(state.library, categoryId),
      );
      await reloadLibrary();
    },
  );
}

function confirmFranchiseDeletion(franchiseId) {
  const franchise = state.library.franchises.find(
    (item) => item.id === franchiseId,
  );
  if (!franchise) return;

  openConfirmation(
    "Удалить франшизу?",
    `Франшиза «${franchise.name}» будет удалена. Входящие фильмы останутся в библиотеке.`,
    async () => {
      await deleteFranchiseRecord(franchiseId);
      await reloadLibrary();
    },
  );
}

async function moveMovie(movieId, direction) {
  await commitQueueMove(
    moveCategoryQueueEntity(state.library, "movie", movieId, direction),
  );
}

async function moveFranchise(franchiseId, direction) {
  await commitQueueMove(
    moveCategoryQueueEntity(
      state.library,
      "franchise",
      franchiseId,
      direction,
    ),
  );
}

async function moveCategory(categoryId, direction) {
  const updates = moveWithinGroup(
    state.library.categories,
    categoryId,
    direction,
    "parentId",
    "position",
  );
  await commitPositionUpdates(STORE_NAMES.categories, updates);
}

async function commitPositionUpdates(storeName, updates) {
  if (updates.length === 0) return;
  await commitLibraryChanges(
    updates.map((value) => ({ type: "put", storeName, value })),
  );
  await reloadLibrary();
}

async function commitQueueMove(commands) {
  if (commands.length === 0) return;
  await commitLibraryChanges(commands);
  await reloadLibrary();
}

function openConfirmation(title, message, onConfirm) {
  openDialog({
    title,
    submitLabel: "Удалить",
    body: `<p class="confirmation-text">${escapeHtml(message)}</p>`,
    onSubmit: onConfirm,
  });
}

function buildCategoryOptions(selectedId = null, excludedIds = new Set()) {
  const childrenByParent = new Map();
  for (const category of state.library.categories) {
    const parentId = category.parentId ?? null;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(category);
  }
  for (const children of childrenByParent.values()) {
    children.sort((a, b) => a.position - b.position);
  }

  const renderLevel = (parentId, depth) =>
    (childrenByParent.get(parentId) ?? [])
      .filter((category) => !excludedIds.has(category.id))
      .map((category) => `
        <option value="${category.id}" ${category.id === selectedId ? "selected" : ""}>
          ${escapeHtml(`${"— ".repeat(depth)}${category.name}`)}
        </option>
        ${renderLevel(category.id, depth + 1)}
      `).join("");

  return renderLevel(null, 0);
}

function getCategoryDescendantIds(categoryId) {
  const ids = new Set();
  const visit = (parentId) => {
    for (const category of state.library.categories) {
      if (category.parentId === parentId && !ids.has(category.id)) {
        ids.add(category.id);
        visit(category.id);
      }
    }
  };
  visit(categoryId);
  return ids;
}

function getNextMoviePosition(categoryId) {
  return getNextQueuePosition(categoryId);
}

function getNextCategoryPosition(parentId) {
  return nextPosition(
    state.library.categories.filter(
      (category) => (category.parentId ?? null) === (parentId ?? null),
    ),
    "position",
  );
}

function getNextFranchisePosition(categoryId) {
  return getNextQueuePosition(categoryId);
}

function getNextQueuePosition(categoryId) {
  return nextPosition(
    [
      ...state.library.movies.filter((movie) => movie.categoryId === categoryId),
      ...state.library.franchises.filter(
        (franchise) => franchise.categoryId === categoryId,
      ),
    ],
    "categoryPosition",
  );
}

function nextPosition(items, field) {
  return items.length === 0
    ? 0
    : Math.max(...items.map((item) => item[field] ?? 0)) + 1;
}

function showUnexpectedError(error) {
  console.error(error);
  openDialog({
    title: "Произошла ошибка",
    submitLabel: "Закрыть",
    body: `<p class="confirmation-text">${escapeHtml(
      error instanceof Error ? error.message : String(error),
    )}</p>`,
    onSubmit: async () => {},
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

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function detectLegacyData() {
  try {
    return LEGACY_STORAGE_KEYS.some((key) => localStorage.getItem(key) !== null);
  } catch {
    return false;
  }
}
