import test from "node:test";
import assert from "node:assert/strict";

import {
  describeImportReport,
  isServerId,
  prepareLibraryForImport,
} from "../src/domain/libraryMigration.js";

// Предсказуемые идентификаторы: проверяем перекладку ссылок, а не случайность.
function idFactory() {
  let counter = 0;
  return () => {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  };
}

function prepare(library) {
  return prepareLibraryForImport(library, { createId: idFactory() });
}

test("uuid отличается от запасного идентификатора приложения", () => {
  assert.equal(isServerId("f81d4fae-7dec-41d0-a765-00a0c91e6bf6"), true);
  assert.equal(isServerId("cv-lz4a1-9qk"), false);
});

test("непригодные идентификаторы перевыпускаются, а ссылки переезжают следом", () => {
  const { library, report } = prepare({
    categories: [{ id: "cv-cat", name: "Фантастика", parentId: null }],
    movies: [{ id: "cv-movie", title: "Дюна", categoryId: "cv-cat", ratings: [] }],
    franchises: [],
    participants: [],
  });

  const categoryId = library.categories[0].id;
  assert.equal(isServerId(categoryId), true);
  assert.equal(isServerId(library.movies[0].id), true);
  assert.equal(library.movies[0].categoryId, categoryId);
  assert.equal(report.regeneratedIds, 2);
});

test("годные uuid остаются прежними", () => {
  const id = "f81d4fae-7dec-41d0-a765-00a0c91e6bf6";
  const { library, report } = prepare({
    categories: [],
    movies: [{ id, title: "Дюна", categoryId: null, ratings: [] }],
    franchises: [],
    participants: [],
  });

  assert.equal(library.movies[0].id, id);
  assert.equal(report.regeneratedIds, 0);
});

test("ссылка на исчезнувший список обнуляется, а фильм остаётся", () => {
  const { library, report } = prepare({
    categories: [],
    movies: [
      {
        id: "f81d4fae-7dec-41d0-a765-00a0c91e6bf6",
        title: "Дюна",
        categoryId: "cv-удалённый",
        ratings: [],
      },
    ],
    franchises: [],
    participants: [],
  });

  assert.equal(library.movies.length, 1);
  assert.equal(library.movies[0].categoryId, null);
  assert.equal(report.droppedCategoryLinks, 1);
});

test("фильм в двух франшизах достаётся первой", () => {
  const { library, report } = prepare({
    categories: [],
    movies: [{ id: "cv-m1", title: "Дюна", ratings: [] }],
    franchises: [
      { id: "cv-f1", name: "Первая", movieIds: ["cv-m1"] },
      { id: "cv-f2", name: "Вторая", movieIds: ["cv-m1"] },
    ],
    participants: [],
  });

  const movieId = library.movies[0].id;
  assert.deepEqual(library.franchises[0].movieIds, [movieId]);
  assert.deepEqual(library.franchises[1].movieIds, []);
  assert.equal(report.movedFranchiseMovies, 1);
});

test("франшиза не тянет за собой ссылку на несуществующий фильм", () => {
  const { library, report } = prepare({
    categories: [],
    movies: [],
    franchises: [{ id: "cv-f1", name: "Пустая", movieIds: ["cv-нет-такого"] }],
    participants: [],
  });

  assert.deepEqual(library.franchises[0].movieIds, []);
  assert.equal(report.droppedFranchiseMovies, 1);
});

test("повторный TMDB ID очищается у второго фильма, а не роняет импорт", () => {
  // База держит (owner_id, tmdb_id) уникальным: без этой чистки весь перенос
  // упал бы на дубликате целиком.
  const { library, report } = prepare({
    categories: [],
    movies: [
      { id: "cv-m1", title: "Дюна", tmdbId: 438631, ratings: [] },
      { id: "cv-m2", title: "Дюна (копия)", tmdbId: 438631, ratings: [] },
    ],
    franchises: [],
    participants: [],
  });

  assert.equal(library.movies[0].tmdbId, 438631);
  assert.equal(library.movies[1].tmdbId, null);
  assert.equal(library.movies[1].title, "Дюна (копия)");
  assert.equal(report.clearedTmdbIds, 1);
});

test("две оценки одного зрителя сводятся к последней", () => {
  const { library, report } = prepare({
    categories: [],
    movies: [
      {
        id: "cv-m1",
        title: "Дюна",
        ratings: [
          { id: "cv-r1", participantName: "Илья", normalizedParticipantName: "илья", value: 7 },
          { id: "cv-r2", participantName: "Илья", normalizedParticipantName: "илья", value: 9 },
          { id: "cv-r3", participantName: "Аня", normalizedParticipantName: "аня", value: 8 },
        ],
      },
    ],
    franchises: [],
    participants: [],
  });

  const ratings = library.movies[0].ratings;
  assert.equal(ratings.length, 2);
  assert.equal(ratings.find((item) => item.normalizedParticipantName === "илья").value, 9);
  assert.equal(report.mergedRatings, 1);
  assert.equal(report.ratings, 2);
});

test("отчёт перечисляет только те правки, которые действительно были", () => {
  const { report } = prepare({
    categories: [{ id: "cv-cat", name: "Фантастика" }],
    movies: [{ id: "cv-m1", title: "Дюна", categoryId: "cv-cat", ratings: [] }],
    franchises: [],
    participants: [],
  });

  const described = describeImportReport(report);
  assert.deepEqual(described.fixes, ["перевыпущено идентификаторов: 2"]);
  assert.equal(described.lines[0], "Фильмов: 1");
});

test("пустая библиотека не ломает подготовку", () => {
  const { library, report } = prepare({});
  assert.deepEqual(library.movies, []);
  assert.equal(report.movies, 0);
});
