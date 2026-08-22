import test from "node:test";
import assert from "node:assert/strict";

import { createMovie } from "../src/domain/entities.js";
import {
  MATCH_CONFIDENCE,
  buildEnrichmentPatch,
  pickBestMatch,
  selectEnrichmentCandidates,
  summarizeEnrichment,
} from "../src/domain/tmdbEnrichment.js";

const dune = {
  id: 438631,
  title: "Дюна",
  original_title: "Dune",
  release_date: "2021-10-22",
  popularity: 120,
};

test("в обогащение попадают фильмы без связи с TMDB и без метаданных", () => {
  const movies = [
    createMovie({ title: "Дюна" }),
    createMovie({ title: "Сталкер", tmdbId: 1398 }),
    // Постер есть, но жанры пустые — такому фильму обогащение ещё нужно.
    createMovie({
      title: "Прибытие",
      coverUrl: "/media/posters/1.jpg",
      overview: "Есть описание.",
    }),
    createMovie({
      title: "Солярис",
      coverUrl: "/media/posters/2.jpg",
      overview: "Есть описание.",
      genres: ["Фантастика"],
    }),
  ];

  const candidates = selectEnrichmentCandidates(movies);
  assert.deepEqual(candidates.map((movie) => movie.title), ["Дюна", "Прибытие"]);

  const withoutPoster = selectEnrichmentCandidates(movies, { onlyMissingPoster: true });
  assert.deepEqual(withoutPoster.map((movie) => movie.title), ["Дюна"]);
});

test("совпадение названия и года считается точным", () => {
  const result = pickBestMatch(
    createMovie({ title: "Дюна", releaseYear: 2021 }),
    [dune, { id: 1, title: "Дюна: Часть вторая", release_date: "2024-02-27" }],
  );

  assert.equal(result.confidence, MATCH_CONFIDENCE.exact);
  assert.equal(result.match.id, 438631);
});

test("совпадение по оригинальному названию без года считается вероятным", () => {
  const result = pickBestMatch(createMovie({ title: "Dune" }), [dune]);

  assert.equal(result.confidence, MATCH_CONFIDENCE.likely);
  assert.equal(result.match.id, 438631);
});

test("одинаковые название и год у двух карточек требуют выбора человека", () => {
  const remake = { id: 2, title: "Дюна", original_title: "Dune", release_date: "2021-01-01" };
  const result = pickBestMatch(
    createMovie({ title: "Дюна", releaseYear: 2021 }),
    [dune, remake],
  );

  assert.equal(result.confidence, MATCH_CONFIDENCE.unsure);
  assert.equal(result.alternatives.length, 2);
});

test("несовпадающее название не принимается автоматически", () => {
  const result = pickBestMatch(
    createMovie({ title: "Сталкер", releaseYear: 1979 }),
    [dune],
  );

  assert.equal(result.match, null);
  assert.equal(result.confidence, MATCH_CONFIDENCE.unsure);
});

test("обогащение не затирает заполненные руками поля", () => {
  const movie = createMovie({
    title: "Дюна",
    country: "Канада",
    genres: ["Любимое"],
    overview: "Своя аннотация.",
  });
  const details = {
    id: 438631,
    original_title: "Dune",
    overview: "Описание TMDB.",
    release_date: "2021-10-22",
    runtime: 155,
    production_countries: [{ name: "США" }],
    genres: [{ name: "Фантастика" }, { name: "Приключения" }],
  };

  const patch = buildEnrichmentPatch(movie, details, { posterUrl: "/media/posters/438631.jpg" });

  assert.equal(patch.overview, undefined);
  assert.equal(patch.country, undefined);
  assert.equal(patch.genres, undefined);
  assert.equal(patch.originalTitle, "Dune");
  assert.equal(patch.releaseYear, 2021);
  assert.equal(patch.durationMinutes, 155);
  assert.equal(patch.coverUrl, "/media/posters/438631.jpg");
  assert.equal(patch.tmdbId, 438631);
  assert.ok(patch.tmdbUpdatedAt);
});

test("режим перезаписи обновляет даже заполненные поля", () => {
  const movie = createMovie({ title: "Дюна", country: "Канада", genres: ["Любимое"] });
  const patch = buildEnrichmentPatch(
    movie,
    { id: 1, production_countries: [{ name: "США" }], genres: [{ name: "Фантастика" }] },
    { overwrite: true },
  );

  assert.equal(patch.country, "США");
  assert.deepEqual(patch.genres, ["Фантастика"]);
});

test("итог прохода считает каждый исход", () => {
  assert.deepEqual(
    summarizeEnrichment([
      { outcome: "updated" },
      { outcome: "updated" },
      { outcome: "review" },
      { outcome: "missing" },
      { outcome: "failed" },
      { outcome: "unknown" },
    ]),
    { updated: 2, review: 1, missing: 1, failed: 1 },
  );
});
