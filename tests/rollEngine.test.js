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

