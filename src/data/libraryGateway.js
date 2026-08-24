// Серверная реализация хранилища библиотеки.
//
// Повторяет интерфейс libraryRepository.js один в один: main.js вызывает те же
// функции с теми же аргументами и не знает, откуда пришли данные. Переключение
// произойдёт в этапе 16, когда появится живой проект и станет что проверять;
// до этого момента модуль в приложении не используется.

import { STORE_NAMES } from "../config.js";
import { getSupabaseClient } from "../services/supabaseClient.js";
import {
  categoryFromRow,
  commandToPayload,
  franchiseFromRow,
  movieFromRow,
  participantFromRow,
  rollSessionFromRow,
} from "./rowMapping.js";

let cachedOwnerId = null;

export async function getOwnerId() {
  if (cachedOwnerId) return cachedOwnerId;
  const client = await getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const id = data.session?.user?.id;
  if (!id) throw new Error("Нет активной сессии.");
  cachedOwnerId = id;
  return id;
}

export function forgetOwner() {
  cachedOwnerId = null;
}

export async function loadLibrary() {
  const client = await getSupabaseClient();
  const ownerId = await getOwnerId();

  const [movies, categories, franchises, links, ratings, participants, sessions, settings] =
    await Promise.all([
      select(client, "movies", "*", (query) => query.is("deleted_at", null)),
      select(client, "categories", "*"),
      select(client, "franchises", "*"),
      select(client, "franchise_movies", "movie_id, franchise_id, sort_order"),
      select(client, "ratings", "*", (query) => query.eq("owner_id", ownerId)),
      select(client, "participants", "*"),
      select(client, "roll_sessions", "*", (query) => query.eq("host_id", ownerId)),
      client.from("user_settings").select("data").maybeSingle(),
    ]);

  if (settings.error) throw settings.error;

  const ratingsByMovie = new Map();
  for (const rating of ratings) {
    const list = ratingsByMovie.get(rating.movie_id) ?? [];
    list.push(rating);
    ratingsByMovie.set(rating.movie_id, list);
  }

  const moviesByFranchise = new Map();
  for (const link of [...links].sort((a, b) => a.sort_order - b.sort_order)) {
    const list = moviesByFranchise.get(link.franchise_id) ?? [];
    list.push(link.movie_id);
    moviesByFranchise.set(link.franchise_id, list);
  }

  return {
    movies: movies.map((row) => movieFromRow(row, ratingsByMovie.get(row.id) ?? [])),
    categories: categories.map(categoryFromRow),
    franchises: franchises.map((row) =>
      franchiseFromRow(row, moviesByFranchise.get(row.id) ?? []),
    ),
    participants: participants.map(participantFromRow),
    rollSessions: sessions.map(rollSessionFromRow),
    settings: settings.data?.data ?? {},
  };
}

export function saveMovie(movie) {
  return commit([{ type: "put", storeName: STORE_NAMES.movies, value: movie }]).then(
    () => movie,
  );
}

export function saveCategory(category) {
  return commit([
    { type: "put", storeName: STORE_NAMES.categories, value: category },
  ]).then(() => category);
}

export function saveFranchise(franchise) {
  return commit([
    { type: "put", storeName: STORE_NAMES.franchises, value: franchise },
  ]).then(() => franchise);
}

export function saveParticipant(participant) {
  return commit([
    { type: "put", storeName: STORE_NAMES.participants, value: participant },
  ]).then(() => participant);
}

export function saveRollSession(session) {
  return commit([
    { type: "put", storeName: STORE_NAMES.rollSessions, value: session },
  ]).then(() => session);
}

export function saveSetting(key, value) {
  return commit([
    { type: "put", storeName: STORE_NAMES.settings, value: { key, value } },
  ]).then(() => ({ key, value }));
}

export function deleteMovieRecord(movieId) {
  return commit([{ type: "delete", storeName: STORE_NAMES.movies, key: movieId }]);
}

export function deleteCategoryRecord(categoryId) {
  return commit([
    { type: "delete", storeName: STORE_NAMES.categories, key: categoryId },
  ]);
}

export function deleteFranchiseRecord(franchiseId) {
  return commit([
    { type: "delete", storeName: STORE_NAMES.franchises, key: franchiseId },
  ]);
}

export function deleteParticipantRecord(participantId) {
  return commit([
    { type: "delete", storeName: STORE_NAMES.participants, key: participantId },
  ]);
}

export function commitLibraryChanges(commands) {
  return commit(commands);
}

// Перенос существующей библиотеки: подготовленные данные уходят одной
// транзакцией. Отчёт о правках строится до вызова, в domain/libraryMigration.js.
export async function importLibrary(library) {
  const client = await getSupabaseClient();
  const ownerId = await getOwnerId();

  const payload = {
    categories: library.categories.map(
      (category) => commandToPayload(
        { type: "put", storeName: STORE_NAMES.categories, value: category },
        ownerId,
      ).row,
    ),
    movies: library.movies.map((movie) => {
      const mapped = commandToPayload(
        { type: "put", storeName: STORE_NAMES.movies, value: movie },
        ownerId,
      );
      return { ...mapped.row, ratings: mapped.ratings };
    }),
    franchises: library.franchises.map((franchise) => {
      const mapped = commandToPayload(
        { type: "put", storeName: STORE_NAMES.franchises, value: franchise },
        ownerId,
      );
      return { ...mapped.row, movie_ids: mapped.movie_ids };
    }),
    participants: library.participants.map(
      (participant) => commandToPayload(
        { type: "put", storeName: STORE_NAMES.participants, value: participant },
        ownerId,
      ).row,
    ),
  };

  const { data, error } = await client.rpc("import_library", { payload });
  if (error) throw error;
  return data;
}

async function commit(commands) {
  if (!Array.isArray(commands) || commands.length === 0) return;
  const client = await getSupabaseClient();
  const ownerId = await getOwnerId();

  const { error } = await client.rpc("apply_library_changes", {
    commands: commands.map((command) => commandToPayload(command, ownerId)),
  });
  if (error) throw error;
}

async function select(client, table, columns, refine = (query) => query) {
  const { data, error } = await refine(client.from(table).select(columns));
  if (error) throw error;
  return data ?? [];
}
