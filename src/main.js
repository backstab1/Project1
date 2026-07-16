import { LEGACY_STORAGE_KEYS } from "./config.js";
import { initializeDatabase } from "./data/database.js";
import { loadLibrary } from "./data/libraryRepository.js";
import { buildLibraryStatistics } from "./domain/statistics.js";
import { renderAppShell } from "./ui/appShell.js";

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

function detectLegacyData() {
  try {
    return LEGACY_STORAGE_KEYS.some((key) => localStorage.getItem(key) !== null);
  } catch {
    return false;
  }
}

