import { STORE_NAMES } from "../config.js";
import { getAllRecords, putRecord } from "./database.js";

export async function loadLibrary() {
  const [movies, categories, franchises, participants, rollSessions] =
    await Promise.all([
      getAllRecords(STORE_NAMES.movies),
      getAllRecords(STORE_NAMES.categories),
      getAllRecords(STORE_NAMES.franchises),
      getAllRecords(STORE_NAMES.participants),
      getAllRecords(STORE_NAMES.rollSessions),
    ]);

  return {
    movies,
    categories,
    franchises,
    participants,
    rollSessions,
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

