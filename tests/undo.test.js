import test from "node:test";
import assert from "node:assert/strict";

import { STORE_NAMES } from "../src/config.js";
import {
  createCategory,
  createFranchise,
  createMovie,
} from "../src/domain/entities.js";
import {
  buildCategoryDeletionCommands,
  buildMovieDeletionCommands,
} from "../src/domain/libraryRules.js";
import { buildUndoCommands, describeDeletion } from "../src/domain/undo.js";

function buildLibrary() {
  return {
    categories: [
      createCategory({ id: "root", name: "Мировое" }),
      createCategory({ id: "child", name: "Европа", parentId: "root" }),
    ],
    movies: [
      createMovie({ id: "m1", title: "Дюна", categoryId: "root" }),
      createMovie({ id: "m2", title: "Охота", categoryId: "child" }),
    ],
    franchises: [createFranchise({ id: "fr", name: "Сага", movieIds: ["m1", "m2"] })],
    participants: [],
    rollSessions: [],
  };
}

// Применение команд к слепку библиотеки — так же, как это делает база.
function applyCommands(library, commands) {
  const next = {
    categories: [...library.categories],
    movies: [...library.movies],
    franchises: [...library.franchises],
    participants: [...library.participants],
    rollSessions: [...library.rollSessions],
  };
  const collections = {
    [STORE_NAMES.categories]: "categories",
    [STORE_NAMES.movies]: "movies",
    [STORE_NAMES.franchises]: "franchises",
    [STORE_NAMES.participants]: "participants",
    [STORE_NAMES.rollSessions]: "rollSessions",
  };

  for (const command of commands) {
    const key = collections[command.storeName];
    if (command.type === "delete") {
      next[key] = next[key].filter((record) => record.id !== command.key);
      continue;
    }
    const index = next[key].findIndex((record) => record.id === command.value.id);
    if (index === -1) next[key].push(command.value);
    else next[key][index] = command.value;
  }

  return next;
}

test("отмена возвращает удалённый фильм и его место во франшизе", () => {
  const library = buildLibrary();
  const commands = buildMovieDeletionCommands(library, "m1");
  const undo = buildUndoCommands(library, commands);

  const afterDelete = applyCommands(library, commands);
  assert.equal(afterDelete.movies.length, 1);
  assert.deepEqual(afterDelete.franchises[0].movieIds, ["m2"]);

  const afterUndo = applyCommands(afterDelete, undo);
  assert.deepEqual(afterUndo.movies.map((movie) => movie.id).sort(), ["m1", "m2"]);
  assert.deepEqual(afterUndo.franchises[0].movieIds, ["m1", "m2"]);
});

test("отмена удаления списка возвращает вложенность и привязку фильмов", () => {
  const library = buildLibrary();
  const commands = buildCategoryDeletionCommands(library, "root");
  const undo = buildUndoCommands(library, commands);

  const afterDelete = applyCommands(library, commands);
  assert.equal(afterDelete.categories.find((item) => item.id === "root"), undefined);
  assert.equal(afterDelete.categories.find((item) => item.id === "child").parentId, null);
  assert.equal(afterDelete.movies.find((movie) => movie.id === "m1").categoryId, null);

  const afterUndo = applyCommands(afterDelete, undo);
  assert.ok(afterUndo.categories.find((item) => item.id === "root"));
  assert.equal(afterUndo.categories.find((item) => item.id === "child").parentId, "root");
  assert.equal(afterUndo.movies.find((movie) => movie.id === "m1").categoryId, "root");
});

test("отмена убирает запись, которой до операции не существовало", () => {
  const library = buildLibrary();
  const commands = [{
    type: "put",
    storeName: STORE_NAMES.movies,
    value: createMovie({ id: "new", title: "Новый" }),
  }];

  const undo = buildUndoCommands(library, commands);
  assert.deepEqual(undo, [{ type: "delete", storeName: STORE_NAMES.movies, key: "new" }]);
});

test("неизвестное хранилище игнорируется", () => {
  assert.deepEqual(
    buildUndoCommands(buildLibrary(), [{ type: "delete", storeName: "unknown", key: "x" }]),
    [],
  );
});

test("склонение количества удалённого", () => {
  assert.equal(describeDeletion(1), "1 фильм");
  assert.equal(describeDeletion(3), "3 фильма");
  assert.equal(describeDeletion(11), "11 фильмов");
  assert.equal(describeDeletion(21), "21 фильм");
});
