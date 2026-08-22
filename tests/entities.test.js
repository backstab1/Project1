import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateAverageRating,
  calculateFranchiseRating,
  collectLibraryTags,
  createCategory,
  createMovie,
  normalizeScore,
  parseTagInput,
  upsertRating,
} from "../src/domain/entities.js";
import { buildLibraryStatistics } from "../src/domain/statistics.js";

test("категория требует непустое название", () => {
  assert.throws(() => createCategory({ name: "   " }), /обязательно/);
});

test("оценка округляется до шага 0,5", () => {
  assert.equal(normalizeScore(8.26), 8.5);
  assert.equal(normalizeScore(8.24), 8);
  assert.throws(() => normalizeScore(11), /от 1 до 10/);
});

test("повторная оценка зрителя заменяет предыдущую", () => {
  const first = upsertRating([], { participantName: "Антон", value: 7.5 });
  const second = upsertRating(first, { participantName: " антон ", value: 9 });

  assert.equal(second.length, 1);
  assert.equal(second[0].value, 9);
});

test("средний рейтинг пустого списка равен null", () => {
  assert.equal(calculateAverageRating([]), null);
});

test("рейтинг франшизы не учитывает фильмы без оценок как нули", () => {
  const rated = createMovie({
    id: "rated",
    title: "Оценённый",
    ratings: [{ participantName: "Антон", value: 10 }],
  });
  const unrated = createMovie({ id: "unrated", title: "Без оценки" });
  const movieById = new Map([
    [rated.id, rated],
    [unrated.id, unrated],
  ]);

  assert.equal(
    calculateFranchiseRating(
      { movieIds: [rated.id, unrated.id] },
      movieById,
    ),
    10,
  );
});

test("статистика считает оценки и длительность из исходных данных", () => {
  const statistics = buildLibraryStatistics({
    movies: [
      createMovie({
        title: "A",
        durationMinutes: 100,
        watchedAt: "2026-07-16T00:00:00.000Z",
        ratings: [{ participantName: "Антон", value: 8 }],
      }),
      createMovie({
        title: "B",
        durationMinutes: 120,
        ratings: [{ participantName: "Иван", value: 10 }],
      }),
    ],
    categories: [],
    franchises: [],
  });

  assert.equal(statistics.totalRatingCount, 2);
  assert.equal(statistics.libraryAverageRating, 9);
  assert.equal(statistics.totalDurationMinutes, 220);
  assert.equal(statistics.watchedDurationMinutes, 100);
});

test("фильм сохраняет нормализованные метаданные TMDB", () => {
  const movie = createMovie({
    title: "Дюна",
    tmdbId: "438631",
    overview: "  Описание фильма.  ",
    genres: ["Фантастика", "Драма", "Фантастика", ""],
    tmdbUpdatedAt: "2026-07-18T10:00:00.000Z",
  });

  assert.equal(movie.tmdbId, 438631);
  assert.equal(movie.overview, "Описание фильма.");
  assert.deepEqual(movie.genres, ["Фантастика", "Драма"]);
  assert.equal(movie.tmdbUpdatedAt, "2026-07-18T10:00:00.000Z");
});

test("теги фильма чистятся от регистра, пробелов и повторов", () => {
  const movie = createMovie({
    title: "Дюна",
    tags: ["  Вечер пятницы ", "вечер   пятницы", "Пересмотр", "", 42],
  });

  assert.deepEqual(movie.tags, ["Вечер пятницы", "Пересмотр"]);
});

test("строка тегов разбирается по запятым", () => {
  assert.deepEqual(parseTagInput(" Уют, ужасы ,, Уют "), ["Уют", "ужасы"]);
  assert.deepEqual(parseTagInput(""), []);
});

test("фильм хранит заметку и признак избранного", () => {
  const movie = createMovie({
    title: "Дюна",
    notes: "  Смотреть только с хорошим звуком.  ",
    isFavorite: 1,
  });

  assert.equal(movie.notes, "Смотреть только с хорошим звуком.");
  assert.equal(movie.isFavorite, true);
  assert.equal(createMovie({ title: "Дюна" }).isFavorite, false);
});

test("теги библиотеки собираются с частотой и без дублей по регистру", () => {
  const tags = collectLibraryTags([
    createMovie({ title: "A", tags: ["Уют", "Ужасы"] }),
    createMovie({ title: "B", tags: ["уют"] }),
    createMovie({ title: "C", tags: [] }),
  ]);

  assert.deepEqual(tags, [
    { tag: "Уют", count: 2 },
    { tag: "Ужасы", count: 1 },
  ]);
});
