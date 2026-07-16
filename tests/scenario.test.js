import test from "node:test";
import assert from "node:assert/strict";

import {
  createBackup,
  parseBackup,
} from "../src/domain/backup.js";
import {
  createCategory,
  createFranchise,
  createMovie,
} from "../src/domain/entities.js";
import {
  buildWinnerWatchCommands,
} from "../src/domain/libraryRules.js";
import {
  buildRollPool,
  confirmElimination,
  createRollSession,
  spinSession,
  useSave,
} from "../src/domain/rollEngine.js";

test("полный сценарий от библиотеки до резервной копии", () => {
  const category = createCategory({
    id: "category",
    name: "Фантастика",
    rollQuota: 3,
  });
  const movies = [
    createMovie({
      id: "standalone",
      title: "Интерстеллар",
      categoryId: category.id,
      categoryPosition: 0,
    }),
    createMovie({
      id: "matrix-1",
      title: "Матрица",
      categoryId: category.id,
      categoryPosition: 1,
    }),
    createMovie({
      id: "matrix-2",
      title: "Матрица: Перезагрузка",
      categoryId: category.id,
      categoryPosition: 2,
    }),
    createMovie({
      id: "arrival",
      title: "Прибытие",
      categoryId: category.id,
      categoryPosition: 3,
    }),
  ];
  const franchise = createFranchise({
    id: "matrix",
    name: "Матрица",
    categoryId: category.id,
    categoryPosition: 1,
    movieIds: ["matrix-1", "matrix-2"],
  });
  const library = {
    movies,
    categories: [category],
    franchises: [franchise],
    participants: [],
    rollSessions: [],
    settings: {},
  };

  const pool = buildRollPool(library);
  assert.equal(pool.length, 3);

  let session = createRollSession({
    pool,
    participants: [
      { id: "anton", name: "Антон", saves: 1 },
      { id: "ivan", name: "Иван", saves: 1 },
    ],
    savesEnabledAboveRemaining: 2,
  });

  session = spinSession(session, () => 0);
  session = useSave(session, "anton");
  assert.equal(session.participants[0].savesRemaining, 0);

  session = spinSession(session, () => 0);
  session = confirmElimination(session);
  session = spinSession(session, () => 0);
  session = confirmElimination(session);
  assert.equal(session.status, "completed");

  const watchCommands = buildWinnerWatchCommands(
    library,
    session.winner,
    session.completedAt,
  );
  const watchedMovieIds = watchCommands.map((command) => command.value.id);
  if (session.winner.type === "franchise") {
    assert.deepEqual(watchedMovieIds.sort(), ["matrix-1", "matrix-2"]);
  } else {
    assert.deepEqual(watchedMovieIds, [session.winner.id]);
  }

  const completedLibrary = {
    ...library,
    movies: library.movies.map((movie) =>
      watchCommands.find((command) => command.value.id === movie.id)?.value ??
      movie
    ),
    rollSessions: [session],
  };
  const restored = parseBackup(
    JSON.stringify(createBackup(completedLibrary)),
  );

  assert.equal(restored.movies.length, 4);
  assert.equal(restored.rollSessions[0].winner.id, session.winner.id);
});
