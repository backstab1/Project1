import { STORE_NAMES } from "./config.js";
import { initializeDatabase } from "./data/database.js";
import {
  commitLibraryChanges,
  deleteParticipantRecord,
  isLibraryConflict,
  loadCachedLibrary,
  loadLibrary,
  resetLibraryStore,
  saveCategory,
  saveFranchise,
  saveMovie,
  saveRollSession,
  saveSetting,
} from "./data/libraryStore.js";
import {
  MOVIE_STATUS,
  MOVIE_STATUS_LABELS,
  createCategory,
  createFranchise,
  createMovie,
  normalizeText,
  parseTagInput,
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
  DEFAULT_POOL_FILTERS,
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
import { buildUndoCommands, describeDeletion } from "./domain/undo.js";
import {
  DEFAULT_CATALOG_FILTERS,
  filterCatalogMovies,
  pickRandomMovie,
} from "./domain/catalogQuery.js";
import {
  MATCH_CONFIDENCE,
  buildEnrichmentPatch,
  pickBestMatch,
  selectEnrichmentCandidates,
  summarizeEnrichment,
} from "./domain/tmdbEnrichment.js";
import {
  getTmdbMovie,
  getTmdbStatus,
  searchTmdbMovies,
} from "./services/tmdbClient.js";
import { POSTER_SIZES, tmdbPosterUrl } from "./domain/posters.js";
import { isModalView, renderAppShell } from "./ui/appShell.js";
import {
  isAuthPreview,
  openAuthScreen,
  resolveAccountEntry,
  submitAuthForm,
} from "./ui/authFlow.js";
import { describeAuthError, normalizeHandle } from "./domain/authRules.js";
import {
  buildViewers,
  describeFriendError,
  findViewer,
  groupFriendships,
  validateFriendHandle,
} from "./domain/friends.js";
import { signOut } from "./services/authService.js";
import {
  acceptFriendRequest,
  blockUser,
  findProfileByHandle,
  loadFriendships,
  removeFriendship,
  sendFriendRequest,
  setLibraryVisibility,
} from "./services/friendsService.js";
import { openDialog } from "./ui/dialog.js";
import { animateWheel, drawWheel } from "./ui/wheelCanvas.js";
import { showToast } from "./ui/toast.js";
import {
  closePalette,
  isPaletteOpen,
  openPalette,
} from "./ui/commandPalette.js";
import {
  applyTheme,
  getInitialTheme,
  saveTheme,
  toggleTheme,
} from "./ui/theme.js";

const root = document.querySelector("#app");
const VIEW_IDS = new Set([
  "welcome",
  "dashboard",
  "catalog",
  "categories",
  "franchises",
  "watched",
  "wheel",
  "sessions",
  "insights",
  "friends",
  "settings",
]);
const CATALOG_VIEW_KEY = "cinevault-catalog-view";
const SIDEBAR_KEY = "cinevault-sidebar-collapsed";

function readViewFromHash() {
  const view = location.hash.slice(1);
  if (VIEW_IDS.has(view)) return view;
  // Без якоря приложение открывается витриной, а не сразу библиотекой.
  return view ? "dashboard" : "welcome";
}

function readStoredPreference(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStoredPreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Настройка вида не критична: работаем в памяти текущей сессии.
  }
}

const state = {
  theme: applyTheme(getInitialTheme()),
  view: readViewFromHash(),
  library: {
    movies: [],
    categories: [],
    franchises: [],
    participants: [],
    rollSessions: [],
    settings: {},
  },
  statistics: {
    movieCount: 0,
    watchedMovieCount: 0,
    unwatchedMovieCount: 0,
    categoryCount: 0,
  },
  rollDraftPool: [],
  rollPoolFilters: { ...DEFAULT_POOL_FILTERS },
  activeSession: null,
  isSpinning: false,
  catalogFilters: { ...DEFAULT_CATALOG_FILTERS },
  catalogView: readStoredPreference(CATALOG_VIEW_KEY, "dense"),
  // Второстепенные фильтры каталога — список, жанр, тег, порядок — спрятаны
  // под кнопкой: постоянно они нужны редко, а строку занимали всю.
  filtersOpen: false,
  shortcutsOpen: false,
  sidebarCollapsed: readStoredPreference(SIDEBAR_KEY, "0") === "1",
  detailMovieId: null,
  selectionMode: false,
  selectedMovieIds: new Set(),
  focusControl: null,
  account: null,
  // Друзья приходят с сервера, а не из библиотеки: библиотека пока лежит в
  // IndexedDB, а заявки живут только в Postgres. Список заявок хранится
  // сырыми строками — раскладывает их по группам domain/friends.js.
  friends: {
    rows: [],
    loading: false,
    busy: false,
    error: "",
    search: { query: "", profile: null, error: "", notice: "", busy: false },
  },
  // Настройки и друзья не разделы библиотеки: они открываются окном поверх
  // текущего раздела. Здесь лежит имя открытого окна или null.
  modalView: null,
  // Кабинет в шапке: гостю показывает вход, вошедшему — профиль и разделы.
  accountPanel: {
    open: false,
    mode: "signin",
    values: {},
    errors: {},
    notice: "",
    busy: false,
    autofocus: false,
  },
  // Библиотека принадлежит аккаунту: без входа открыта только витрина.
  libraryLocked: true,
  // На экране снимок прошлой загрузки, а свежих данных получить не удалось.
  libraryStale: false,
  tmdbStatus: { configured: false, loading: true, error: null },
  error: null,
  onNavigate(view) {
    if (!VIEW_IDS.has(view)) return;
    if (state.libraryLocked && view !== "welcome") {
      openAccountScreen("signin", "Войдите, чтобы открыть библиотеку.")
        .catch(showUnexpectedError);
      return;
    }
    // Настройки и друзья открываются окном поверх текущего раздела: адрес и
    // прокрутка библиотеки при этом не меняются.
    if (isModalView(view)) {
      state.modalView = view;
      state.accountPanel = { ...state.accountPanel, open: false };
      state.focusControl = null;
      render();
      return;
    }
    state.view = view;
    state.modalView = null;
    state.accountPanel = { ...state.accountPanel, open: false };
    state.focusControl = null;
    state.detailMovieId = null;
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

// Гостя встречает витрина, а не форма: вход открывается кабинетом внизу
// справа. Полноэкранный экран остаётся только для шагов, которые нельзя
// пропустить, — смены пароля по ссылке и обмена приглашения на профиль.
async function start() {
  bindGlobalListeners();

  if (isAuthPreview()) {
    state.account = await openAuthScreen(root, { mode: "signin" });
    state.libraryLocked = !state.account;
    if (!state.libraryLocked) await loadWorkspace();
    render();
    return;
  }

  const entry = await resolveAccountEntry();
  if (entry.blocking) {
    state.account = await openAuthScreen(root, entry);
  } else {
    state.account = entry.profile;
    if (entry.error) {
      state.accountPanel.errors = { general: entry.error };
    }
  }

  state.libraryLocked = !state.account;
  if (state.libraryLocked) {
    // Гостю показывать нечего, кроме витрины: якорь вида в адресе убираем,
    // иначе кнопка «назад» вернула бы его в раздел, которого он не видел.
    state.view = "welcome";
    if (location.hash) history.replaceState(null, "", location.pathname);
    render();
    return;
  }

  await loadWorkspace();
  render();
}

function bindGlobalListeners() {
  // Событие error у изображений не всплывает, поэтому слушаем фазу перехвата.
  document.addEventListener("error", handleBrokenPoster, true);
  window.addEventListener("keydown", handleGlobalKeydown);
  // Холст колеса рисуется под конкретный размер окна: после его изменения
  // картинку нужно нарисовать заново, иначе она растянется и замылится.
  let resizeQueued = false;
  window.addEventListener("resize", () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      redrawWheelCanvas();
    });
  }, { passive: true });
  window.addEventListener("popstate", () => {
    const view = readViewFromHash();
    state.view = state.libraryLocked && view !== "welcome" ? "welcome" : view;
    state.focusControl = null;
    state.detailMovieId = null;
    render();
  });
}

// Открывает библиотеку: база, записи, статус TMDB. Вызывается и на старте,
// и сразу после входа в кабинете.
async function loadWorkspace() {
  state.libraryStale = false;

  try {
    await initializeDatabase();

    // Снимок прошлой загрузки показывается сразу: библиотека не должна
    // открываться пустым экраном, пока идёт запрос к серверу.
    const cached = await loadCachedLibrary();
    if (cached) {
      applyLibrary(cached);
      state.libraryStale = true;
      state.error = null;
      render();
    }

    applyLibrary(await loadLibrary());
    state.libraryStale = false;
    await refreshTmdbStatus();
    state.error = null;
  } catch (error) {
    console.error(error);
    if (state.libraryStale) {
      // Снимок уже на экране: библиотеку видно, а о том, что она может быть
      // устаревшей, говорит полоса вверху. Экран ошибки здесь только мешал бы.
      showToast("Нет связи с сервером: показан последний снимок.");
    } else {
      state.error = error instanceof Error ? error : new Error(String(error));
    }
  }
  // Друзья не должны ронять библиотеку: сервер может быть недоступен, а
  // каталог лежит рядом и открывается без него.
  await refreshFriends();
  applyMotionPreference();
}

function applyLibrary(library) {
  state.library = library;
  state.statistics = buildLibraryStatistics(state.library);
  if (!state.activeSession) {
    state.rollDraftPool = buildRollPool(state.library, state.rollPoolFilters);
  }
}

async function refreshFriends() {
  if (!state.account?.id) {
    state.friends = {
      ...state.friends,
      rows: [],
      loading: false,
      error: "",
    };
    return;
  }

  state.friends = { ...state.friends, loading: true, error: "" };
  try {
    state.friends = {
      ...state.friends,
      rows: await loadFriendships(state.account.id),
      loading: false,
    };
  } catch (error) {
    console.error(error);
    state.friends = {
      ...state.friends,
      loading: false,
      error: describeFriendError(error),
    };
  }
}

function render() {
  renderAppShell(root, state);
}

function redrawWheelCanvas() {
  if (state.view !== "wheel" || state.isSpinning) return;
  const canvas = document.querySelector("#wheel-canvas");
  if (!canvas) return;
  drawWheel(canvas, state.activeSession?.pool ?? state.rollDraftPool, 0, {
    theme: state.theme,
  });
}

// Настройка «меньше движения» действует поверх системной, поэтому её нужно
// проставлять на корне документа, а не только в анимации колеса.
function applyMotionPreference() {
  const reduced = state.library.settings?.reducedMotion === true;
  if (reduced) {
    document.documentElement.dataset.motion = "reduced";
  } else {
    delete document.documentElement.dataset.motion;
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

// Постер TMDB может не загрузиться: ссылка устарела или интернета нет.
// Вместо пустой рамки показываем инициалы названия, а фоновую подложку убираем.
function handleBrokenPoster(event) {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  if (!image.hasAttribute("data-poster-fallback")) return;

  const label = image.dataset.posterFallback;
  if (!label) {
    image.remove();
    return;
  }

  const fallback = document.createElement("span");
  fallback.className = "poster-fallback";
  fallback.textContent = label;
  image.replaceWith(fallback);
}

async function reloadLibrary() {
  applyLibrary(await loadLibrary());
  state.libraryStale = false;
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
    "participants-forget": () => confirmLegacyParticipantCleanup(),
    "friends-open": () => state.onNavigate("friends"),
    "friend-find": () => searchFriendByHandle(),
    "friend-request": () => requestFriendship(payload.userId),
    "friend-accept": () => runFriendAction(payload.id, acceptFriendRequest,
      "Заявка принята."),
    "friend-decline": () => runFriendAction(payload.id, removeFriendship,
      "Заявка отклонена."),
    "friend-cancel": () => runFriendAction(payload.id, removeFriendship,
      "Заявка отменена."),
    "friend-remove": () => confirmFriendRemoval(payload.id),
    "friend-block": () => confirmFriendBlock(payload.id),
    "friend-unblock": () => runFriendAction(payload.id, removeFriendship,
      "Блокировка снята."),
    "privacy-set": () => setLibraryPrivacy(payload.value),
    "session-open": () => openSessionDetails(payload.id),
    "tmdb-enrich": () => openEnrichmentDialog(),
    "catalog-filters-reset": () => resetCatalogFilters(),
    "catalog-filters-toggle": () => toggleCatalogFilters(),
    "catalog-status-set": () => setCatalogFilter("status", payload.value),
    "catalog-filter-clear": () => clearCatalogFilter(payload.filter),
    "catalog-view": () => setCatalogView(payload.mode),
    "catalog-favorites-toggle": () =>
      setCatalogFilter("favoritesOnly", !state.catalogFilters.favoritesOnly),
    "catalog-tag-open": () => openCatalogTag(payload.tag),
    "catalog-status-open": () => openCatalogWithFilters({ status: payload.status }),
    "roll-filter-set": () => setRollPoolFilter(payload.filter),
    "session-repeat": () => repeatSessionPool(payload.id),
    "movie-favorite-toggle": () => toggleMovieFavorite(payload.id),
    "movie-status-set": () => setMovieStatus(payload.id, payload.status),
    "selection-toggle": () => toggleSelectionMode(),
    "selection-toggle-movie": () => toggleMovieSelection(payload.id),
    "selection-all": () => selectAllVisibleMovies(),
    "bulk-watch": () => bulkMarkWatched(),
    "bulk-favorite": () => bulkToggleFavorite(),
    "bulk-move": () => openBulkMoveDialog(),
    "bulk-tag": () => openBulkTagDialog(),
    "bulk-delete": () => confirmBulkDeletion(),
    "movie-open": () => openMovieDetail(payload.id),
    "detail-close": () => closeMovieDetail(),
    "sidebar-toggle": () => toggleSidebar(),
    "palette-open": () => openCommandPalette(),
    "theme-set": () => setTheme(payload.theme),
    "theme-toggle": () => changeTheme(),
    "account-toggle": () => toggleAccountPanel(),
    "account-open": () => openAccountScreen(payload.mode ?? "signin"),
    "account-close": () => closeAccountPanel(),
    "account-mode": () => setAccountMode(payload.mode),
    "account-submit": () => submitAccountForm(payload.mode, payload.values),
    "account-signout": () => signOutAccount(),
    "catalog-lucky": () => openLuckyMovie(),
    "shortcuts-open": () => setShortcutsOpen(true),
    "shortcuts-close": () => setShortcutsOpen(false),
    "modal-close": () => closeModalView(),
  };

  await handlers[action]?.();
}

/* --------------------------------------------------------- Личный кабинет */

// «Создать аккаунт» и «Войти» с витрины ведут на следующую страницу — форму
// во весь экран. Кабинет внизу справа живёт уже внутри библиотеки и нужен
// вошедшему: посмотреть профиль и выйти.
async function openAccountScreen(mode = "signin", notice = "") {
  const profile = await openAuthScreen(root, { mode, notice, cancellable: true });
  if (!profile) {
    // Вернулись на витрину: состояние не менялось, хватит перерисовки.
    render();
    return;
  }
  await enterLibrary(profile);
}

function openAccountPanel(mode = "signin", notice = "") {
  state.accountPanel = {
    ...state.accountPanel,
    open: true,
    mode: state.account ? state.accountPanel.mode : mode,
    values: {},
    errors: {},
    notice,
    busy: false,
    // Фокус нужен только форме: у вошедшего в панели одни кнопки.
    autofocus: !state.account,
  };
  render();
}

function toggleAccountPanel() {
  if (state.accountPanel.open) {
    closeAccountPanel();
    return;
  }
  openAccountPanel(state.accountPanel.mode);
}

function closeAccountPanel() {
  state.accountPanel = {
    ...state.accountPanel,
    open: false,
    busy: false,
    autofocus: false,
  };
  render();
}

function setAccountMode(mode) {
  state.accountPanel = {
    ...state.accountPanel,
    open: true,
    mode: mode ?? "signin",
    values: {},
    errors: {},
    notice: "",
    busy: false,
    autofocus: true,
  };
  render();
}

async function submitAccountForm(mode, values) {
  if (state.accountPanel.busy) return;
  state.accountPanel = {
    ...state.accountPanel,
    values,
    errors: {},
    notice: "",
    busy: true,
    autofocus: false,
  };
  render();

  let result;
  try {
    result = await submitAuthForm(mode, values);
  } catch (error) {
    state.accountPanel = {
      ...state.accountPanel,
      busy: false,
      errors: { general: describeAuthError(error) },
      autofocus: true,
    };
    render();
    return;
  }

  if (result.profile) {
    await enterLibrary(result.profile);
    return;
  }

  state.accountPanel = {
    ...state.accountPanel,
    busy: false,
    mode: result.mode ?? state.accountPanel.mode,
    values: result.clearValues ? {} : state.accountPanel.values,
    errors: result.errors ?? {},
    notice: result.notice ?? "",
    autofocus: true,
  };
  render();
}

async function enterLibrary(profile) {
  state.account = profile;
  state.libraryLocked = false;
  state.accountPanel = {
    open: false,
    mode: "signin",
    values: {},
    errors: {},
    notice: "",
    busy: false,
    autofocus: false,
  };
  state.view = "dashboard";
  if (location.hash !== "#dashboard") {
    history.pushState(null, "", "#dashboard");
  }

  await loadWorkspace();
  render();
  showToast(`С возвращением, ${profile.display_name ?? profile.handle}.`);
}

async function signOutAccount() {
  state.accountPanel = { ...state.accountPanel, busy: true, errors: {} };
  render();

  try {
    await signOut();
  } catch (error) {
    state.accountPanel = {
      ...state.accountPanel,
      busy: false,
      errors: { general: describeAuthError(error) },
    };
    render();
    return;
  }

  state.account = null;
  state.libraryLocked = true;
  closeWorkspace();
  state.accountPanel = {
    open: false,
    mode: "signin",
    values: {},
    errors: {},
    notice: "",
    busy: false,
    autofocus: false,
  };
  state.view = "welcome";
  history.pushState(null, "", location.pathname);
  render();
  showToast("Вы вышли из аккаунта.");
}

// После выхода в памяти не должно остаться ни записей, ни начатой сессии:
// следующий вход соберёт всё заново.
function closeWorkspace() {
  resetLibraryStore().catch(() => {});
  state.libraryStale = false;
  state.modalView = null;
  state.library = {
    movies: [],
    categories: [],
    franchises: [],
    participants: [],
    rollSessions: [],
    settings: {},
  };
  state.statistics = {
    movieCount: 0,
    watchedMovieCount: 0,
    unwatchedMovieCount: 0,
    categoryCount: 0,
  };
  state.rollDraftPool = [];
  state.activeSession = null;
  state.detailMovieId = null;
  state.selectionMode = false;
  state.selectedMovieIds = new Set();
  state.catalogFilters = { ...DEFAULT_CATALOG_FILTERS };
  state.friends = {
    rows: [],
    loading: false,
    busy: false,
    error: "",
    search: { query: "", profile: null, error: "", notice: "", busy: false },
  };
  state.error = null;
}

/* ---------------------------------------------------------------- Друзья */

// Заявку подают по точному имени пользователя: списка аккаунтов сервер не
// отдаёт, поэтому поиск — это отдельный шаг, а не подсказка в поле.
async function searchFriendByHandle() {
  const search = state.friends.search;
  if (search.busy) return;

  const message = validateFriendHandle(search.query, state.account?.handle);
  if (message) {
    setFriendSearch({ error: message, profile: null, notice: "" });
    return;
  }

  const handle = normalizeHandle(search.query);
  setFriendSearch({ busy: true, error: "", notice: "", profile: null });

  try {
    const profile = await findProfileByHandle(handle);
    if (!profile) {
      setFriendSearch({
        busy: false,
        notice: `Аккаунта @${handle} нет. Проверьте имя — оно пишется латиницей.`,
      });
      return;
    }

    const existing = findFriendshipWith(profile.id);
    setFriendSearch({
      busy: false,
      profile,
      notice: existing ? describeExistingLink(existing) : "",
    });
  } catch (error) {
    console.error(error);
    setFriendSearch({ busy: false, error: describeFriendError(error) });
  }
}

function describeExistingLink(item) {
  if (item.status === "accepted") return "Уже у вас в друзьях.";
  if (item.status === "blocked") {
    return item.ownBlock ? "Вы заблокировали этого человека." : "Связь заблокирована.";
  }
  return item.outgoing
    ? "Заявка уже отправлена — ждём ответа."
    : "Этот человек уже написал вам: ответьте на заявку ниже.";
}

function findFriendshipWith(userId) {
  const groups = groupFriendships(state.friends.rows, state.account?.id);
  return [
    ...groups.friends,
    ...groups.incoming,
    ...groups.outgoing,
    ...groups.blocked,
  ].find((item) => item.otherId === userId) ?? null;
}

async function requestFriendship(userId) {
  if (!userId || state.friends.busy) return;

  const existing = findFriendshipWith(userId);
  if (existing) {
    setFriendSearch({ notice: describeExistingLink(existing) });
    return;
  }

  await withFriendsBusy(async () => {
    await sendFriendRequest(userId);
    await refreshFriends();
    setFriendSearch({ query: "", profile: null, notice: "", error: "" });
    showToast("Заявка отправлена.");
  });
}

function confirmFriendRemoval(id) {
  const item = findFriendshipById(id);
  if (!item) return;

  openConfirmation(
    "Удалить из друзей?",
    `${friendName(item)} перестанет видеть вашу библиотеку и исчезнет из списка
     зрителей. Оценки, которые он уже поставил, останутся.`,
    () => runFriendAction(id, removeFriendship, "Удалён из друзей."),
  );
}

function confirmFriendBlock(id) {
  const item = findFriendshipById(id);
  if (!item) return;

  openConfirmation(
    "Заблокировать?",
    `${friendName(item)} не найдёт вас поиском и не сможет подать заявку.
     Снять блокировку можно здесь же.`,
    () => runFriendAction(
      id,
      (friendshipId) => blockUser({ friendshipId }),
      "Человек заблокирован.",
    ),
    "Заблокировать",
  );
}

function findFriendshipById(id) {
  const groups = groupFriendships(state.friends.rows, state.account?.id);
  return [
    ...groups.friends,
    ...groups.incoming,
    ...groups.outgoing,
    ...groups.blocked,
  ].find((item) => item.id === id) ?? null;
}

function friendName(item) {
  const name = String(item?.profile?.display_name ?? "").trim();
  if (name) return name;
  const handle = String(item?.profile?.handle ?? "").trim();
  return handle ? `@${handle}` : "Этот человек";
}

// Все ответы на заявку устроены одинаково: запрос, перечитывание списка,
// тост. Отличается только сам запрос и текст.
async function runFriendAction(id, request, successText) {
  if (!id || state.friends.busy) return;
  await withFriendsBusy(async () => {
    await request(id);
    await refreshFriends();
    showToast(successText);
  });
}

async function withFriendsBusy(run) {
  state.friends = { ...state.friends, busy: true, error: "" };
  render();
  try {
    await run();
  } catch (error) {
    console.error(error);
    state.friends = { ...state.friends, error: describeFriendError(error) };
  } finally {
    state.friends = { ...state.friends, busy: false };
    render();
  }
}

// Видимость библиотеки хранится в профиле: сервер по ней и решает, отдавать
// ли записи другу. Локальная копия профиля обновляется ответом сервера, а не
// нажатием кнопки.
async function setLibraryPrivacy(visibility) {
  if (!["private", "friends"].includes(visibility)) return;
  if (state.friends.busy) return;
  if ((state.account?.library_visibility ?? "private") === visibility) return;

  await withFriendsBusy(async () => {
    const profile = await setLibraryVisibility(visibility);
    state.account = { ...state.account, ...profile };
    showToast(
      visibility === "friends"
        ? "Библиотеку видят друзья."
        : "Библиотека снова скрыта.",
    );
  });
}

function setFriendSearch(patch) {
  state.friends = {
    ...state.friends,
    search: { ...state.friends.search, ...patch },
  };
  state.focusControl = "friend-search";
  render();
}

// Имена из версии с ручным вводом: в оценках и в истории сессий они остаются,
// но подсказывать их больше нечему.
function confirmLegacyParticipantCleanup() {
  const participants = state.library.participants ?? [];
  if (participants.length === 0) return;

  openConfirmation(
    "Забыть старые имена?",
    `${participants.length} ${pluralizeName(participants.length)} исчезнет из
     настроек. Оценки и завершённые сессии останутся без изменений.`,
    async () => {
      await Promise.all(
        participants.map((participant) => deleteParticipantRecord(participant.id)),
      );
      await reloadLibrary();
      showToast("Старые имена забыты.");
    },
    "Забыть",
  );
}

function pluralizeName(count) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 19) return "имён";
  if (mod10 === 1) return "имя";
  if (mod10 >= 2 && mod10 <= 4) return "имени";
  return "имён";
}

function toggleCatalogFilters() {
  state.filtersOpen = !state.filtersOpen;
  render();
}

function resetCatalogFilters() {
  state.catalogFilters = { ...DEFAULT_CATALOG_FILTERS };
  state.focusControl = null;
  render();
}

function setCatalogFilter(field, value) {
  state.catalogFilters[field] = value;
  state.focusControl = null;
  pruneSelectionToVisible();
  render();
}

// Массовые операции работают по списку выделенных, а фильтр меняет то, что
// человек видит. Без этой чистки «удалить выделенное» задело бы и фильмы,
// ушедшие из выборки минуту назад.
function pruneSelectionToVisible() {
  if (!state.selectionMode || state.selectedMovieIds.size === 0) return;
  const visible = new Set(getVisibleCatalogMovies().map((movie) => movie.id));
  const kept = new Set(
    [...state.selectedMovieIds].filter((id) => visible.has(id)),
  );
  if (kept.size !== state.selectedMovieIds.size) {
    state.selectedMovieIds = kept;
  }
}

function clearCatalogFilter(field) {
  setCatalogFilter(field, DEFAULT_CATALOG_FILTERS[field]);
}

function openCatalogFavorites() {
  openCatalogWithFilters({ favoritesOnly: true });
}

// Тег из карточки фильма открывает каталог с уже применённым фильтром.
function openCatalogTag(tag) {
  openCatalogWithFilters({ tag: String(tag ?? "") });
}

function openCatalogWithFilters(filters) {
  state.detailMovieId = null;
  state.catalogFilters = { ...DEFAULT_CATALOG_FILTERS, ...filters };
  state.view = "catalog";
  if (location.hash !== "#catalog") {
    history.pushState(null, "", "#catalog");
  }
  state.focusControl = null;
  render();
}

// Отбор пула не меняет библиотеку: он лишь сужает то, из чего колесо берёт
// участников, поэтому пересобирается прямо на месте.
function setRollPoolFilter(filter) {
  const filters = { ...DEFAULT_POOL_FILTERS };
  if (filter === "favorites") filters.favoritesOnly = true;
  state.rollPoolFilters = filters;
  state.rollDraftPool = buildRollPool(state.library, filters);
  render();
}

function setRollPoolTag(tag) {
  state.rollPoolFilters = { ...state.rollPoolFilters, tag: String(tag ?? "") };
  state.rollDraftPool = buildRollPool(state.library, state.rollPoolFilters);
  render();
}

// Повтор пула берёт состав прошлой сессии и выбрасывает то, чего уже нет:
// удалённые фильмы и всё, что успели посмотреть.
function repeatSessionPool(sessionId) {
  const session = state.library.rollSessions.find((item) => item.id === sessionId);
  if (!session) return;

  const movieById = new Map(state.library.movies.map((movie) => [movie.id, movie]));
  const franchiseById = new Map(
    state.library.franchises.map((franchise) => [franchise.id, franchise]),
  );

  const pool = session.originalPool.filter((item) => {
    if (item.type === "movie") {
      const movie = movieById.get(item.id);
      return Boolean(movie) && !movie.watchedAt;
    }
    const franchise = franchiseById.get(item.id);
    return Boolean(franchise) && franchise.movieIds.some(
      (movieId) => movieById.get(movieId) && !movieById.get(movieId).watchedAt,
    );
  });

  const dropped = session.originalPool.length - pool.length;
  if (pool.length < 2) {
    showToast("В этом пуле почти всё уже просмотрено — соберите новый.");
    return;
  }

  state.rollPoolFilters = { ...DEFAULT_POOL_FILTERS };
  state.rollDraftPool = pool.map((item) => ({ ...item }));
  state.onNavigate("wheel");
  showToast(dropped
    ? `Пул повторён, ${dropped} уже просмотрено и исключено`
    : "Пул повторён");
}

// Массовые операции работают только в каталоге и только над тем, что человек
// видит на экране: скрытые фильтром фильмы не должны меняться незаметно.
function toggleSelectionMode() {
  state.selectionMode = !state.selectionMode;
  state.selectedMovieIds = new Set();
  state.detailMovieId = null;
  render();
}

function toggleMovieSelection(movieId) {
  const selected = new Set(state.selectedMovieIds);
  if (selected.has(movieId)) selected.delete(movieId);
  else selected.add(movieId);
  state.selectedMovieIds = selected;
  render();
}

function selectAllVisibleMovies() {
  const visible = getVisibleCatalogMovies();
  const allSelected = visible.every((movie) => state.selectedMovieIds.has(movie.id));
  state.selectedMovieIds = allSelected
    ? new Set()
    : new Set(visible.map((movie) => movie.id));
  render();
}

function getVisibleCatalogMovies() {
  return filterCatalogMovies(state.library, state.catalogFilters);
}

function getSelectedMovies() {
  return state.library.movies.filter((movie) => state.selectedMovieIds.has(movie.id));
}

async function applyToSelection(update, message) {
  const movies = getSelectedMovies();
  if (movies.length === 0) return;

  for (const movie of movies) {
    await saveMovie(createMovie(update(movie)));
  }
  state.selectedMovieIds = new Set();
  await reloadLibrary();
  showToast(`${message}: ${movies.length}`);
}

function bulkMarkWatched() {
  const watchedAt = new Date().toISOString();
  return applyToSelection(
    (movie) => ({ ...movie, watchedAt: movie.watchedAt ?? watchedAt }),
    "Отмечено просмотренными",
  );
}

function bulkToggleFavorite() {
  // Если выделено хоть что-то не избранное — добавляем, иначе снимаем со всех.
  const movies = getSelectedMovies();
  const shouldFavorite = movies.some((movie) => !movie.isFavorite);
  return applyToSelection(
    (movie) => ({ ...movie, isFavorite: shouldFavorite }),
    shouldFavorite ? "Добавлено в избранное" : "Убрано из избранного",
  );
}

function openBulkMoveDialog() {
  const movies = getSelectedMovies();
  if (movies.length === 0) return;

  openDialog({
    title: `Перенести в список: ${movies.length}`,
    submitLabel: "Перенести",
    body: `
      <label class="field">
        <span>Список</span>
        <select name="categoryId">
          <option value="">Без списка</option>
          ${buildCategoryOptions(null)}
        </select>
      </label>
      <p class="form-hint">Фильмы встанут в конец очереди выбранного списка.</p>
    `,
    onSubmit: async (formData) => {
      const categoryId = formData.get("categoryId") || null;
      let position = getNextMoviePosition(categoryId);
      for (const movie of movies) {
        await saveMovie(createMovie({
          ...movie,
          categoryId,
          categoryPosition: position,
        }));
        position += 1;
      }
      state.selectedMovieIds = new Set();
      await reloadLibrary();
      showToast(`Перенесено: ${movies.length}`);
    },
  });
}

function openBulkTagDialog() {
  const movies = getSelectedMovies();
  if (movies.length === 0) return;

  openDialog({
    title: `Теги для ${movies.length} ${pluralizeMovies(movies.length)}`,
    submitLabel: "Применить",
    body: `
      <label class="field">
        <span>Добавить теги</span>
        <input name="tags" maxlength="300" placeholder="Вечер пятницы, пересмотр">
      </label>
      <label class="switch-field">
        <input type="checkbox" name="replace">
        <span class="switch-field__box">✓</span>
        <span class="switch-field__text">
          <strong>Заменить существующие теги</strong>
          <small>Иначе новые метки добавятся к уже проставленным.</small>
        </span>
      </label>
    `,
    onSubmit: async (formData) => {
      const tags = parseTagInput(formData.get("tags"));
      const replace = formData.get("replace") === "on";
      if (tags.length === 0 && !replace) {
        throw new Error("Введите хотя бы один тег или включите замену.");
      }

      for (const movie of movies) {
        await saveMovie(createMovie({
          ...movie,
          tags: replace ? tags : [...(movie.tags ?? []), ...tags],
        }));
      }
      state.selectedMovieIds = new Set();
      await reloadLibrary();
      showToast(`Теги обновлены: ${movies.length}`);
    },
  });
}

function confirmBulkDeletion() {
  const movies = getSelectedMovies();
  if (movies.length === 0) return;

  openDialog({
    title: `Удалить ${movies.length} ${pluralizeMovies(movies.length)}?`,
    submitLabel: "Удалить",
    variant: "danger",
    body: `
      <p>Фильмы исчезнут из списков, коллекций и статистики. Действие
      необратимо, поэтому сначала стоит скачать резервную копию.</p>
      <div class="enrich-list">
        ${movies.slice(0, 12).map((movie) => `
          <div class="enrich-list__row"><span><strong>${escapeHtml(movie.title)}</strong></span></div>
        `).join("")}
        ${movies.length > 12
          ? `<div class="enrich-list__row"><span>…и ещё ${movies.length - 12}</span></div>`
          : ""}
      </div>
    `,
    onSubmit: async () => {
      // Команды считаются от одного слепка, поэтому отмена возвращает всё разом.
      const commands = movies.flatMap(
        (movie) => buildMovieDeletionCommands(state.library, movie.id),
      );
      state.selectedMovieIds = new Set();
      await commitReversible(commands, {
        message: `Удалено ${describeDeletion(movies.length)}`,
        undoMessage: `Возвращено ${describeDeletion(movies.length)}`,
      });
    },
  });
}

async function setMovieStatus(movieId, status) {
  const movie = state.library.movies.find((item) => item.id === movieId);
  if (!movie || movieStatusOf(movie) === status) return;

  // Смена статуса на «просмотрен» проходит через обычный диалог даты, чтобы
  // не выдумывать дату за пользователя.
  if (status === MOVIE_STATUS.watched) {
    openWatchDateDialog(movieId);
    return;
  }

  await saveMovie(createMovie({ ...movie, watchedAt: null, status }));
  await reloadLibrary();
  showToast(`Статус: ${MOVIE_STATUS_LABELS[status]}`);
}

function movieStatusOf(movie) {
  return movie.watchedAt ? MOVIE_STATUS.watched : movie.status ?? MOVIE_STATUS.queued;
}

async function toggleMovieFavorite(movieId) {
  const movie = state.library.movies.find((item) => item.id === movieId);
  if (!movie) return;

  await saveMovie(createMovie({ ...movie, isFavorite: !movie.isFavorite }));
  await reloadLibrary();
  showToast(movie.isFavorite ? "Убрано из избранного" : "Добавлено в избранное");
}

function setCatalogView(mode) {
  state.catalogView = ["list", "dense"].includes(mode) ? mode : "grid";
  writeStoredPreference(CATALOG_VIEW_KEY, state.catalogView);
  render();
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  writeStoredPreference(SIDEBAR_KEY, state.sidebarCollapsed ? "1" : "0");
  render();
}

// «Мне повезёт»: случайный фильм ровно из того, что человек сейчас видит —
// фильтры, поиск и статус учтены, потому что выборка та же, что в каталоге.
function openLuckyMovie() {
  const movies = filterCatalogMovies(state.library, state.catalogFilters);
  const movie = pickRandomMovie(movies);
  if (!movie) {
    showToast("В текущей выборке нет фильмов.", "info");
    return;
  }
  state.detailMovieId = movie.id;
  render();
  showToast(`Выпало: ${movie.title}`, "info");
}

function setShortcutsOpen(open) {
  if (state.shortcutsOpen === open) return;
  state.shortcutsOpen = open;
  render();
}

function closeModalView() {
  if (!state.modalView) return;
  state.modalView = null;
  state.focusControl = null;
  render();
}

// Каталог с курсором в поиске — по «/». Если раздел уже открыт, переход не
// нужен, достаточно вернуть фокус в поле.
function focusCatalogSearch() {
  if (state.view !== "catalog") {
    state.view = "catalog";
    state.detailMovieId = null;
    if (location.hash !== "#catalog") {
      history.pushState(null, "", "#catalog");
    }
  }
  state.focusControl = "catalog-query";
  render();
}

function openMovieDetail(movieId) {
  state.detailMovieId = movieId ?? null;
  render();
}

function closeMovieDetail() {
  if (!state.detailMovieId) return;
  state.detailMovieId = null;
  render();
}

function setTheme(theme) {
  if (theme !== "light" && theme !== "dark") return;
  state.theme = applyTheme(theme);
  saveTheme(state.theme);
  render();
}

function openCommandPalette() {
  openPalette(buildCommands());
}

function buildCommands() {
  const navigation = [
    ["dashboard", "Главная", "home"],
    ["catalog", "Каталог", "film"],
    ["franchises", "Коллекции", "collection"],
    ["categories", "Списки", "layers"],
    ["watched", "Просмотренные", "eye"],
    ["wheel", "Колесо", "wheel"],
    ["sessions", "История роллов", "history"],
    ["insights", "Статистика", "target"],
    ["friends", "Друзья", "users"],
    ["settings", "Настройки", "settings"],
  ].map(([view, label, iconName]) => ({
    id: `nav-${view}`,
    group: "Переход",
    label,
    hint: "Открыть раздел",
    icon: iconName,
    keywords: view,
    run: () => state.onNavigate(view),
  }));

  const actions = [
    {
      id: "action-add-movie",
      group: "Действия",
      label: "Добавить фильм",
      hint: "Создать карточку вручную или через TMDB",
      icon: "plus",
      keywords: "новый фильм создать add",
      run: () => state.onAction("movie-add", {}),
    },
    {
      id: "action-lucky",
      group: "Действия",
      label: "Мне повезёт",
      hint: "Случайный фильм из текущей выборки каталога",
      icon: "dice",
      keywords: "случайный рандом выбрать повезёт lucky random",
      run: () => openLuckyMovie(),
    },
    {
      id: "action-shortcuts",
      group: "Действия",
      label: "Горячие клавиши",
      hint: "Шпаргалка по управлению с клавиатуры",
      icon: "keyboard",
      keywords: "клавиши хоткеи shortcuts помощь",
      run: () => setShortcutsOpen(true),
    },
    {
      id: "action-add-category",
      group: "Действия",
      label: "Новый список",
      hint: "Создать список с квотой для колеса",
      icon: "layers",
      keywords: "категория список",
      run: () => state.onAction("category-add", {}),
    },
    {
      id: "action-add-franchise",
      group: "Действия",
      label: "Новая коллекция",
      hint: "Объединить фильмы во франшизу",
      icon: "collection",
      keywords: "франшиза коллекция сага",
      run: () => state.onAction("franchise-add", {}),
    },
    {
      id: "action-favorites",
      group: "Действия",
      label: "Показать избранное",
      hint: "Каталог только из отмеченных звездой фильмов",
      icon: "star",
      keywords: "избранное favorites звезда любимые",
      run: () => openCatalogFavorites(),
    },
    {
      id: "action-roll",
      group: "Действия",
      label: state.activeSession ? "Вернуться к сессии" : "Запустить колесо",
      hint: "Кинорулетка с механикой выбывания",
      icon: "wheel",
      keywords: "ролл рулетка колесо spin",
      run: () => state.onNavigate("wheel"),
    },
    {
      id: "action-theme",
      group: "Действия",
      label: state.theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему",
      hint: "Переключение оформления",
      icon: state.theme === "dark" ? "sun" : "moon",
      keywords: "тема theme dark light",
      run: () => state.onAction("theme-toggle", {}),
    },
  ];

  const movies = state.library.movies
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title, "ru-RU"))
    .map((movie) => ({
      id: `movie-${movie.id}`,
      group: "Фильмы",
      label: movie.title,
      hint: [movie.releaseYear, movie.country, movie.watchedAt ? "просмотрен" : "в очереди"]
        .filter(Boolean).join(" · "),
      icon: "film",
      keywords: [movie.originalTitle, ...(movie.genres ?? [])].filter(Boolean).join(" "),
      hiddenByDefault: true,
      run: () => openMovieDetail(movie.id),
    }));

  return [...navigation, ...actions, ...movies];
}

async function handleControl(control, payload) {
  const catalogControls = {
    "catalog-query": "query",
    "catalog-category": "categoryId",
    "catalog-genre": "genre",
    "catalog-tag": "tag",
    "catalog-status": "status",
    "catalog-sort": "sort",
  };
  if (catalogControls[control]) {
    state.catalogFilters[catalogControls[control]] = payload.value;
    state.focusControl = control === "catalog-query" ? control : null;
    pruneSelectionToVisible();
    render();
    return;
  }

  const settingControls = {
    "setting-sound": ["soundEnabled", (value) => value.checked],
    "setting-reduced-motion": ["reducedMotion", (value) => value.checked],
    "setting-save-threshold": [
      "savesEnabledAboveRemaining",
      (value) => clampNumber(value.value, 1, 99, 3),
    ],
  };
  if (settingControls[control]) {
    const [key, read] = settingControls[control];
    await saveSetting(key, read(payload));
    await reloadLibrary();
    applyMotionPreference();
    showToast("Настройка сохранена.");
    return;
  }

  if (control === "roll-tag") {
    setRollPoolTag(payload.value);
    return;
  }

  // Поле поиска друга держит своё значение в состоянии: перерисовка заменяет
  // разметку целиком, поэтому фокус возвращает focusControl.
  if (control === "friend-search") {
    state.friends = {
      ...state.friends,
      search: {
        ...state.friends.search,
        query: payload.value,
        error: "",
        notice: "",
        profile: null,
      },
    };
    state.focusControl = "friend-search";
    render();
    return;
  }
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

// Зрителя больше не вводят руками: оценку ставит аккаунт — свой или друга.
// Поэтому в диалоге список, а не поле, и одно и то же имя не может попасть в
// библиотеку в двух написаниях.
function openRatingDialog(movieId) {
  const movie = state.library.movies.find((item) => item.id === movieId);
  if (!movie) return;

  const viewers = buildViewers(state.account, state.friends.rows);
  if (viewers.length === 0) {
    throw new Error("Оценку ставит аккаунт: войдите, чтобы оценивать фильмы.");
  }

  openDialog({
    title: "Оценить фильм",
    body: `
      <p class="confirmation-text">${escapeHtml(movie.title)}</p>
      <label class="field">
        <span>Зритель</span>
        <select name="participantUserId" required>
          ${viewers.map((viewer) => `
            <option value="${escapeAttribute(viewer.userId)}">
              ${escapeHtml(viewer.name)}${viewer.isSelf ? " — вы" : ` — @${escapeHtml(viewer.handle)}`}
            </option>
          `).join("")}
        </select>
      </label>
      <label class="field">
        <span>Оценка от 1 до 10, шаг 0,5</span>
        <input name="ratingValue" type="number" required min="1" max="10"
          step="0.5" value="8">
      </label>
      <p class="form-hint">${viewers.length > 1
        ? "Если этот зритель уже оценивал фильм, старая оценка будет заменена."
        : "В списке пока только вы: зрителями становятся принятые друзья."}</p>
    `,
    onSubmit: async (formData) => {
      const viewer = findViewer(viewers, String(formData.get("participantUserId")));
      if (!viewer) {
        throw new Error("Выберите зрителя из списка.");
      }
      const ratings = upsertRating(movie.ratings, {
        participantUserId: viewer.userId,
        participantName: viewer.name,
        value: formData.get("ratingValue"),
      });
      await saveMovie({
        ...movie,
        ratings,
        updatedAt: new Date().toISOString(),
      });
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

// Состав сессии набирается из аккаунтов: вы и принятые друзья. Раньше здесь
// было четыре поля с именами — с ними один и тот же человек попадал в историю
// то «Ильёй», то «ильей», и сейвы уходили не тому.
function openRollConfiguration() {
  if (state.rollDraftPool.length < 2) {
    throw new Error("Настройте квоты так, чтобы в пул попало минимум два участника.");
  }

  const viewers = buildViewers(state.account, state.friends.rows);
  if (viewers.length === 0) {
    throw new Error("Игроков берём из аккаунтов: войдите, чтобы начать сессию.");
  }

  const defaultSaves = Number(state.library.settings.savesEnabledAboveRemaining ?? 3);

  openDialog({
    title: "Настройка сессии",
    submitLabel: "Начать",
    body: `
      <p class="form-hint">Отметьте, кто играет, и задайте каждому число
      сейвов. Список — это вы и ваши друзья: имена берутся из аккаунтов.</p>
      <div class="player-picker">
        ${viewers.map((viewer, index) => `
          <div class="player-pick">
            <label class="player-pick__who">
              <input type="checkbox" name="player${index}"
                value="${escapeAttribute(viewer.userId)}"
                ${index === 0 ? "checked" : ""}>
              <span>
                <strong>${escapeHtml(viewer.name)}</strong>
                <small>${viewer.isSelf ? "вы" : `@${escapeHtml(viewer.handle)}`}</small>
              </span>
            </label>
            <label class="field player-pick__saves">
              <span>Сейвы</span>
              <input name="playerSaves${index}" type="number" min="0" max="99"
                value="3">
            </label>
          </div>
        `).join("")}
      </div>
      ${viewers.length === 1 ? `
        <p class="form-hint">Пока в списке только вы. Друзья появятся здесь,
        как только примут заявку в разделе «Друзья».</p>` : ""}
      <label class="field">
        <span>Сейвы работают, пока участников больше</span>
        <input name="saveThreshold" type="number" min="1"
          max="${state.rollDraftPool.length - 1}"
          value="${Math.min(defaultSaves, state.rollDraftPool.length - 1)}">
      </label>
    `,
    onSubmit: async (formData) => {
      const participants = viewers
        .map((viewer, index) => ({ viewer, index }))
        .filter(({ index }) => formData.get(`player${index}`) !== null)
        .map(({ viewer, index }) => ({
          userId: viewer.userId,
          handle: viewer.handle,
          name: viewer.name,
          saves: formData.get(`playerSaves${index}`),
        }));

      if (participants.length === 0) {
        throw new Error("Отметьте хотя бы одного игрока.");
      }

      state.activeSession = createRollSession({
        pool: state.rollDraftPool,
        participants,
        savesEnabledAboveRemaining: formData.get("saveThreshold"),
      });
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
      {
        soundEnabled: state.library.settings.soundEnabled !== false,
        reducedMotion: state.library.settings.reducedMotion === true,
      },
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

function handleGlobalKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (state.libraryLocked) {
      openAccountScreen("signin", "Войдите, чтобы искать по библиотеке.")
        .catch(showUnexpectedError);
    } else if (isPaletteOpen()) {
      closePalette();
    } else {
      openCommandPalette();
    }
    return;
  }

  if (event.key === "Escape" && state.shortcutsOpen) {
    event.preventDefault();
    setShortcutsOpen(false);
    return;
  }

  if (event.key === "Escape" && state.modalView && !isPaletteOpen()) {
    event.preventDefault();
    closeModalView();
    return;
  }

  if (event.key === "Escape" && state.accountPanel.open && !isPaletteOpen()) {
    event.preventDefault();
    closeAccountPanel();
    return;
  }

  // Одиночные клавиши работают только в библиотеке и только когда человек
  // ничего не набирает. Разбор идёт по event.code, поэтому раскладка
  // клавиатуры значения не имеет.
  if (isShortcutContext(event) && !state.modalView) {
    if (event.code === "Slash" && event.shiftKey) {
      event.preventDefault();
      setShortcutsOpen(!state.shortcutsOpen);
      return;
    }
    // Дальше — команды, которые меняют экран: при открытой шпаргалке они
    // сработали бы вслепую.
    if (state.shortcutsOpen) return;
    if (event.code === "Slash") {
      event.preventDefault();
      focusCatalogSearch();
      return;
    }
    if (event.code === "KeyN") {
      event.preventDefault();
      openMovieDialog();
      return;
    }
    if (event.code === "KeyR") {
      event.preventDefault();
      openLuckyMovie();
      return;
    }
  }

  if (event.key === "Escape" && state.detailMovieId && !isPaletteOpen()) {
    event.preventDefault();
    closeMovieDetail();
    return;
  }

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

// Условия, при которых одиночная клавиша означает команду, а не ввод текста.
function isShortcutContext(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (state.libraryLocked) return false;
  if (isPaletteOpen() || document.querySelector("dialog[open]")) return false;
  const active = document.activeElement;
  if (active?.isContentEditable) return false;
  return !["INPUT", "SELECT", "TEXTAREA"].includes(active?.tagName);
}

function openMovieDialog(movieId = null) {
  const movie = state.library.movies.find((item) => item.id === movieId);
  const categoryOptions = buildCategoryOptions(movie?.categoryId);

  openDialog({
    title: movie ? "Редактировать фильм" : "Добавить фильм",
    submitLabel: movie ? "Сохранить изменения" : "Добавить в библиотеку",
    variant: "movie",
    body: `
      <input type="hidden" name="tmdbId" value="${movie?.tmdbId ?? ""}">
      <input type="hidden" name="tmdbPosterPath" value="">

      <section class="movie-search-flow">
        ${state.tmdbStatus.configured ? `
          <div class="movie-search-flow__intro">
            <span class="movie-search-flow__icon" aria-hidden="true">⌕</span>
            <div>
              <h3>${movie ? "Найти другую карточку в TMDB" : "Найдите фильм в TMDB"}</h3>
              <p>Название, год, жанры, описание и постер заполнятся автоматически.</p>
            </div>
          </div>
          <div class="tmdb-search-box">
            <input name="tmdbQuery" type="search" maxlength="180"
              autocomplete="off" placeholder="Например, Интерстеллар"
              aria-label="Название фильма для поиска в TMDB"
              value="${escapeAttribute(movie?.title ?? "")}">
            <button class="btn btn--primary" type="button" data-tmdb-search>
              Найти
            </button>
          </div>
          <div class="tmdb-results" data-tmdb-results aria-live="polite"></div>
        ` : `
          <div class="tmdb-connect-card">
            <span class="movie-search-flow__icon" aria-hidden="true">⌕</span>
            <div>
              <h3>Поиск по TMDB сейчас недоступен</h3>
              <p>Карточку можно заполнить руками — поля ниже. Поиск вернётся,
              когда служба ответит.</p>
            </div>
          </div>
        `}
      </section>

      <label class="field">
        <span>Список</span>
        <select name="categoryId">
          <option value="">Без списка</option>
          ${categoryOptions}
        </select>
      </label>

      <details class="movie-manual-fields" ${movie ? "open" : ""} data-movie-manual>
        <summary>${movie ? "Данные фильма" : "Добавить вручную или изменить данные"}</summary>
        <div class="movie-manual-fields__body">
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
            <span>Жанры</span>
            <input name="genres" maxlength="300" placeholder="Фантастика, драма"
              value="${escapeAttribute((movie?.genres ?? []).join(", "))}">
          </label>
          <label class="field">
            <span>Описание</span>
            <textarea name="overview" maxlength="3000" rows="4">${escapeHtml(movie?.overview ?? "")}</textarea>
          </label>
          <label class="field">
            <span>Постер (URL или локальный путь)</span>
            <input name="coverUrl" type="text" inputmode="url" maxlength="2000"
              value="${escapeAttribute(movie?.coverUrl ?? "")}">
          </label>
          <label class="field">
            <span>Теги</span>
            <input name="tags" maxlength="300" placeholder="Вечер пятницы, пересмотр"
              value="${escapeAttribute((movie?.tags ?? []).join(", "))}">
            <small class="field__hint">Свои метки через запятую: по ним можно
            фильтровать каталог.</small>
          </label>
          <label class="field">
            <span>Личная заметка</span>
            <textarea name="notes" maxlength="2000" rows="3"
              placeholder="Почему стоит посмотреть, с кем и когда">${escapeHtml(movie?.notes ?? "")}</textarea>
          </label>
        </div>
      </details>
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
        tags: parseTagInput(formData.get("tags")),
        notes: formData.get("notes"),
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
        // Картинку отдаёт CDN TMDB: у себя остаётся только путь.
        candidate.posterPath = posterPath;
        candidate.tmdbUpdatedAt = new Date().toISOString();
      }

      await saveMovie(createMovie(candidate));
      await reloadLibrary();
    },
  });
  setupMovieDialog(movie);
}

// Пакетное обогащение: TMDB отвечает по одному фильму, поэтому проход идёт
// последовательно, показывает прогресс и в любой момент прерывается закрытием
// диалога.
const ENRICHMENT_DELAY_MS = 150;
const ENRICHMENT_FAILURE_LIMIT = 3;

function openEnrichmentDialog() {
  if (!state.tmdbStatus.configured) {
    showToast("TMDB не подключён на сервере.");
    return;
  }

  const candidates = selectEnrichmentCandidates(state.library.movies);
  if (candidates.length === 0) {
    showToast("Все фильмы уже связаны с TMDB.");
    return;
  }

  let results = [];
  openDialog({
    title: "Обогащение библиотеки",
    submitLabel: `Обогатить ${candidates.length}`,
    variant: "enrich",
    body: `
      <p>${candidates.length} ${pluralizeMovies(candidates.length)} без карточки
      TMDB или без части метаданных. CineVault найдёт их по названию и году,
      скачает постеры и заполнит пустые поля.</p>
      <label class="switch-field">
        <input type="checkbox" name="overwrite">
        <span class="switch-field__box">✓</span>
        <span class="switch-field__text">
          <strong>Перезаписывать заполненные поля</strong>
          <small>Иначе описание, страна и жанры, введённые вручную, останутся как есть.</small>
        </span>
      </label>
      <p class="form-hint">Спорные совпадения не применяются автоматически —
      их список появится в конце.</p>
      <div class="enrich-progress" data-enrich-progress hidden>
        <span class="progress"><span style="--value:0%"></span></span>
        <p data-enrich-status>Готовим список…</p>
      </div>
    `,
    onSubmit: async (formData) => {
      results = await runEnrichment(candidates, {
        overwrite: formData.get("overwrite") === "on",
      });
      await reloadLibrary();
    },
    onSuccess: () => openEnrichmentSummary(results),
  });
}

async function runEnrichment(candidates, { overwrite }) {
  const dialog = document.querySelector("#entity-dialog");
  const progress = dialog?.querySelector("[data-enrich-progress]");
  const bar = progress?.querySelector(".progress > span");
  const status = progress?.querySelector("[data-enrich-status]");
  progress?.removeAttribute("hidden");

  const results = [];
  let consecutiveFailures = 0;

  for (const [index, movie] of candidates.entries()) {
    // Закрытие диалога — это отмена: продолжать фоновые запросы незачем.
    if (!dialog?.open) break;

    if (bar) bar.style.setProperty("--value", `${Math.round((index / candidates.length) * 100)}%`);
    if (status) {
      status.textContent = `${index + 1} из ${candidates.length}: ${movie.title}`;
    }

    try {
      const result = await enrichSingleMovie(movie, { overwrite });
      results.push(result);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      results.push({
        outcome: "failed",
        movie,
        message: error instanceof Error ? error.message : String(error),
      });
      if (consecutiveFailures >= ENRICHMENT_FAILURE_LIMIT) {
        throw new Error(
          "TMDB не отвечает несколько раз подряд. Проверьте интернет и токен.",
        );
      }
    }

    await delay(ENRICHMENT_DELAY_MS);
  }

  if (bar) bar.style.setProperty("--value", "100%");
  return results;
}

async function enrichSingleMovie(movie, { overwrite }) {
  let found = await searchTmdbMovies(movie.title, movie.releaseYear ?? null);
  // Год в библиотеке может быть годом релиза в России, а не мировой премьеры.
  if (movie.releaseYear && (found.results ?? []).length === 0) {
    found = await searchTmdbMovies(movie.title, null);
  }

  const { match, confidence, alternatives } = pickBestMatch(movie, found.results ?? []);
  if (!match) {
    return { outcome: "missing", movie };
  }
  if (confidence === MATCH_CONFIDENCE.unsure) {
    return { outcome: "review", movie, alternatives };
  }

  const details = await getTmdbMovie(match.id);
  const patch = buildEnrichmentPatch(movie, details, { overwrite });
  await saveMovie(createMovie({ ...movie, ...patch }));
  return { outcome: "updated", movie, confidence, title: match.title };
}

function openEnrichmentSummary(results) {
  const summary = summarizeEnrichment(results);
  const pending = results.filter(
    (result) => result.outcome === "review" || result.outcome === "missing",
  );
  const failed = results.filter((result) => result.outcome === "failed");

  openDialog({
    title: "Обогащение завершено",
    submitLabel: "Готово",
    variant: "enrich",
    body: `
      <div class="kv-list">
        <div><span>Обновлено</span><b>${summary.updated}</b></div>
        <div><span>Нужен выбор</span><b>${summary.review}</b></div>
        <div><span>Не найдено</span><b>${summary.missing}</b></div>
        <div><span>Ошибок</span><b>${summary.failed}</b></div>
      </div>
      ${pending.length ? `
        <p class="form-hint">Эти фильмы TMDB не смог определить однозначно.
        Откройте карточку и выберите нужный вариант вручную.</p>
        <div class="enrich-list">
          ${pending.map((result) => `
            <div class="enrich-list__row">
              <span>
                <strong>${escapeHtml(result.movie.title)}</strong>
                <small>${result.outcome === "review"
                  ? `${result.alternatives.length} похожих карточек`
                  : "совпадений не найдено"}</small>
              </span>
              <button class="btn btn--ghost btn--sm" type="button"
                data-enrich-fix="${escapeAttribute(result.movie.id)}">Подобрать</button>
            </div>
          `).join("")}
        </div>` : ""}
      ${failed.length ? `
        <p class="form-error is-visible">${escapeHtml(failed[0].message)}</p>` : ""}
    `,
    onSubmit: async () => {},
  });

  document.querySelectorAll("[data-enrich-fix]").forEach((button) => {
    button.addEventListener("click", () => {
      openMovieDialog(button.dataset.enrichFix);
    });
  });
}

function pluralizeMovies(count) {
  const forms = ["фильм", "фильма", "фильмов"];
  const value = Math.abs(count) % 100;
  const remainder = value % 10;
  if (value > 10 && value < 20) return forms[2];
  if (remainder > 1 && remainder < 5) return forms[1];
  if (remainder === 1) return forms[0];
  return forms[2];
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function changeTheme() {
  state.theme = applyTheme(toggleTheme(state.theme));
  saveTheme(state.theme);
  render();
}

function setupTmdbMovieSearch() {
  const dialog = document.querySelector("#entity-dialog");
  const form = dialog?.querySelector("form");
  const button = form?.querySelector("[data-tmdb-search]");
  const resultsNode = form?.querySelector("[data-tmdb-results]");
  if (!form || !button || !resultsNode) return;

  const search = async () => {
    const title = form.elements.tmdbQuery.value.trim();
    if (!title) {
      resultsNode.innerHTML = '<p class="form-hint">Введите название фильма.</p>';
      form.elements.tmdbQuery.focus();
      return;
    }
    button.disabled = true;
    resultsNode.innerHTML = '<div class="tmdb-search-status"><span></span>Ищем в TMDB…</div>';
    try {
      const payload = await searchTmdbMovies(title);
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
  };

  button.addEventListener("click", search);
  form.elements.tmdbQuery.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    search();
  });
}

function setupMovieDialog(movie) {
  const dialog = document.querySelector("#entity-dialog");
  const form = dialog?.querySelector("form");
  const submitButton = form?.querySelector("[data-dialog-submit]");
  const titleInput = form?.elements.title;
  const manualFields = form?.querySelector("[data-movie-manual]");
  if (!form || !submitButton || !titleInput) return;

  const updateSubmitAvailability = () => {
    submitButton.disabled = !titleInput.value.trim();
  };
  titleInput.addEventListener("input", updateSubmitAvailability);
  manualFields?.addEventListener("toggle", () => {
    if (manualFields.open && !titleInput.value.trim()) titleInput.focus();
  });
  updateSubmitAvailability();
  if (state.tmdbStatus.configured) setupTmdbMovieSearch();
}

function renderTmdbResults(container, results) {
  if (results.length === 0) {
    container.innerHTML = '<p class="form-hint">Совпадений не найдено.</p>';
    return;
  }
  container.innerHTML = results.map((movie) => {
    const year = String(movie.release_date ?? "").slice(0, 4) || "год неизвестен";
    const poster = tmdbPosterUrl(movie.poster_path, POSTER_SIZES.row);
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
    form.elements.title.dispatchEvent(new Event("input", { bubbles: true }));
    const poster = tmdbPosterUrl(movie.poster_path, POSTER_SIZES.row);
    const year = String(movie.release_date ?? "").slice(0, 4) || "год неизвестен";
    resultsNode.innerHTML = `
      <div class="tmdb-selected-card">
        ${poster
          ? `<img src="${escapeAttribute(poster)}" alt="" loading="lazy">`
          : '<span class="tmdb-result__poster">Нет постера</span>'}
        <div>
          <small>Готово к добавлению</small>
          <strong>${escapeHtml(movie.title || movie.original_title || "Без названия")}</strong>
          <span>${escapeHtml(year)}${movie.runtime ? ` · ${movie.runtime} мин` : ""}</span>
        </div>
        <span class="tmdb-selected-card__check" aria-hidden="true">✓</span>
      </div>`;
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

function openCategoryDialog(categoryId = null, requestedParentId = null) {
  const category = state.library.categories.find((item) => item.id === categoryId);
  const excludedIds = category ? getCategoryDescendantIds(category.id) : new Set();
  if (category) {
    excludedIds.add(category.id);
  }
  const selectedParentId = category?.parentId ?? requestedParentId ?? null;

  openDialog({
    title: category ? "Редактировать список" : "Новый список",
    body: `
      <label class="field">
        <span>Название *</span>
        <input name="name" required maxlength="120"
          value="${escapeAttribute(category?.name ?? "")}">
      </label>
      <label class="field">
        <span>Родительский список</span>
        <select name="parentId">
          <option value="">Корневой список</option>
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
        throw new Error("Список с таким названием уже существует на этом уровне.");
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
        <span>Список</span>
        <select name="categoryId">
          <option value="">Без списка</option>
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

// Любое удаление проходит через один путь: снимаем обратные команды до
// применения и предлагаем вернуть всё как было.
async function commitReversible(commands, { message, undoMessage = "Возвращено" }) {
  const undoCommands = buildUndoCommands(state.library, commands);
  await commitLibraryChanges(commands);
  await reloadLibrary();

  showToast(message, {
    actionLabel: "Вернуть",
    onAction: () => {
      restoreFromUndo(undoCommands, undoMessage).catch(showUnexpectedError);
    },
  });
}

async function restoreFromUndo(undoCommands, message) {
  await commitLibraryChanges(undoCommands);
  await reloadLibrary();
  showToast(message);
}

function confirmMovieDeletion(movieId) {
  const movie = state.library.movies.find((item) => item.id === movieId);
  if (!movie) return;

  openConfirmation(
    "Удалить фильм?",
    `«${movie.title}» будет удалён из библиотеки и всех франшиз.`,
    async () => {
      await commitReversible(
        buildMovieDeletionCommands(state.library, movieId),
        { message: `Фильм «${movie.title}» удалён`, undoMessage: "Фильм возвращён" },
      );
    },
  );
}

function confirmCategoryDeletion(categoryId) {
  const category = state.library.categories.find((item) => item.id === categoryId);
  if (!category) return;

  openConfirmation(
    "Удалить список?",
    `Фильмы из «${category.name}» перейдут в «Без списка», а вложенные списки поднимутся на уровень выше.`,
    async () => {
      await commitReversible(
        buildCategoryDeletionCommands(state.library, categoryId),
        { message: `Список «${category.name}» удалён`, undoMessage: "Список возвращён" },
      );
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
      await commitReversible(
        [{ type: "delete", storeName: STORE_NAMES.franchises, key: franchiseId }],
        { message: `Коллекция «${franchise.name}» удалена`, undoMessage: "Коллекция возвращена" },
      );
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
  // Расхождение версий — не поломка: библиотеку правили с другого устройства.
  // Показываем это словами и перечитываем её, а не оставляем экран с чужим
  // текстом ошибки Postgres.
  if (isLibraryConflict(error)) {
    openDialog({
      title: "Библиотека изменилась",
      submitLabel: "Обновить",
      body: `
        <p class="confirmation-text">Библиотеку изменили на другом устройстве,
        поэтому последнее действие не сохранено. Обновите её и повторите.</p>
      `,
      onSubmit: async () => {
        await reloadLibrary();
      },
    });
    return;
  }

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
