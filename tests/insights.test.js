import test from "node:test";
import assert from "node:assert/strict";

import { MOVIE_STATUS, createMovie } from "../src/domain/entities.js";
import {
  buildInsights,
  buildRecommendations,
  buildTasteProfile,
  buildWatchPace,
  countDecades,
  countStatuses,
  rankCountries,
  rankGenres,
} from "../src/domain/insights.js";

const rated = (name, value) => [{ participantName: name, value }];

function buildMovies() {
  return [
    createMovie({
      title: "Дюна",
      releaseYear: 2021,
      country: "США, Канада",
      genres: ["Фантастика", "Приключения"],
      watchedAt: "2026-08-10T20:00:00.000Z",
      durationMinutes: 155,
      ratings: rated("Антон", 9),
    }),
    createMovie({
      title: "Прибытие",
      releaseYear: 2016,
      country: "США",
      genres: ["Фантастика", "Драма"],
      watchedAt: "2026-07-05T20:00:00.000Z",
      durationMinutes: 116,
      ratings: rated("Антон", 8),
    }),
    createMovie({
      title: "Охота",
      releaseYear: 2012,
      country: "Дания",
      genres: ["Драма"],
      watchedAt: "2026-07-20T20:00:00.000Z",
      durationMinutes: 115,
      ratings: rated("Антон", 6),
    }),
    createMovie({
      title: "Солярис",
      releaseYear: 1972,
      country: "СССР",
      genres: ["Фантастика"],
    }),
    createMovie({
      title: "Сталкер",
      releaseYear: 1979,
      country: "СССР",
      genres: ["Драма"],
      status: MOVIE_STATUS.dropped,
    }),
  ];
}

test("десятилетия считаются по году выпуска", () => {
  assert.deepEqual(countDecades(buildMovies()), [
    { decade: 1970, count: 2 },
    { decade: 2010, count: 2 },
    { decade: 2020, count: 1 },
  ]);
});

test("жанры ранжируются по количеству и знают свою среднюю оценку", () => {
  const genres = rankGenres(buildMovies());
  const byName = (name) => genres.find((entry) => entry.genre === name);

  // «Драма» и «Фантастика» встречаются по три раза, порядок алфавитный.
  assert.deepEqual(genres.map((entry) => entry.genre).slice(0, 2), ["Драма", "Фантастика"]);
  assert.deepEqual(byName("Фантастика"), {
    genre: "Фантастика",
    count: 3,
    ratedCount: 2,
    averageRating: 8.5,
  });
  assert.equal(byName("Драма").averageRating, 7);
  assert.equal(genres.find((entry) => entry.genre === "Приключения").averageRating, 9);
});

test("страны разбираются из строки через запятую", () => {
  const countries = rankCountries(buildMovies());
  // При равном количестве порядок алфавитный: «СССР» раньше «США».
  assert.deepEqual(countries.slice(0, 2), [
    { country: "СССР", count: 2 },
    { country: "США", count: 2 },
  ]);
  assert.ok(countries.some((entry) => entry.country === "Канада"));
});

test("темп просмотра раскладывается по месяцам и считает минуты", () => {
  const pace = buildWatchPace(
    buildMovies().filter((movie) => movie.watchedAt),
    new Date("2026-08-22T00:00:00.000Z"),
  );

  assert.equal(pace.length, 12);
  assert.equal(pace.at(-1).key, "2026-08");
  assert.equal(pace.at(-1).count, 1);
  assert.equal(pace.at(-1).minutes, 155);
  assert.equal(pace.at(-2).count, 2);
  assert.equal(pace.at(-2).minutes, 231);
});

test("профиль вкуса учитывает только жанры с двумя оценками", () => {
  const profile = buildTasteProfile(buildMovies());

  assert.deepEqual(profile.map((entry) => entry.genre), ["Фантастика", "Драма"]);
  assert.equal(profile[0].averageRating, 8.5);
});

test("рекомендации берут фильмы из очереди и объясняют выбор", () => {
  const recommendations = buildRecommendations(buildMovies());

  assert.deepEqual(recommendations.map((entry) => entry.movie.title), ["Солярис"]);
  assert.equal(recommendations[0].reason, "Фантастика");
});

test("брошенные фильмы не попадают в рекомендации", () => {
  const recommendations = buildRecommendations(buildMovies());
  assert.ok(!recommendations.some((entry) => entry.movie.title === "Сталкер"));
});

test("сводка статусов покрывает все четыре состояния", () => {
  assert.deepEqual(countStatuses(buildMovies()), {
    queued: 1,
    watching: 0,
    watched: 3,
    dropped: 1,
  });
});

test("аналитика собирается одним вызовом", () => {
  const insights = buildInsights(
    { movies: buildMovies() },
    { now: new Date("2026-08-22T00:00:00.000Z") },
  );

  assert.ok(insights.decades.length > 0);
  assert.ok(insights.genres.length > 0);
  assert.equal(insights.watchPace.length, 12);
  assert.equal(insights.statusBreakdown.watched, 3);
});
