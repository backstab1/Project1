import test from "node:test";
import assert from "node:assert/strict";

import {
  createBackup,
  mergeLibraries,
  parseBackup,
  readLegacyLocalStorage,
} from "../src/domain/backup.js";
import {
  createCategory,
  createMovie,
} from "../src/domain/entities.js";

const emptyLibrary = {
  movies: [],
  categories: [],
  franchises: [],
  participants: [],
  rollSessions: [],
};

test("резервная копия проходит полный цикл сериализации", () => {
  const library = {
    ...emptyLibrary,
    movies: [createMovie({ title: "Начало" })],
  };
  const restored = parseBackup(JSON.stringify(createBackup(library)));

  assert.equal(restored.movies.length, 1);
  assert.equal(restored.movies[0].title, "Начало");
});

test("объединение библиотек не создаёт дубликат фильма", () => {
  const current = {
    ...emptyLibrary,
    movies: [createMovie({ title: "Начало", releaseYear: 2010 })],
  };
  const incoming = {
    ...emptyLibrary,
    movies: [
      createMovie({
        title: " НАЧАЛО ",
        releaseYear: 2010,
        durationMinutes: 148,
      }),
    ],
  };
  const merged = mergeLibraries(current, incoming);

  assert.equal(merged.movies.length, 1);
  assert.equal(merged.movies[0].durationMinutes, 148);
});

test("старый localStorage преобразуется без демонстрационных данных", () => {
  const values = new Map([
    ["mv_final_cats", JSON.stringify([{ id: "cat", name: "Фантастика" }])],
    [
      "mv_final_movies",
      JSON.stringify([
        {
          id: "movie",
          title: "Интерстеллар",
          catId: "cat",
          watched: false,
          ratings: [],
        },
      ]),
    ],
    ["mv_final_franch", "[]"],
    ["mv_final_saves", JSON.stringify({ Антон: 3 })],
  ]);
  const legacy = readLegacyLocalStorage({
    getItem(key) {
      return values.get(key) ?? null;
    },
  });

  assert.equal(legacy.categories[0].name, "Фантастика");
  assert.equal(legacy.movies[0].categoryId, "cat");
  assert.equal(legacy.participants[0].name, "Антон");
});

test("категории из резервной копии сохраняют модель", () => {
  const category = createCategory({ name: "Кино", rollQuota: 3 });
  const restored = parseBackup(
    createBackup({ ...emptyLibrary, categories: [category] }),
  );
  assert.equal(restored.categories[0].rollQuota, 3);
});

test("при объединении ссылки франшизы переводятся на существующий фильм", () => {
  const existingMovie = createMovie({
    id: "existing",
    title: "Матрица",
    releaseYear: 1999,
  });
  const incomingMovie = createMovie({
    id: "incoming",
    title: "Матрица",
    releaseYear: 1999,
  });
  const merged = mergeLibraries(
    { ...emptyLibrary, movies: [existingMovie] },
    {
      ...emptyLibrary,
      movies: [incomingMovie],
      franchises: [
        {
          id: "franchise",
          name: "Матрица",
          normalizedName: "матрица",
          categoryId: null,
          categoryPosition: 0,
          movieIds: ["incoming"],
        },
      ],
    },
  );

  assert.deepEqual(merged.franchises[0].movieIds, ["existing"]);
});
