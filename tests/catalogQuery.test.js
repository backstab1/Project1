import test from "node:test";
import assert from "node:assert/strict";

import { MOVIE_STATUS, createMovie, createCategory } from "../src/domain/entities.js";
import {
  DEFAULT_CATALOG_FILTERS,
  filterCatalogMovies,
  getMovieStatus,
} from "../src/domain/catalogQuery.js";

function buildLibrary() {
  return {
    categories: [createCategory({ id: "cat-scifi", name: "Фантастика" })],
    franchises: [],
    movies: [
      createMovie({
        id: "m-dune",
        title: "Дюна",
        categoryId: "cat-scifi",
        releaseYear: 2021,
        genres: ["Фантастика"],
        tags: ["Пересмотр"],
        isFavorite: true,
      }),
      createMovie({
        id: "m-hunt",
        title: "Охота",
        releaseYear: 2012,
        genres: ["Драма"],
        watchedAt: "2026-07-12T19:30:00.000Z",
      }),
      createMovie({
        id: "m-solaris",
        title: "Солярис",
        releaseYear: 1972,
        status: MOVIE_STATUS.dropped,
      }),
      createMovie({
        id: "m-arrival",
        title: "Прибытие",
        releaseYear: 2016,
        status: MOVIE_STATUS.watching,
        tags: ["Пересмотр"],
      }),
    ],
  };
}

const ids = (movies) => movies.map((movie) => movie.id);

test("без фильтров каталог отдаёт всё по названию", () => {
  const movies = filterCatalogMovies(buildLibrary(), DEFAULT_CATALOG_FILTERS);
  // Дюна, Охота, Прибытие, Солярис.
  assert.deepEqual(ids(movies), ["m-dune", "m-hunt", "m-arrival", "m-solaris"]);
});

test("фильтр статуса различает очередь, просмотр, брошенное и просмотренное", () => {
  const library = buildLibrary();
  const byStatus = (status) =>
    ids(filterCatalogMovies(library, { ...DEFAULT_CATALOG_FILTERS, status }));

  assert.deepEqual(byStatus(MOVIE_STATUS.queued), ["m-dune"]);
  assert.deepEqual(byStatus(MOVIE_STATUS.watching), ["m-arrival"]);
  assert.deepEqual(byStatus(MOVIE_STATUS.dropped), ["m-solaris"]);
  assert.deepEqual(byStatus(MOVIE_STATUS.watched), ["m-hunt"]);
});

test("поиск учитывает теги", () => {
  const movies = filterCatalogMovies(buildLibrary(), {
    ...DEFAULT_CATALOG_FILTERS,
    query: "пересмотр",
  });
  assert.deepEqual(ids(movies), ["m-dune", "m-arrival"]);
});

test("фильтры избранного, тега и списка сужают выборку", () => {
  const library = buildLibrary();
  assert.deepEqual(
    ids(filterCatalogMovies(library, { ...DEFAULT_CATALOG_FILTERS, favoritesOnly: true })),
    ["m-dune"],
  );
  assert.deepEqual(
    ids(filterCatalogMovies(library, { ...DEFAULT_CATALOG_FILTERS, tag: "Пересмотр" })),
    ["m-dune", "m-arrival"],
  );
  assert.deepEqual(
    ids(filterCatalogMovies(library, { ...DEFAULT_CATALOG_FILTERS, categoryId: "cat-scifi" })),
    ["m-dune"],
  );
});

test("сортировка по году идёт от новых к старым", () => {
  const movies = filterCatalogMovies(buildLibrary(), {
    ...DEFAULT_CATALOG_FILTERS,
    sort: "year",
  });
  assert.deepEqual(ids(movies), ["m-dune", "m-arrival", "m-hunt", "m-solaris"]);
});

test("статус вычисляется из даты просмотра", () => {
  assert.equal(getMovieStatus({ watchedAt: "2026-01-01T00:00:00.000Z" }), MOVIE_STATUS.watched);
  assert.equal(getMovieStatus({ status: MOVIE_STATUS.dropped }), MOVIE_STATUS.dropped);
  assert.equal(getMovieStatus({}), MOVIE_STATUS.queued);
});
