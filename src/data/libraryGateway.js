// Хранилище библиотеки: Postgres через supabase-js.
//
// Приложение обращается сюда не напрямую, а через data/libraryStore.js — там
// же лежит снимок последней загрузки. Интерфейс достался от прежнего
// локального репозитория дословно, поэтому вызовы в main.js не менялись.
//
// Запись идёт одним RPC: функция Postgres — это транзакция, поэтому пакет
// применяется целиком или не применяется вовсе. Вместе с пакетом уходит
// ревизия библиотеки, с которой он собран: если на сервере она уже другая,
// запись отвергается, а приложение показывает, что произошло.

import { DEFAULT_SETTINGS, STORE_NAMES } from "../config.js";
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
// Ревизия библиотеки на момент последней загрузки. null означает «ещё не
// читали»: такой пакет уходит без проверки, иначе первая же запись после
// восстановления соединения упиралась бы в сравнение с пустотой.
let cachedRevision = null;

// Отдельный класс, потому что это не поломка, а нормальный исход: кто-то
// изменил библиотеку с другого устройства, и приложению нужно перечитать её,
// а не показывать пользователю текст ошибки Postgres.
export class LibraryConflictError extends Error {
  constructor() {
    super(
      "Библиотека изменилась на другом устройстве. " +
        "Обновите её и повторите действие.",
    );
    this.name = "LibraryConflictError";
  }
}

export function isLibraryConflict(error) {
  return error instanceof LibraryConflictError || error?.code === "40001";
}

export function getLibraryRevision() {
  return cachedRevision;
}

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
  cachedRevision = null;
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
      client.from("user_settings").select("data, revision").maybeSingle(),
    ]);

  if (settings.error) throw settings.error;
  // Строки настроек у нового аккаунта ещё нет: его библиотека пуста, а
  // ревизия начинается с нуля — с ней же её заведёт первая запись.
  cachedRevision = Number(settings.data?.revision ?? 0);

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
    // Значения по умолчанию подставляются здесь: у нового аккаунта строки
    // настроек ещё нет, а разделы приложения ждут полный набор.
    settings: { ...DEFAULT_SETTINGS, ...(settings.data?.data ?? {}) },
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

async function commit(commands) {
  if (!Array.isArray(commands) || commands.length === 0) return;
  const client = await getSupabaseClient();
  const ownerId = await getOwnerId();

  const { data, error } = await client.rpc("apply_library_changes", {
    commands: commands.map((command) => commandToPayload(command, ownerId)),
    expected_revision: cachedRevision,
  });
  if (error) {
    if (error.code === "40001") throw new LibraryConflictError();
    throw error;
  }
  cachedRevision = Number(data);
}

async function select(client, table, columns, refine = (query) => query) {
  const { data, error } = await refine(client.from(table).select(columns));
  if (error) throw error;
  return data ?? [];
}
