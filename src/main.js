import { LEGACY_STORAGE_KEYS, STORE_NAMES } from "./config.js";
import { initializeDatabase } from "./data/database.js";
import {
  commitLibraryChanges,
  deleteFranchiseRecord,
  loadLibrary,
  saveCategory,
  saveFranchise,
  saveMovie,
  saveParticipant,
  saveRollSession,
} from "./data/libraryRepository.js";
import {
  createCategory,
  createFranchise,
  createMovie,
  createParticipant,
  normalizeText,
  upsertRating,
} from "./domain/entities.js";
import {
  buildCategoryDeletionCommands,
  buildMovieDeletionCommands,
  buildWinnerWatchCommands,
  findDuplicateCategory,
  findDuplicateMovie,
  getMovieFranchiseMap,
  moveCategoryQueueEntity,
  moveWithinGroup,
  reorderFranchiseMovie,
} from "./domain/libraryRules.js";
import {
  buildRollPool,
  confirmElimination,
  createRollSession,
  rerollSession,
  restoreEliminated,
  shufflePool,
  spinSession,
  useSave,
} from "./domain/rollEngine.js";
import { buildLibraryStatistics } from "./domain/statistics.js";
import { renderAppShell } from "./ui/appShell.js";
import { openDialog } from "./ui/dialog.js";
import { animateWheel } from "./ui/wheelCanvas.js";

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
  rollDraftPool: [],
  activeSession: null,
  isSpinning: false,
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
    state.rollDraftPool = buildRollPool(state.library);
  } catch (error) {
    console.error(error);
    state.error = error instanceof Error ? error : new Error(String(error));
  }

  render();
  window.addEventListener("keydown", handleGlobalKeydown);
}

function render() {
  renderAppShell(root, state);
}

async function reloadLibrary() {
  state.library = await loadLibrary();
  state.statistics = buildLibraryStatistics(state.library);
  if (!state.activeSession) {
    state.rollDraftPool = buildRollPool(state.library);
  }
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
    "franchise-member-up": () =>
      moveFranchiseMember(payload.id, payload.movieId, -1),
    "franchise-member-down": () =>
      moveFranchiseMember(payload.id, payload.movieId, 1),
    "roll-shuffle": () => shuffleRollDraft(),
    "roll-configure": () => openRollConfiguration(),
    "roll-spin": () => spinActiveSession(),
    "roll-reroll": () => rerollActiveSession(),
    "roll-save": () => savePendingParticipant(payload.id),
    "roll-confirm-elimination": () => eliminatePendingParticipant(),
    "roll-restore": () =>
      restoreRollParticipant(payload.entityType, payload.id),
    "watch-add": () => openWatchDateDialog(payload.id),
    "watch-edit": () => openWatchDateDialog(payload.id),
    "watch-remove": () => confirmWatchRemoval(payload.id),
    "rating-add": () => openRatingDialog(payload.id),
    "rating-delete": () => confirmRatingDeletion(payload.id, payload.ratingId),
  };

  await handlers[action]?.();
}

function openWatchDateDialog(movieId) {
  const movie = state.library.movies.find((item) => item.id === movieId);
  if (!movie) return;

  openDialog({
    title: movie.watchedAt ? "Изменить дату просмотра" : "Отметить просмотренным",
    body: `
      <p class="confirmation-text">${escapeHtml(movie.title)}</p>
      <label class="field">
        <span>Дата просмотра</span>
        <input name="watchedDate" type="date" required
          value="${toDateInput(movie.watchedAt ?? new Date().toISOString())}">
      </label>
    `,
    onSubmit: async (formData) => {
      const watchedAt = dateInputToIso(formData.get("watchedDate"));
      await saveMovie({
        ...movie,
        watchedAt,
        updatedAt: new Date().toISOString(),
      });
      await reloadLibrary();
    },
  });
}

function confirmWatchRemoval(movieId) {
  const movie = state.library.movies.find((item) => item.id === movieId);
  if (!movie) return;

  openConfirmation(
    "Вернуть фильм в каталог?",
    `Дата просмотра «${movie.title}» будет удалена. Существующие оценки сохранятся.`,
    async () => {
      await saveMovie({
        ...movie,
        watchedAt: null,
        updatedAt: new Date().toISOString(),
      });
      await reloadLibrary();
    },
    "Вернуть",
  );
}

function openRatingDialog(movieId) {
  const movie = state.library.movies.find((item) => item.id === movieId);
  if (!movie) return;
  const names = new Set([
    ...state.library.participants.map((participant) => participant.name),
    ...(movie.ratings ?? []).map((rating) => rating.participantName),
  ]);

  openDialog({
    title: "Оценить фильм",
    body: `
      <p class="confirmation-text">${escapeHtml(movie.title)}</p>
      <label class="field">
        <span>Имя зрителя</span>
        <input name="participantName" required maxlength="80"
          list="rating-participant-names">
        <datalist id="rating-participant-names">
          ${[...names].map((name) =>
            `<option value="${escapeAttribute(name)}"></option>`
          ).join("")}
        </datalist>
      </label>
      <label class="field">
        <span>Оценка от 1 до 10, шаг 0,5</span>
        <input name="ratingValue" type="number" required min="1" max="10"
          step="0.5" value="8">
      </label>
      <p class="form-hint">Если этот зритель уже оценивал фильм, старая
      оценка будет заменена.</p>
    `,
    onSubmit: async (formData) => {
      const participantName = formData.get("participantName");
      const ratings = upsertRating(movie.ratings, {
        participantName,
        value: formData.get("ratingValue"),
      });
      await saveMovie({
        ...movie,
        ratings,
        updatedAt: new Date().toISOString(),
      });
      await rememberParticipants([{ name: participantName, saves: 0 }]);
      await reloadLibrary();
    },
  });
}

function confirmRatingDeletion(movieId, ratingId) {
  const movie = state.library.movies.find((item) => item.id === movieId);
  const rating = movie?.ratings.find((item) => item.id === ratingId);
  if (!movie || !rating) return;

  openConfirmation(
    "Удалить оценку?",
    `Оценка ${rating.value} от «${rating.participantName}» будет удалена.`,
    async () => {
      await saveMovie({
        ...movie,
        ratings: movie.ratings.filter((item) => item.id !== ratingId),
        updatedAt: new Date().toISOString(),
      });
      await reloadLibrary();
    },
  );
}

function shuffleRollDraft() {
  state.rollDraftPool = shufflePool(state.rollDraftPool);
  render();
}

function openRollConfiguration() {
  if (state.rollDraftPool.length < 2) {
    throw new Error("Настройте квоты так, чтобы в пул попало минимум два участника.");
  }
  const knownNames = state.library.participants
    .sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)))
    .map((participant) => participant.name);

  openDialog({
    title: "Настройка сессии",
    submitLabel: "Начать",
    body: `
      <p class="form-hint">Укажите игроков и количество сейвов. Пустые строки
      будут пропущены.</p>
      ${[0, 1, 2, 3].map((index) => `
        <div class="field-row player-row">
          <label class="field">
            <span>Игрок ${index + 1}</span>
            <input name="playerName${index}" maxlength="80"
              value="${escapeAttribute(knownNames[index] ?? (index < 2 ? `Игрок ${index + 1}` : ""))}">
          </label>
          <label class="field">
            <span>Сейвы</span>
            <input name="playerSaves${index}" type="number" min="0" max="99"
              value="${index < 2 ? 3 : 0}">
          </label>
        </div>
      `).join("")}
      <label class="field">
        <span>Сейвы работают, пока участников больше</span>
        <input name="saveThreshold" type="number" min="1"
          max="${state.rollDraftPool.length - 1}"
          value="${Math.min(3, state.rollDraftPool.length - 1)}">
      </label>
    `,
    onSubmit: async (formData) => {
      const participants = [0, 1, 2, 3]
        .map((index) => ({
          name: formData.get(`playerName${index}`),
          saves: formData.get(`playerSaves${index}`),
        }))
        .filter((participant) => String(participant.name).trim());

      state.activeSession = createRollSession({
        pool: state.rollDraftPool,
        participants,
        savesEnabledAboveRemaining: formData.get("saveThreshold"),
      });
      await rememberParticipants(participants);
      render();
    },
  });
}

async function spinActiveSession() {
  if (
    !state.activeSession ||
    state.activeSession.pendingIndex !== null ||
    state.isSpinning
  ) {
    return;
  }
  state.isSpinning = true;
  render();
  try {
    const nextSession = spinSession(state.activeSession);
    const canvas = document.querySelector("#wheel-canvas");
    await animateWheel(
      canvas,
      state.activeSession.pool,
      nextSession.pendingIndex,
    );
    state.activeSession = nextSession;
  } finally {
    state.isSpinning = false;
    render();
  }
}

async function rerollActiveSession() {
  if (!state.activeSession) return;
  state.activeSession = rerollSession(state.activeSession);
  render();
  await spinActiveSession();
}

function savePendingParticipant(participantId) {
  state.activeSession = useSave(state.activeSession, participantId);
  render();
}

async function eliminatePendingParticipant() {
  const nextSession = confirmElimination(state.activeSession);
  if (nextSession.status === "completed") {
    await finishRollSession(nextSession);
    return;
  }
  state.activeSession = nextSession;
  render();
}

function restoreRollParticipant(entityType, entityId) {
  state.activeSession = restoreEliminated(
    state.activeSession,
    entityType,
    entityId,
  );
  render();
}

async function finishRollSession(session) {
  const watchedAt = session.completedAt ?? new Date().toISOString();
  const commands = buildWinnerWatchCommands(
    state.library,
    session.winner,
    watchedAt,
  );

  if (commands.length) {
    await commitLibraryChanges(commands);
  }
  await saveRollSession(session);
  const winner = session.winner;
  state.activeSession = null;
  state.view = "watched";
  await reloadLibrary();

  openDialog({
    title: "Победитель определён",
    submitLabel: "Продолжить",
    body: `
      <div class="winner-dialog">
        <div class="confetti" aria-hidden="true">
          ${Array.from({ length: 28 }, (_, index) =>
            `<i style="--i:${index}"></i>`
          ).join("")}
        </div>
        <div class="winner-dialog__trophy">★</div>
        <p class="eyebrow">${winner.type === "franchise" ? "Франшиза" : "Фильм"}</p>
        <h3>${escapeHtml(winner.title)}</h3>
        <p>Участник перенесён в просмотренные. Оценку можно добавить позже.</p>
      </div>
    `,
    onSubmit: async () => {},
  });
}

async function rememberParticipants(participants) {
  const existingByName = new Map(
    state.library.participants.map((participant) => [
      participant.normalizedName,
      participant,
    ]),
  );
  await Promise.all(
    participants.map((participant) => {
      const normalizedName = normalizeText(participant.name);
      return saveParticipant(createParticipant({
        ...(existingByName.get(normalizedName) ?? {}),
        name: participant.name,
        lastUsedAt: new Date().toISOString(),
      }));
    }),
  );
  state.library.participants = await loadLibrary()
    .then((library) => library.participants);
}

function handleGlobalKeydown(event) {
  if (
    event.code !== "Space" ||
    event.repeat ||
    state.view !== "wheel" ||
    !state.activeSession ||
    state.activeSession.pendingIndex !== null ||
    state.isSpinning ||
    document.querySelector("dialog[open]") ||
    ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(
      document.activeElement?.tagName,
    )
  ) {
    return;
  }
  event.preventDefault();
  spinActiveSession().catch(showUnexpectedError);
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

async function moveFranchiseMember(franchiseId, movieId, direction) {
  const franchise = state.library.franchises.find(
    (item) => item.id === franchiseId,
  );
  const updated = reorderFranchiseMovie(franchise, movieId, direction);
  if (!updated) return;
  await saveFranchise(updated);
  await reloadLibrary();
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

function openConfirmation(title, message, onConfirm, submitLabel = "Удалить") {
  openDialog({
    title,
    submitLabel,
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

function toDateInput(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateInputToIso(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) {
    throw new Error("Укажите корректную дату просмотра.");
  }
  const [, year, month, day] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    12,
    0,
    0,
  ).toISOString();
}

function detectLegacyData() {
  try {
    return LEGACY_STORAGE_KEYS.some((key) => localStorage.getItem(key) !== null);
  } catch {
    return false;
  }
}
