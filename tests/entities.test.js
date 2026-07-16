import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateAverageRating,
  calculateFranchiseRating,
  createCategory,
  createMovie,
  normalizeScore,
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
