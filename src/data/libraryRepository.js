import { STORE_NAMES } from "../config.js";
import {
  applyBatch,
  deleteRecord,
  getAllRecords,
  putRecord,
} from "./database.js";

export async function loadLibrary() {
  const [movies, categories, franchises, participants, rollSessions, settings] =
    await Promise.all([
      getAllRecords(STORE_NAMES.movies),
      getAllRecords(STORE_NAMES.categories),
      getAllRecords(STORE_NAMES.franchises),
      getAllRecords(STORE_NAMES.participants),
      getAllRecords(STORE_NAMES.rollSessions),
      getAllRecords(STORE_NAMES.settings),
    ]);

  return {
    movies,
    categories,
    franchises,
    participants,
    rollSessions,
    settings: Object.fromEntries(settings.map((item) => [item.key, item.value])),
  };
}

export function saveMovie(movie) {
  return putRecord(STORE_NAMES.movies, movie);
}

export function saveCategory(category) {
  return putRecord(STORE_NAMES.categories, category);
}

export function saveFranchise(franchise) {
  return putRecord(STORE_NAMES.franchises, franchise);
}

export function saveParticipant(participant) {
  return putRecord(STORE_NAMES.participants, participant);
}

export function saveRollSession(session) {
  return putRecord(STORE_NAMES.rollSessions, session);
}

export function saveSetting(key, value) {
  return putRecord(STORE_NAMES.settings, { key, value });
}

export function deleteMovieRecord(movieId) {
  return deleteRecord(STORE_NAMES.movies, movieId);
}

export function deleteCategoryRecord(categoryId) {
  return deleteRecord(STORE_NAMES.categories, categoryId);
}

export function deleteFranchiseRecord(franchiseId) {
  return deleteRecord(STORE_NAMES.franchises, franchiseId);
}

export function commitLibraryChanges(commands) {
  return applyBatch(commands);
}
