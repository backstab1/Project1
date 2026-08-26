import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRollPool,
  confirmElimination,
  createRollSession,
  restoreEliminated,
  spinSession,
  useSave,
} from "../src/domain/rollEngine.js";

function samplePool() {
  return [
    { type: "movie", id: "a", title: "A", sourceCategoryId: "cat" },
    { type: "movie", id: "b", title: "B", sourceCategoryId: "cat" },
    { type: "movie", id: "c", title: "C", sourceCategoryId: "cat" },
  ];
}

test("пул формируется по квоте и исключает просмотренные фильмы", () => {
  const library = {
    categories: [
      {
        id: "cat",
        name: "Категория",
        parentId: null,
        position: 0,
        rollQuota: 2,
      },
    ],
    movies: [
      {
        id: "watched",
        title: "Просмотрен",
        categoryId: "cat",
        categoryPosition: 0,
        watchedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "first",
        title: "Первый",
        categoryId: "cat",
        categoryPosition: 1,
        watchedAt: null,
      },
      {
        id: "second",
        title: "Второй",
        categoryId: "cat",
        categoryPosition: 2,
        watchedAt: null,
      },
    ],
    franchises: [],
  };

  assert.deepEqual(
    buildRollPool(library).map((item) => item.id),
    ["first", "second"],
  );
});

test("фильмы франшизы не дублируют франшизу в колесе", () => {
  const library = {
    categories: [
      {
        id: "cat",
        name: "Категория",
        parentId: null,
        position: 0,
        rollQuota: 3,
      },
    ],
    movies: [
      {
        id: "member",
        title: "Часть франшизы",
        categoryId: "cat",
        categoryPosition: 0,
        watchedAt: null,
      },
      {
        id: "single",
        title: "Самостоятельный",
        categoryId: "cat",
        categoryPosition: 1,
        watchedAt: null,
      },
    ],
    franchises: [
      {
        id: "franchise",
        name: "Франшиза",
        categoryId: "cat",
        categoryPosition: 0,
        movieIds: ["member"],
      },
    ],
  };

  assert.deepEqual(
    buildRollPool(library).map((item) => `${item.type}:${item.id}`).sort(),
    ["franchise:franchise", "movie:single"],
  );
});

test("сейв отменяет выбывание и уменьшает счётчик игрока", () => {
  let session = createRollSession({
    pool: samplePool(),
    participants: [{ id: "player", name: "Антон", saves: 2 }],
    savesEnabledAboveRemaining: 2,
  });
  session = spinSession(session, () => 0);
  session = useSave(session, "player");

  assert.equal(session.pool.length, 3);
  assert.equal(session.pendingIndex, null);
  assert.equal(session.participants[0].savesRemaining, 1);
});

test("подтверждение последовательных выбываний объявляет победителя", () => {
  let session = createRollSession({
    pool: samplePool(),
    participants: [{ name: "Антон", saves: 0 }],
    savesEnabledAboveRemaining: 1,
  });
  session = spinSession(session, () => 0);
  session = confirmElimination(session);
  session = spinSession(session, () => 0);
  session = confirmElimination(session);

  assert.equal(session.status, "completed");
  assert.equal(session.winner.id, "c");
  assert.equal(session.eliminated.length, 2);
});

test("игрок сессии хранит аккаунт, а не только имя", () => {
  const session = createRollSession({
    pool: samplePool(),
    participants: [
      { userId: "user-1", handle: "anton", name: "Антон", saves: 2 },
    ],
    savesEnabledAboveRemaining: 2,
  });

  assert.equal(session.participants[0].id, "user-1");
  assert.equal(session.participants[0].userId, "user-1");
  assert.equal(session.participants[0].handle, "anton");
});

test("один аккаунт не попадает в состав дважды", () => {
  const session = createRollSession({
    pool: samplePool(),
    participants: [
      { userId: "user-1", name: "Антон", saves: 2 },
      { userId: "user-1", name: "Антон", saves: 5 },
    ],
    savesEnabledAboveRemaining: 2,
  });

  assert.equal(session.participants.length, 1);
  assert.equal(session.participants[0].savesInitial, 2);
});

test("выбывшего участника можно вернуть", () => {
  let session = createRollSession({
    pool: samplePool(),
    participants: [{ name: "Антон", saves: 0 }],
    savesEnabledAboveRemaining: 1,
  });
  session = spinSession(session, () => 0);
  session = confirmElimination(session);
  session = restoreEliminated(session, "movie", "a");

  assert.equal(session.pool.length, 3);
  assert.equal(session.eliminated.length, 0);
});

function filterLibrary() {
  return {
    categories: [
      { id: "cat", name: "Категория", parentId: null, position: 0, rollQuota: 5 },
    ],
    movies: [
      {
        id: "fav",
        title: "Избранный",
        categoryId: "cat",
        categoryPosition: 0,
        isFavorite: true,
        tags: ["Пятница"],
      },
      {
        id: "plain",
        title: "Обычный",
        categoryId: "cat",
        categoryPosition: 1,
      },
      {
        id: "dropped",
        title: "Брошенный",
        categoryId: "cat",
        categoryPosition: 2,
        status: "dropped",
      },
    ],
    franchises: [],
  };
}

test("брошенный фильм не попадает в пул колеса", () => {
  const pool = buildRollPool(filterLibrary());
  assert.deepEqual(pool.map((item) => item.id), ["fav", "plain"]);
});

test("отбор пула по избранному и тегу сужает состав", () => {
  const library = filterLibrary();

  assert.deepEqual(
    buildRollPool(library, { favoritesOnly: true, tag: "" }).map((item) => item.id),
    ["fav"],
  );
  assert.deepEqual(
    buildRollPool(library, { favoritesOnly: false, tag: "Пятница" }).map((item) => item.id),
    ["fav"],
  );
  assert.deepEqual(
    buildRollPool(library, { favoritesOnly: false, tag: "Суббота" }).map((item) => item.id),
    [],
  );
});

test("коллекция участвует, если под отбор подходит хотя бы один её фильм", () => {
  const library = filterLibrary();
  library.franchises = [
    { id: "fr", name: "Сага", categoryId: "cat", categoryPosition: 0, movieIds: ["fav", "plain"] },
  ];

  const pool = buildRollPool(library, { favoritesOnly: true, tag: "" });
  assert.deepEqual(pool.map((item) => item.type), ["franchise"]);
});
