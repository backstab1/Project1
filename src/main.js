import { LEGACY_STORAGE_KEYS, STORE_NAMES } from "./config.js";
import { initializeDatabase } from "./data/database.js";
import {
  commitLibraryChanges,
  deleteFranchiseRecord,
  deleteParticipantRecord,
  loadLibrary,
  saveCategory,
  saveFranchise,
  saveMovie,
  saveParticipant,
  saveRollSession,
  saveSetting,
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
import {
  cacheTmdbPoster,
  clearTmdbToken,
  configureTmdbToken,
  getTmdbMovie,
  getTmdbStatus,
  searchTmdbMovies,
  tmdbPosterPreviewUrl,
} from "./services/tmdbClient.js";
import {
  createBackup,
  mergeLibraries,
  parseBackup,
  readLegacyLocalStorage,
} from "./domain/backup.js";
import {
  parseDelimitedText,
  tableRowsToLibrary,
} from "./domain/spreadsheetImport.js";
import { createReminderDismissalDate } from "./domain/backupReminder.js";
import { renderAppShell } from "./ui/appShell.js";
import { openDialog } from "./ui/dialog.js";
import { animateWheel } from "./ui/wheelCanvas.js";
import { showToast } from "./ui/toast.js";

const root = document.querySelector("#app");
const VIEW_IDS = new Set([
  "dashboard",
  "catalog",
  "categories",
  "franchises",
  "watched",
  "wheel",
  "sessions",
  "settings",
]);

function readViewFromHash() {
  const view = location.hash.slice(1);
  return VIEW_IDS.has(view) ? view : "dashboard";
}

const state = {
  view: readViewFromHash(),
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
  catalogFilters: {
    query: "",
    categoryId: "",
    status: "all",
    sort: "title",
  },
  focusControl: null,
  tmdbStatus: { configured: false, loading: true, error: null },
  error: null,
  onNavigate(view) {
    if (!VIEW_IDS.has(view)) return;
    state.view = view;
    state.focusControl = null;
    if (location.hash !== `#${view}`) {
      history.pushState(null, "", `#${view}`);
    }
    render();
  },
  onAction(action, payload) {
    handleAction(action, payload).catch(showUnexpectedError);
  },
  onControl(control, payload) {
    handleControl(control, payload).catch(showUnexpectedError);
  },
};

start();

async function start() {
  try {
    await initializeDatabase();
    state.library = await loadLibrary();
    state.statistics = buildLibraryStatistics(state.library);
    state.rollDraftPool = buildRollPool(state.library);
    await refreshTmdbStatus();
  } catch (error) {
    console.error(error);
    state.error = error instanceof Error ? error : new Error(String(error));
  }

  render();
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("popstate", () => {
    state.view = readViewFromHash();
    state.focusControl = null;
    render();
  });
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
    "backup-export": () => exportBackup(),
    "legacy-migrate": () => migrateLegacyLibrary(),
    "backup-remind-later": () => dismissBackupReminder(),
    "participant-edit": () => openParticipantDialog(payload.id),
    "participant-delete": () => confirmParticipantDeletion(payload.id),
    "session-open": () => openSessionDetails(payload.id),
    "tmdb-configure": () => openTmdbTokenDialog(),
    "tmdb-clear": () => removeTmdbToken(),
  };

  await handlers[action]?.();
}

async function handleControl(control, payload) {
  const catalogControls = {
    "catalog-query": "query",
    "catalog-category": "categoryId",
    "catalog-status": "status",
    "catalog-sort": "sort",
  };
  if (catalogControls[control]) {
    state.catalogFilters[catalogControls[control]] = payload.value;
    state.focusControl = control === "catalog-query" ? control : null;
    render();
    return;
  }

  if (control === "backup-import" && payload.files?.[0]) {
    await importBackupFile(payload.files[0]);
    return;
  }
  if (control === "table-import" && payload.files?.[0]) {
    await importTableFile(payload.files[0]);
  }
}

async function exportBackup() {
  const backup = createBackup(state.library);
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `cinevault-backup-${date}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  await saveSetting("lastBackupAt", new Date().toISOString());
  await saveSetting("backupReminderDismissedUntil", null);
  await reloadLibrary();
  showToast("Резервная копия сохранена.");
}

async function importBackupFile(file) {
  const incoming = parseBackup(await file.text());
  const merged = mergeLibraries(state.library, incoming);
  await persistMergedLibrary(merged);
  await reloadLibrary();
  showToast("Резервная копия импортирована.");
  openDialog({
    title: "Импорт завершён",
    submitLabel: "Готово",
    body: `
      <p class="confirmation-text">Резервная копия объединена с текущей
      библиотекой. Совпадающие фильмы не дублировались.</p>
    `,
    onSubmit: async () => {},
  });
}

async function migrateLegacyLibrary() {
  const incoming = readLegacyLocalStorage(localStorage);
  const merged = mergeLibraries(state.library, incoming);
  await persistMergedLibrary(merged);
  localStorage.setItem("cinevault_legacy_migrated", "1");
  state.legacyDataFound = false;
  await reloadLibrary();
  showToast("Старая библиотека перенесена.");
  openDialog({
    title: "Миграция завершена",
    submitLabel: "Готово",
    body: `
      <p class="confirmation-text">Старая библиотека Movie Manager
      объединена с CineVault. Исходные ключи localStorage оставлены без
      изменений как дополнительная страховка.</p>
    `,
    onSubmit: async () => {},
  });
}

async function importTableFile(file) {
  const extension = file.name.split(".").pop()?.toLocaleLowerCase("ru-RU");
  let rows;
  if (extension === "xlsx") {
    const response = await fetch("/api/import-xlsx", {
      method: "POST",
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      body: file,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error ?? "Не удалось прочитать XLSX-файл.");
    }
    rows = payload.rows;
  } else {
    rows = parseDelimitedText(await readTextFile(file));
  }

  const incoming = tableRowsToLibrary(rows);
  const merged = mergeLibraries(state.library, incoming);
  await persistMergedLibrary(merged);
  await reloadLibrary();
  showToast(`Импортировано строк: ${rows.length}.`);
  openDialog({
    title: "Таблица импортирована",
    submitLabel: "Готово",
    body: `
      <p class="confirmation-text">Добавлено и объединено строк: ${rows.length}.
      Категории, франшизы, просмотренные фильмы и колонки оценок перенесены.</p>
    `,
    onSubmit: async () => {},
  });
}

async function dismissBackupReminder() {
  const days = state.library.settings.backupReminderDays ?? 30;
  const dismissedUntil = createReminderDismissalDate(days);
  await saveSetting("backupReminderDismissedUntil", dismissedUntil);
  await reloadLibrary();
  showToast(`Напоминание отложено на ${days} дней.`);
}

function openParticipantDialog(participantId) {
  const participant = state.library.participants.find(
    (item) => item.id === participantId,
  );
  if (!participant) return;

  openDialog({
    title: "Редактировать игрока",
    body: `
      <label class="field">
        <span>Имя</span>
        <input name="name" required maxlength="80"
          value="${escapeAttribute(participant.name)}">
      </label>
      <p class="form-hint">Изменение имени не переписывает исторические
      снимки уже завершённых сессий.</p>
    `,
    onSubmit: async (formData) => {
      const name = String(formData.get("name")).trim();
      const duplicate = state.library.participants.find(
        (item) =>
          item.id !== participant.id &&
          item.normalizedName === normalizeText(name),
      );
      if (duplicate) {
        throw new Error("Игрок с таким именем уже существует.");
      }
      await saveParticipant(createParticipant({ ...participant, name }));
      await reloadLibrary();
      showToast("Имя игрока обновлено.");
    },
  });
}

function confirmParticipantDeletion(participantId) {
  const participant = state.library.participants.find(
    (item) => item.id === participantId,
  );
  if (!participant) return;
  openConfirmation(
    "Удалить сохранённое имя?",
    `«${participant.name}» исчезнет из быстрых подсказок. Оценки и история останутся без изменений.`,
    async () => {
      await deleteParticipantRecord(participantId);
      await reloadLibrary();
      showToast("Сохранённое имя удалено.");
    },
  );
}

function openSessionDetails(sessionId) {
  const session = state.library.rollSessions.find(
    (item) => item.id === sessionId,
  );
  if (!session) return;

  openDialog({
    title: "Журнал сессии",
    submitLabel: "Закрыть",
    body: `
      <div class="session-detail-summary">
        <p><strong>Победитель:</strong>
          ${escapeHtml(session.winner?.title ?? "—")}</p>
        <p><strong>Завершена:</strong>
          ${escapeHtml(formatDateTimeValue(session.completedAt))}</p>
      </div>
      <ol class="event-log">
        ${session.events.map((event) => `
          <li>
            <time>${escapeHtml(formatTimeValue(event.createdAt))}</time>
            <span>${escapeHtml(describeSessionEvent(event))}</span>
          </li>
        `).join("")}
      </ol>
    `,
    onSubmit: async () => {},
  });
}

async function persistMergedLibrary(library) {
  const storeEntries = [
    [STORE_NAMES.categories, library.categories],
    [STORE_NAMES.movies, library.movies],
    [STORE_NAMES.franchises, library.franchises],
    [STORE_NAMES.participants, library.participants],
    [STORE_NAMES.rollSessions, library.rollSessions],
  ];
  await commitLibraryChanges(
    [
      ...storeEntries.flatMap(([storeName, values]) =>
        values.map((value) => ({ type: "put", storeName, value }))
      ),
      ...Object.entries(library.settings ?? {}).map(([key, value]) => ({
        type: "put",
        storeName: STORE_NAMES.settings,
        value: { key, value },
      })),
    ],
  );
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
      <input type="hidden" name="tmdbId" value="${movie?.tmdbId ?? ""}">
      <input type="hidden" name="tmdbPosterPath" value="">
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
      ${state.tmdbStatus.configured ? `
        <section class="tmdb-picker" data-tmdb-picker>
          <div class="tmdb-picker__heading">
            <div>
              <strong>Найти в TMDB</strong>
              <small>Поиск использует название и указанный год</small>
            </div>
            <button class="button button--ghost" type="button" data-tmdb-search>
              Найти фильм
            </button>
          </div>
          <div class="tmdb-results" data-tmdb-results aria-live="polite"></div>
        </section>
      ` : ""}
      <label class="field">
        <span>Страна</span>
        <input name="country" maxlength="100"
          value="${escapeAttribute(movie?.country ?? "")}">
      </label>
      <label class="field">
        <span>Жанры</span>
        <input name="genres" maxlength="300" placeholder="Фантастика, драма"
          value="${escapeAttribute((movie?.genres ?? []).join(", "))}">
      </label>
      <label class="field">
        <span>Описание</span>
        <textarea name="overview" maxlength="3000" rows="4">${escapeHtml(movie?.overview ?? "")}</textarea>
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
        tmdbId: formData.get("tmdbId"),
        overview: formData.get("overview"),
        genres: String(formData.get("genres") ?? "")
          .split(",").map((genre) => genre.trim()).filter(Boolean),
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

      const posterPath = formData.get("tmdbPosterPath");
      if (candidate.tmdbId && posterPath) {
        const cached = await cacheTmdbPoster(candidate.tmdbId, posterPath);
        candidate.coverUrl = cached.url;
        candidate.tmdbUpdatedAt = new Date().toISOString();
      }

      await saveMovie(createMovie(candidate));
      await reloadLibrary();
    },
  });
  if (state.tmdbStatus.configured) setupTmdbMovieSearch();
}

function setupTmdbMovieSearch() {
  const dialog = document.querySelector("#entity-dialog");
  const form = dialog?.querySelector("form");
  const button = form?.querySelector("[data-tmdb-search]");
  const resultsNode = form?.querySelector("[data-tmdb-results]");
  if (!form || !button || !resultsNode) return;

  button.addEventListener("click", async () => {
    const title = form.elements.title.value.trim();
    if (!title) {
      resultsNode.innerHTML = '<p class="form-hint">Сначала введите название.</p>';
      return;
    }
    button.disabled = true;
    resultsNode.innerHTML = '<p class="form-hint">Ищем в TMDB…</p>';
    try {
      const payload = await searchTmdbMovies(title, form.elements.releaseYear.value);
      const results = Array.isArray(payload.results) ? payload.results : [];
      renderTmdbResults(resultsNode, results);
      resultsNode.querySelectorAll("[data-tmdb-id]").forEach((resultButton) => {
        resultButton.addEventListener("click", () =>
          selectTmdbMovie(form, resultsNode, resultButton.dataset.tmdbId));
      });
    } catch (error) {
      resultsNode.innerHTML = `<p class="dialog-error">${escapeHtml(error.message)}</p>`;
    } finally {
      button.disabled = false;
    }
  });
}

function renderTmdbResults(container, results) {
  if (results.length === 0) {
    container.innerHTML = '<p class="form-hint">Совпадений не найдено.</p>';
    return;
  }
  container.innerHTML = results.map((movie) => {
    const year = String(movie.release_date ?? "").slice(0, 4) || "год неизвестен";
    const poster = tmdbPosterPreviewUrl(movie.poster_path);
    return `
      <button class="tmdb-result" type="button" data-tmdb-id="${movie.id}">
        ${poster
          ? `<img src="${escapeAttribute(poster)}" alt="" loading="lazy">`
          : '<span class="tmdb-result__poster">Нет постера</span>'}
        <span><strong>${escapeHtml(movie.title || movie.original_title || "Без названия")}</strong>
          <small>${escapeHtml(year)} · TMDB ${movie.id}</small></span>
      </button>`;
  }).join("");
}

async function selectTmdbMovie(form, resultsNode, tmdbId) {
  resultsNode.classList.add("is-loading");
  try {
    const movie = await getTmdbMovie(tmdbId);
    form.elements.title.value = movie.title || movie.original_title || "";
    form.elements.originalTitle.value = movie.original_title || "";
    form.elements.releaseYear.value = String(movie.release_date ?? "").slice(0, 4);
    form.elements.durationMinutes.value = movie.runtime || "";
    form.elements.country.value = (movie.production_countries ?? [])
      .map((country) => country.name).filter(Boolean).join(", ");
    form.elements.tmdbId.value = movie.id;
    form.elements.overview.value = movie.overview || "";
    form.elements.genres.value = (movie.genres ?? [])
      .map((genre) => genre.name).filter(Boolean).join(", ");
    form.elements.tmdbPosterPath.value = movie.poster_path || "";
    resultsNode.innerHTML = `<p class="tmdb-selected">✓ Выбран «${escapeHtml(movie.title)}». Метаданные и постер сохранятся локально.</p>`;
  } catch (error) {
    resultsNode.innerHTML = `<p class="dialog-error">${escapeHtml(error.message)}</p>`;
  } finally {
    resultsNode.classList.remove("is-loading");
  }
}

async function refreshTmdbStatus() {
  state.tmdbStatus = { ...state.tmdbStatus, loading: true, error: null };
  try {
    const status = await getTmdbStatus();
    state.tmdbStatus = { configured: Boolean(status.configured), loading: false, error: null };
  } catch (error) {
    state.tmdbStatus = { configured: false, loading: false, error: error.message };
  }
}

function openTmdbTokenDialog() {
  openDialog({
    title: state.tmdbStatus.configured ? "Заменить токен TMDB" : "Подключить TMDB",
    submitLabel: "Проверить и сохранить",
    body: `
      <label class="field">
        <span>API Read Access Token *</span>
        <input name="token" type="password" required autocomplete="off"
          minlength="20" maxlength="2048" placeholder="eyJhbGciOiJIUzI1NiJ9…">
      </label>
      <p class="form-hint">Токен проверяется запросом к TMDB и хранится только
      на этом компьютере. В резервную копию он не попадает.</p>
    `,
    onSubmit: async (formData) => {
      await configureTmdbToken(formData.get("token"));
      await refreshTmdbStatus();
      render();
      showToast("TMDB подключён.");
    },
  });
}

async function removeTmdbToken() {
  if (!confirm("Удалить сохранённый токен TMDB с этого компьютера?")) return;
  await clearTmdbToken();
  await refreshTmdbStatus();
  render();
  showToast("Токен TMDB удалён.");
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

async function readTextFile(file) {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

function describeSessionEvent(event) {
  const descriptions = {
    "session-started": `Сессия началась: ${event.participantCount} участников`,
    "spin-result": `Колесо указало на «${event.title}»`,
    reroll: `Результат «${event.title}» был перекручен`,
    "save-used": `${event.participantName} спасает «${event.title}»`,
    "entity-eliminated": `«${event.title}» выбывает, осталось ${event.remaining}`,
    "entity-restored": `«${event.title}» возвращён в колесо`,
    "winner-declared": `Победитель — «${event.title}»`,
  };
  return descriptions[event.type] ?? event.type;
}

function formatDateTimeValue(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTimeValue(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function detectLegacyData() {
  try {
    return (
      localStorage.getItem("cinevault_legacy_migrated") !== "1" &&
      LEGACY_STORAGE_KEYS.some((key) => localStorage.getItem(key) !== null)
    );
  } catch {
    return false;
  }
}
