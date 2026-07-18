import {
  createCategory,
  createFranchise,
  createMovie,
  createParticipant,
} from "./entities.js";

export const BACKUP_FORMAT = "cinevault-backup";
export const BACKUP_VERSION = 1;

export function createBackup(library) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      movies: library.movies,
      categories: library.categories,
      franchises: library.franchises,
      participants: library.participants,
      rollSessions: library.rollSessions,
      settings: library.settings ?? {},
    },
  };
}

export function parseBackup(value) {
  const backup = typeof value === "string" ? JSON.parse(value) : value;
  if (
    !backup ||
    backup.format !== BACKUP_FORMAT ||
    !Number.isInteger(backup.version) ||
    !backup.data
  ) {
    throw new Error("Файл не является резервной копией CineVault.");
  }
  if (backup.version > BACKUP_VERSION) {
    throw new Error("Резервная копия создана более новой версией CineVault.");
  }

  return {
    movies: normalizeList(backup.data.movies, createMovie),
    categories: normalizeList(backup.data.categories, createCategory),
    franchises: normalizeList(backup.data.franchises, createFranchise),
    participants: normalizeList(backup.data.participants, createParticipant),
    rollSessions: Array.isArray(backup.data.rollSessions)
      ? backup.data.rollSessions.filter((session) => session?.id)
      : [],
    settings: backup.data.settings && typeof backup.data.settings === "object"
      ? backup.data.settings
      : {},
  };
}

export function mergeLibraries(current, incoming) {
  const {
    items: categories,
    idMap: categoryIdMap,
  } = mergeCategories(current.categories, incoming.categories);

  const normalizedIncomingMovies = incoming.movies.map((movie) => ({
    ...movie,
    categoryId: categoryIdMap.get(movie.categoryId) ?? movie.categoryId ?? null,
  }));
  const {
    items: movies,
    idMap: movieIdMap,
  } = mergeMovies(current.movies, normalizedIncomingMovies);

  const franchises = mergeFranchises(
    current.franchises,
    incoming.franchises.map((franchise) => ({
      ...franchise,
      categoryId:
        categoryIdMap.get(franchise.categoryId) ?? franchise.categoryId ?? null,
      movieIds: franchise.movieIds
        .map((movieId) => movieIdMap.get(movieId) ?? movieId)
        .filter((movieId) => movies.some((movie) => movie.id === movieId)),
    })),
  );

  return {
    categories,
    movies,
    franchises,
    participants: mergeBy(
      current.participants,
      incoming.participants,
      (participant) => participant.normalizedName,
    ),
    rollSessions: mergeBy(
      current.rollSessions,
      incoming.rollSessions,
      (session) => session.id,
    ),
    settings: {
      ...(incoming.settings ?? {}),
      ...(current.settings ?? {}),
    },
  };
}

function mergeFranchises(current, incoming) {
  const result = [...current];
  for (const franchise of incoming) {
    const index = result.findIndex(
      (item) => item.normalizedName === franchise.normalizedName,
    );
    if (index < 0) {
      result.push(franchise);
      continue;
    }
    const existing = result[index];
    result[index] = {
      ...franchise,
      ...existing,
      movieIds: [...new Set([...existing.movieIds, ...franchise.movieIds])],
    };
  }
  return result;
}

export function readLegacyLocalStorage(storage) {
  const rawMovies = parseLegacyValue(storage, "mv_final_movies", []);
  const rawCategories = parseLegacyValue(storage, "mv_final_cats", []);
  const rawFranchises = parseLegacyValue(storage, "mv_final_franch", []);
  const rawSaves = parseLegacyValue(storage, "mv_final_saves", {});

  const categories = normalizeList(
    rawCategories.map((category, position) => ({
      ...category,
      position,
      parentId: category.parentCategoryId ?? null,
      rollQuota: 0,
    })),
    createCategory,
  );
  const movies = normalizeList(
    rawMovies.map((movie, categoryPosition) => ({
      ...movie,
      coverUrl: movie.cover,
      categoryId: Array.isArray(movie.catId) ? movie.catId[0] : movie.catId,
      categoryPosition,
      watchedAt: movie.watched
        ? movie.watchedAt ?? new Date().toISOString()
        : null,
      ratings: movie.ratings,
    })),
    createMovie,
  );
  const franchises = normalizeList(rawFranchises, createFranchise);
  const participants = normalizeList(
    Object.keys(rawSaves).map((name) => ({ name })),
    createParticipant,
  );

  return {
    movies,
    categories,
    franchises,
    participants,
    rollSessions: [],
    settings: {},
  };
}

function mergeMovies(current, incoming) {
  const result = [...current];
  const idMap = new Map();
  for (const candidate of incoming) {
    const index = result.findIndex(
      (movie) =>
        (movie.tmdbId && candidate.tmdbId && movie.tmdbId === candidate.tmdbId) ||
        (
          movie.normalizedTitle === candidate.normalizedTitle &&
          (
            movie.releaseYear === candidate.releaseYear ||
            movie.releaseYear === null ||
            candidate.releaseYear === null
          )
        ),
    );
    if (index < 0) {
      result.push(candidate);
      idMap.set(candidate.id, candidate.id);
      continue;
    }

    const existing = result[index];
    idMap.set(candidate.id, existing.id);
    result[index] = {
      ...candidate,
      ...existing,
      originalTitle: existing.originalTitle || candidate.originalTitle,
      tmdbId: existing.tmdbId ?? candidate.tmdbId,
      overview: existing.overview || candidate.overview,
      genres: existing.genres?.length ? existing.genres : candidate.genres,
      tmdbUpdatedAt: existing.tmdbUpdatedAt ?? candidate.tmdbUpdatedAt,
      coverUrl: existing.coverUrl || candidate.coverUrl,
      releaseYear: existing.releaseYear ?? candidate.releaseYear,
      durationMinutes: existing.durationMinutes ?? candidate.durationMinutes,
      country: existing.country || candidate.country,
      watchedAt: existing.watchedAt ?? candidate.watchedAt,
      ratings: mergeBy(
        existing.ratings,
        candidate.ratings,
        (rating) => rating.normalizedParticipantName,
      ),
    };
  }
  return { items: result, idMap };
}

function mergeBy(current, incoming, getKey) {
  const result = [...current];
  const keys = new Map(result.map((item, index) => [getKey(item), index]));
  for (const item of incoming) {
    const key = getKey(item);
    if (!keys.has(key)) {
      keys.set(key, result.length);
      result.push(item);
    }
  }
  return result;
}

function mergeCategories(current, incoming) {
  const result = [...current];
  const idMap = new Map();
  const pending = [...incoming];
  let safety = pending.length + 1;

  while (pending.length && safety > 0) {
    safety -= 1;
    let handled = 0;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const category = pending[index];
      const parentIsIncoming = incoming.some(
        (item) => item.id === category.parentId,
      );
      if (parentIsIncoming && !idMap.has(category.parentId)) {
        continue;
      }

      const parentId = category.parentId
        ? idMap.get(category.parentId) ?? category.parentId
        : null;
      const match = result.find(
        (item) =>
          item.normalizedName === category.normalizedName &&
          (item.parentId ?? null) === parentId,
      );
      if (match) {
        idMap.set(category.id, match.id);
      } else {
        const inserted = { ...category, parentId };
        result.push(inserted);
        idMap.set(category.id, inserted.id);
      }
      pending.splice(index, 1);
      handled += 1;
    }
    if (handled === 0) break;
  }

  for (const category of pending) {
    const inserted = { ...category, parentId: null };
    result.push(inserted);
    idMap.set(category.id, inserted.id);
  }

  return { items: result, idMap };
}

function normalizeList(values, factory) {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    try {
      return [factory(value)];
    } catch {
      return [];
    }
  });
}

function parseLegacyValue(storage, key, fallback) {
  const raw = storage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
