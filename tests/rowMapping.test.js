import test from "node:test";
import assert from "node:assert/strict";

import {
  createCategory,
  createFranchise,
  createMovie,
  upsertRating,
} from "../src/domain/entities.js";
import {
  categoryFromRow,
  categoryToRow,
  commandToPayload,
  franchiseFromRow,
  franchiseToRow,
  movieFromRow,
  movieToRow,
  ratingToRow,
} from "../src/data/rowMapping.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const MOVIE_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "33333333-3333-4333-8333-333333333333";

// createMovie каждый раз проставляет свежий updatedAt, поэтому сравнение идёт
// без него: проверяется перекладка полей, а не часы.
function withoutUpdatedAt(entity) {
  const { updatedAt, ...rest } = entity;
  return rest;
}

function buildMovie() {
  const movie = createMovie({
    id: MOVIE_ID,
    title: "Дюна",
    originalTitle: "Dune",
    tmdbId: 438631,
    categoryId: CATEGORY_ID,
    categoryPosition: 2,
    releaseYear: 2021,
    durationMinutes: 155,
    country: "США",
    genres: ["Фантастика"],
    tags: ["Пересмотр"],
    notes: "Песок",
    isFavorite: true,
    status: "watched",
    overview: "Про песок",
    coverUrl: "/posters/dune.jpg",
  });
  movie.ratings = upsertRating([], { participantName: "Илья", value: 9 });
  return movie;
}

test("фильм переживает дорогу в базу и обратно без потерь", () => {
  const movie = buildMovie();
  const row = movieToRow(movie, OWNER);
  const ratingRows = movie.ratings.map((rating) => ratingToRow(rating, movie.id, OWNER));

  assert.equal(row.owner_id, OWNER);
  assert.equal(row.normalized_title, "дюна");
  assert.equal(row.is_favorite, true);
  assert.equal(typeof row.watched_at, "string");

  assert.deepEqual(
    withoutUpdatedAt(movieFromRow(row, ratingRows)),
    withoutUpdatedAt(movie),
  );
});

test("список и франшиза переживают дорогу так же", () => {
  const category = createCategory({
    id: CATEGORY_ID,
    name: "Фантастика",
    position: 3,
    rollQuota: 2,
  });
  assert.deepEqual(
    withoutUpdatedAt(categoryFromRow(categoryToRow(category, OWNER))),
    withoutUpdatedAt(category),
  );

  const franchise = createFranchise({
    id: "44444444-4444-4444-8444-444444444444",
    name: "Дюна",
    movieIds: [MOVIE_ID],
  });
  assert.deepEqual(
    withoutUpdatedAt(franchiseFromRow(franchiseToRow(franchise, OWNER), [MOVIE_ID])),
    withoutUpdatedAt(franchise),
  );
});

test("оценки уезжают отдельными строками, а не полем фильма", () => {
  // В базе оценка — своя строка: иначе оценку друга нельзя разрешить, не отдав
  // ему право на запись во всю карточку фильма.
  const movie = buildMovie();
  const payload = commandToPayload(
    { type: "put", storeName: "movies", value: movie },
    OWNER,
  );

  assert.equal(payload.table, "movies");
  assert.equal(payload.row.title, "Дюна");
  assert.equal(payload.row.ratings, undefined);
  assert.equal(payload.ratings.length, 1);
  assert.equal(payload.ratings[0].rater_name, "Илья");
  assert.equal(payload.ratings[0].movie_id, MOVIE_ID);
  assert.equal(payload.ratings[0].rater_user_id, null);
});

test("франшиза уезжает вместе со своим составом", () => {
  const franchise = createFranchise({ name: "Дюна", movieIds: [MOVIE_ID] });
  const payload = commandToPayload(
    { type: "put", storeName: "franchises", value: franchise },
    OWNER,
  );

  assert.equal(payload.table, "franchises");
  assert.deepEqual(payload.movie_ids, [MOVIE_ID]);
});

test("удаление и настройка превращаются в понятные серверу команды", () => {
  assert.deepEqual(
    commandToPayload({ type: "delete", storeName: "categories", key: CATEGORY_ID }, OWNER),
    { table: "categories", op: "delete", id: CATEGORY_ID },
  );

  assert.deepEqual(
    commandToPayload(
      { type: "put", storeName: "settings", value: { key: "soundEnabled", value: false } },
      OWNER,
    ),
    { table: "user_settings", op: "setting", key: "soundEnabled", value: false },
  );
});

test("незнакомое хранилище или операция не уходят на сервер молча", () => {
  assert.throws(
    () => commandToPayload({ type: "put", storeName: "непонятно", value: {} }, OWNER),
    /Неизвестное хранилище/,
  );
  assert.throws(
    () => commandToPayload({ type: "merge", storeName: "movies", value: {} }, OWNER),
    /Неизвестная операция/,
  );
});
