// Подготовка существующей библиотеки к переносу на сервер.
//
// Это самое опасное место всего перехода: здесь единственный раз данные
// заказчика меняют форму. Поэтому модуль чистый и ничего не сохраняет — он
// только строит новую версию библиотеки и отчёт о том, что пришлось поправить.
// Решение о записи принимает вызывающий, увидев отчёт.
//
// Что чинится:
//   * идентификаторы, которые Postgres не примет как uuid;
//   * ссылки в никуда — на удалённый список, франшизу или фильм;
//   * фильм, попавший в две франшизы;
//   * два TMDB ID на одну библиотеку;
//   * две оценки одного зрителя на один фильм.
// Три последних правила база держит уникальными индексами: без чистки импорт
// упал бы целиком на первой же дубликатной строке.

import { createId } from "./entities.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isServerId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function prepareLibraryForImport(library, options = {}) {
  const nextId = options.createId ?? createId;
  const report = {
    movies: 0,
    categories: 0,
    franchises: 0,
    participants: 0,
    ratings: 0,
    regeneratedIds: 0,
    droppedCategoryLinks: 0,
    droppedFranchiseMovies: 0,
    movedFranchiseMovies: 0,
    clearedTmdbIds: 0,
    mergedRatings: 0,
  };

  const source = {
    movies: [...(library?.movies ?? [])],
    categories: [...(library?.categories ?? [])],
    franchises: [...(library?.franchises ?? [])],
    participants: [...(library?.participants ?? [])],
  };

  // 1. Идентификаторы. Запасная ветка createId выдаёт «cv-…», которые Postgres
  // как uuid не примет, поэтому такие ключи перевыпускаются, а ссылки на них
  // переписываются по карте.
  const idMap = new Map();
  const remember = (id) => {
    if (typeof id !== "string" || id === "") return null;
    if (idMap.has(id)) return idMap.get(id);
    const mapped = isServerId(id) ? id : nextId();
    if (mapped !== id) report.regeneratedIds += 1;
    idMap.set(id, mapped);
    return mapped;
  };

  for (const group of Object.values(source)) {
    for (const item of group) remember(item.id);
  }

  const mapId = (id) => (id == null ? null : idMap.get(id) ?? null);

  const categoryIds = new Set(source.categories.map((item) => mapId(item.id)));
  const movieIds = new Set(source.movies.map((item) => mapId(item.id)));

  // 2. Списки. Ссылка на исчезнувшего родителя обнуляется: список станет
  // корневым, а не пропадёт.
  const categories = source.categories.map((category) => {
    const parentId = mapId(category.parentId);
    const keepParent = parentId && categoryIds.has(parentId) && parentId !== mapId(category.id);
    if (category.parentId && !keepParent) report.droppedCategoryLinks += 1;
    return {
      ...category,
      id: mapId(category.id),
      parentId: keepParent ? parentId : null,
    };
  });
  report.categories = categories.length;

  // 3. Франшизы. Фильм входит максимум в одну франшизу — при конфликте
  // побеждает первая по порядку, остальные его теряют.
  const claimedMovies = new Set();
  const franchises = source.franchises.map((franchise) => {
    const categoryId = mapId(franchise.categoryId);
    const keepCategory = categoryId && categoryIds.has(categoryId);
    if (franchise.categoryId && !keepCategory) report.droppedCategoryLinks += 1;

    const mappedMovies = [];
    for (const rawId of franchise.movieIds ?? []) {
      const id = mapId(rawId);
      if (!id || !movieIds.has(id)) {
        report.droppedFranchiseMovies += 1;
        continue;
      }
      if (claimedMovies.has(id)) {
        report.movedFranchiseMovies += 1;
        continue;
      }
      claimedMovies.add(id);
      mappedMovies.push(id);
    }

    return {
      ...franchise,
      id: mapId(franchise.id),
      categoryId: keepCategory ? categoryId : null,
      movieIds: mappedMovies,
    };
  });
  report.franchises = franchises.length;

  // 4. Фильмы: ссылки, TMDB ID и оценки.
  const seenTmdbIds = new Set();
  const movies = source.movies.map((movie) => {
    const categoryId = mapId(movie.categoryId);
    const keepCategory = categoryId && categoryIds.has(categoryId);
    if (movie.categoryId && !keepCategory) report.droppedCategoryLinks += 1;

    let tmdbId = movie.tmdbId ?? null;
    if (tmdbId != null) {
      if (seenTmdbIds.has(tmdbId)) {
        report.clearedTmdbIds += 1;
        tmdbId = null;
      } else {
        seenTmdbIds.add(tmdbId);
      }
    }

    const ratings = dedupeRatings(movie.ratings ?? [], remember, report);
    report.ratings += ratings.length;

    return {
      ...movie,
      id: mapId(movie.id),
      categoryId: keepCategory ? categoryId : null,
      tmdbId,
      ratings,
    };
  });
  report.movies = movies.length;

  const participants = source.participants.map((participant) => ({
    ...participant,
    id: mapId(participant.id),
  }));
  report.participants = participants.length;

  return {
    library: { movies, categories, franchises, participants },
    report,
  };
}

// Одна оценка на зрителя: побеждает последняя, как и при обычном
// редактировании оценки в приложении.
function dedupeRatings(ratings, remember, report) {
  const byName = new Map();
  for (const rating of ratings) {
    const key = rating.normalizedParticipantName ?? rating.participantName ?? "";
    if (!key) continue;
    if (byName.has(key)) report.mergedRatings += 1;
    byName.set(key, { ...rating, id: remember(rating.id) ?? undefined });
  }

  return [...byName.values()].map((rating) => ({
    ...rating,
    id: rating.id ?? undefined,
  }));
}

// Короткая сводка для диалога переноса: человек должен увидеть, что именно
// изменилось, прежде чем согласиться.
export function describeImportReport(report) {
  const lines = [
    `Фильмов: ${report.movies}`,
    `Списков: ${report.categories}`,
    `Франшиз: ${report.franchises}`,
    `Оценок: ${report.ratings}`,
  ];

  const fixes = [];
  if (report.regeneratedIds > 0) {
    fixes.push(`перевыпущено идентификаторов: ${report.regeneratedIds}`);
  }
  if (report.droppedCategoryLinks > 0) {
    fixes.push(`ссылок на исчезнувшие списки: ${report.droppedCategoryLinks}`);
  }
  if (report.droppedFranchiseMovies > 0) {
    fixes.push(`фильмов не найдено во франшизах: ${report.droppedFranchiseMovies}`);
  }
  if (report.movedFranchiseMovies > 0) {
    fixes.push(`фильмов состояли в двух франшизах: ${report.movedFranchiseMovies}`);
  }
  if (report.clearedTmdbIds > 0) {
    fixes.push(`повторных TMDB ID очищено: ${report.clearedTmdbIds}`);
  }
  if (report.mergedRatings > 0) {
    fixes.push(`повторных оценок объединено: ${report.mergedRatings}`);
  }

  return { lines, fixes };
}
