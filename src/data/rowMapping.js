// Перевод между записями приложения и строками Postgres.
//
// Приложение говорит camelCase и держит оценки внутри фильма, а франшизу — со
// списком идентификаторов внутри. База так не умеет: оценка должна быть
// отдельной строкой, иначе оценку друга нельзя разрешить, не отдав ему право
// на запись во всю карточку. Разница живёт здесь и больше нигде.

import { STORE_NAMES } from "../config.js";

export const TABLES = Object.freeze({
  [STORE_NAMES.movies]: "movies",
  [STORE_NAMES.categories]: "categories",
  [STORE_NAMES.franchises]: "franchises",
  [STORE_NAMES.participants]: "participants",
  [STORE_NAMES.rollSessions]: "roll_sessions",
  [STORE_NAMES.settings]: "user_settings",
});

function nullable(value) {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

export function movieToRow(movie, ownerId) {
  return {
    id: movie.id,
    owner_id: ownerId,
    category_id: movie.categoryId ?? null,
    category_position: movie.categoryPosition ?? 0,
    title: movie.title,
    normalized_title: movie.normalizedTitle,
    original_title: movie.originalTitle ?? "",
    tmdb_id: movie.tmdbId ?? null,
    overview: movie.overview ?? "",
    genres: movie.genres ?? [],
    tags: movie.tags ?? [],
    notes: movie.notes ?? "",
    is_favorite: Boolean(movie.isFavorite),
    status: movie.status,
    watched_at: movie.watchedAt ?? null,
    cover_url: movie.coverUrl ?? "",
    release_year: movie.releaseYear ?? null,
    duration_minutes: movie.durationMinutes ?? null,
    country: movie.country ?? "",
    tmdb_updated_at: movie.tmdbUpdatedAt ?? null,
    created_at: movie.createdAt,
    updated_at: movie.updatedAt,
  };
}

export function movieFromRow(row, ratings = []) {
  return {
    id: row.id,
    title: row.title,
    normalizedTitle: row.normalized_title,
    originalTitle: row.original_title ?? "",
    tmdbId: row.tmdb_id ?? null,
    overview: row.overview ?? "",
    genres: row.genres ?? [],
    tmdbUpdatedAt: row.tmdb_updated_at ?? null,
    categoryId: row.category_id ?? null,
    categoryPosition: row.category_position ?? 0,
    coverUrl: row.cover_url ?? "",
    releaseYear: row.release_year ?? null,
    durationMinutes: row.duration_minutes ?? null,
    country: row.country ?? "",
    tags: row.tags ?? [],
    notes: row.notes ?? "",
    isFavorite: Boolean(row.is_favorite),
    status: row.status,
    watchedAt: row.watched_at ?? null,
    ratings: ratings.map(ratingFromRow),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function ratingToRow(rating, movieId, ownerId) {
  return {
    id: rating.id,
    movie_id: movieId,
    owner_id: ownerId,
    // Зритель — это аккаунт. null остаётся только у оценок, которые пришли из
    // версии с ручным вводом имён и ещё не сопоставлены с профилем.
    rater_user_id: rating.participantUserId ?? rating.raterUserId ?? null,
    rater_name: rating.participantName,
    normalized_rater_name: rating.normalizedParticipantName,
    value: rating.value,
    created_at: rating.createdAt,
  };
}

export function ratingFromRow(row) {
  return {
    id: row.id,
    participantUserId: row.rater_user_id ?? null,
    participantName: row.rater_name,
    normalizedParticipantName: row.normalized_rater_name,
    value: Number(row.value),
    createdAt: row.created_at,
  };
}

export function categoryToRow(category, ownerId) {
  return {
    id: category.id,
    owner_id: ownerId,
    parent_id: category.parentId ?? null,
    name: category.name,
    normalized_name: category.normalizedName,
    sort_order: category.position ?? 0,
    roll_quota: category.rollQuota ?? 0,
    created_at: category.createdAt,
    updated_at: category.updatedAt,
  };
}

export function categoryFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    parentId: row.parent_id ?? null,
    position: row.sort_order ?? 0,
    rollQuota: row.roll_quota ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function franchiseToRow(franchise, ownerId) {
  return {
    id: franchise.id,
    owner_id: ownerId,
    category_id: franchise.categoryId ?? null,
    category_position: franchise.categoryPosition ?? 0,
    name: franchise.name,
    normalized_name: franchise.normalizedName,
    created_at: franchise.createdAt,
    updated_at: franchise.updatedAt,
  };
}

export function franchiseFromRow(row, movieIds = []) {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    categoryId: row.category_id ?? null,
    categoryPosition: row.category_position ?? 0,
    movieIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function participantToRow(participant, ownerId) {
  return {
    id: participant.id,
    owner_id: ownerId,
    name: participant.name,
    normalized_name: participant.normalizedName,
    last_used_at: participant.lastUsedAt,
    created_at: participant.createdAt,
    updated_at: participant.updatedAt,
  };
}

export function participantFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rollSessionToRow(session, ownerId) {
  return {
    id: session.id,
    host_id: ownerId,
    status: session.status === "active" ? "active" : "completed",
    state: session,
    save_threshold: Math.max(1, session.savesEnabledAboveRemaining ?? 1),
    completed_at: session.completedAt ?? null,
    created_at: session.createdAt,
  };
}

export function rollSessionFromRow(row) {
  return { ...row.state, id: row.id };
}

// Команды пакетной записи приходят из domain/* в общем виде и не знают ничего
// про сервер. Здесь они превращаются в задание для RPC apply_library_changes.
export function commandToPayload(command, ownerId) {
  const table = TABLES[command.storeName];
  if (!table) {
    throw new TypeError(`Неизвестное хранилище: ${command.storeName}`);
  }

  if (command.type === "delete") {
    return { table, op: "delete", id: command.key };
  }
  if (command.type !== "put") {
    throw new TypeError(`Неизвестная операция: ${command.type}`);
  }

  const value = command.value;
  if (table === "movies") {
    return {
      table,
      op: "put",
      row: movieToRow(value, ownerId),
      ratings: (value.ratings ?? []).map((rating) =>
        ratingToRow(rating, value.id, ownerId),
      ),
    };
  }
  if (table === "franchises") {
    return {
      table,
      op: "put",
      row: franchiseToRow(value, ownerId),
      movie_ids: value.movieIds ?? [],
    };
  }
  if (table === "categories") {
    return { table, op: "put", row: categoryToRow(value, ownerId) };
  }
  if (table === "participants") {
    return { table, op: "put", row: participantToRow(value, ownerId) };
  }
  if (table === "roll_sessions") {
    return { table, op: "put", row: rollSessionToRow(value, ownerId) };
  }
  if (table === "user_settings") {
    return { table, op: "setting", key: value.key, value: value.value ?? null };
  }

  throw new TypeError(`Нечего делать с таблицей ${table}.`);
}

export { nullable };
