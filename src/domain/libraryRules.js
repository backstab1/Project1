import { STORE_NAMES } from "../config.js";
import { normalizeText } from "./entities.js";

export function getNextPosition(items, parentId, parentField = "categoryId") {
  const positions = items
    .filter((item) => (item[parentField] ?? null) === (parentId ?? null))
    .map((item) => item.position ?? item.categoryPosition ?? 0);

  return positions.length === 0 ? 0 : Math.max(...positions) + 1;
}

export function findDuplicateMovie(movies, candidate, ignoredId = null) {
  const title = normalizeText(candidate.title);
  const year = candidate.releaseYear ?? null;

  return movies.find((movie) => {
    if (movie.id === ignoredId || movie.normalizedTitle !== title) {
      return false;
    }

    if (year === null || movie.releaseYear === null) {
      return true;
    }

    return movie.releaseYear === year;
  }) ?? null;
}

export function findDuplicateCategory(
  categories,
  candidate,
  ignoredId = null,
) {
  const name = normalizeText(candidate.name);
  const parentId = candidate.parentId ?? null;

  return categories.find(
    (category) =>
      category.id !== ignoredId &&
      category.normalizedName === name &&
      (category.parentId ?? null) === parentId,
  ) ?? null;
}

export function moveWithinGroup(
  items,
  itemId,
  direction,
  groupField,
  positionField,
) {
  const current = items.find((item) => item.id === itemId);
  if (!current || ![-1, 1].includes(direction)) {
    return [];
  }

  const groupValue = current[groupField] ?? null;
  const siblings = items
    .filter((item) => (item[groupField] ?? null) === groupValue)
    .sort((a, b) => (a[positionField] ?? 0) - (b[positionField] ?? 0));
  const currentIndex = siblings.findIndex((item) => item.id === itemId);
  const targetIndex = currentIndex + direction;

  if (targetIndex < 0 || targetIndex >= siblings.length) {
    return [];
  }

  const target = siblings[targetIndex];
  const currentPosition = current[positionField] ?? currentIndex;
  const targetPosition = target[positionField] ?? targetIndex;
  const updatedAt = new Date().toISOString();

  return [
    { ...current, [positionField]: targetPosition, updatedAt },
    { ...target, [positionField]: currentPosition, updatedAt },
  ];
}

export function buildCategoryDeletionCommands(library, categoryId) {
  const category = library.categories.find((item) => item.id === categoryId);
  if (!category) {
    return [];
  }

  const updatedAt = new Date().toISOString();
  const commands = [
    {
      type: "delete",
      storeName: STORE_NAMES.categories,
      key: categoryId,
    },
  ];

  for (const child of library.categories.filter(
    (item) => item.parentId === categoryId,
  )) {
    commands.push({
      type: "put",
      storeName: STORE_NAMES.categories,
      value: { ...child, parentId: category.parentId ?? null, updatedAt },
    });
  }

  for (const movie of library.movies.filter(
    (item) => item.categoryId === categoryId,
  )) {
    commands.push({
      type: "put",
      storeName: STORE_NAMES.movies,
      value: { ...movie, categoryId: null, categoryPosition: 0, updatedAt },
    });
  }

  for (const franchise of library.franchises.filter(
    (item) => item.categoryId === categoryId,
  )) {
    commands.push({
      type: "put",
      storeName: STORE_NAMES.franchises,
      value: { ...franchise, categoryId: null, categoryPosition: 0, updatedAt },
    });
  }

  return commands;
}

export function buildMovieDeletionCommands(library, movieId) {
  const commands = [
    {
      type: "delete",
      storeName: STORE_NAMES.movies,
      key: movieId,
    },
  ];
  const updatedAt = new Date().toISOString();

  for (const franchise of library.franchises) {
    if (!franchise.movieIds.includes(movieId)) {
      continue;
    }
    commands.push({
      type: "put",
      storeName: STORE_NAMES.franchises,
      value: {
        ...franchise,
        movieIds: franchise.movieIds.filter((id) => id !== movieId),
        updatedAt,
      },
    });
  }

  return commands;
}

export function getMovieFranchiseMap(franchises) {
  const map = new Map();
  for (const franchise of franchises) {
    for (const movieId of franchise.movieIds) {
      if (!map.has(movieId)) {
        map.set(movieId, franchise);
      }
    }
  }
  return map;
}

export function buildCategoryQueue(library, categoryId) {
  const movieItems = library.movies
    .filter((movie) => movie.categoryId === categoryId)
    .map((movie) => ({
      type: "movie",
      id: movie.id,
      title: movie.title,
      position: movie.categoryPosition ?? 0,
      value: movie,
      storeName: STORE_NAMES.movies,
    }));
  const franchiseItems = library.franchises
    .filter((franchise) => franchise.categoryId === categoryId)
    .map((franchise) => ({
      type: "franchise",
      id: franchise.id,
      title: franchise.name,
      position: franchise.categoryPosition ?? 0,
      value: franchise,
      storeName: STORE_NAMES.franchises,
    }));

  return [...movieItems, ...franchiseItems].sort(
    (a, b) =>
      a.position - b.position ||
      a.title.localeCompare(b.title, "ru-RU"),
  );
}

export function moveCategoryQueueEntity(
  library,
  entityType,
  entityId,
  direction,
) {
  const source = entityType === "franchise"
    ? library.franchises.find((item) => item.id === entityId)
    : library.movies.find((item) => item.id === entityId);
  if (!source || ![-1, 1].includes(direction)) {
    return [];
  }

  const queue = buildCategoryQueue(library, source.categoryId);
  const currentIndex = queue.findIndex(
    (item) => item.type === entityType && item.id === entityId,
  );
  const targetIndex = currentIndex + direction;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= queue.length) {
    return [];
  }

  const current = queue[currentIndex];
  const target = queue[targetIndex];
  const updatedAt = new Date().toISOString();

  return [
    {
      type: "put",
      storeName: current.storeName,
      value: {
        ...current.value,
        categoryPosition: target.position,
        updatedAt,
      },
    },
    {
      type: "put",
      storeName: target.storeName,
      value: {
        ...target.value,
        categoryPosition: current.position,
        updatedAt,
      },
    },
  ];
}
