import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCategoryDeletionCommands,
  buildMovieDeletionCommands,
  findDuplicateMovie,
  moveCategoryQueueEntity,
  moveWithinGroup,
} from "../src/domain/libraryRules.js";

test("дубликат фильма определяется по названию и году", () => {
  const movies = [
    {
      id: "1",
      title: "Интерстеллар",
      normalizedTitle: "интерстеллар",
      releaseYear: 2014,
    },
  ];

  assert.equal(
    findDuplicateMovie(movies, {
      title: "  ИНТЕРСТЕЛЛАР ",
      releaseYear: 2014,
    })?.id,
    "1",
  );
  assert.equal(
    findDuplicateMovie(movies, {
      title: "Интерстеллар",
      releaseYear: 2024,
    }),
    null,
  );
});

test("перемещение меняет позиции только двух соседних элементов", () => {
  const items = [
    { id: "a", categoryId: "cat", categoryPosition: 0 },
    { id: "b", categoryId: "cat", categoryPosition: 1 },
    { id: "c", categoryId: "other", categoryPosition: 0 },
  ];
  const updates = moveWithinGroup(
    items,
    "b",
    -1,
    "categoryId",
    "categoryPosition",
  );

  assert.equal(updates.length, 2);
  assert.equal(updates.find((item) => item.id === "b").categoryPosition, 0);
  assert.equal(updates.find((item) => item.id === "a").categoryPosition, 1);
});

test("удаление категории переносит фильмы и франшизы без удаления", () => {
  const library = {
    categories: [
      { id: "parent", parentId: null },
      { id: "target", parentId: "parent" },
      { id: "child", parentId: "target" },
    ],
    movies: [{ id: "movie", categoryId: "target" }],
    franchises: [{ id: "franchise", categoryId: "target" }],
  };
  const commands = buildCategoryDeletionCommands(library, "target");

  assert.equal(commands.filter((command) => command.type === "delete").length, 1);
  assert.equal(
    commands.find((command) => command.value?.id === "child").value.parentId,
    "parent",
  );
  assert.equal(
    commands.find((command) => command.value?.id === "movie").value.categoryId,
    null,
  );
  assert.equal(
    commands.find((command) => command.value?.id === "franchise").value.categoryId,
    null,
  );
});

test("удаление фильма очищает ссылки франшиз", () => {
  const commands = buildMovieDeletionCommands(
    {
      franchises: [
        { id: "f", movieIds: ["movie", "other"] },
      ],
    },
    "movie",
  );

  assert.deepEqual(
    commands.find((command) => command.value?.id === "f").value.movieIds,
    ["other"],
  );
});

test("фильм и франшиза перемещаются в общей очереди категории", () => {
  const commands = moveCategoryQueueEntity(
    {
      movies: [
        { id: "movie", title: "Фильм", categoryId: "cat", categoryPosition: 0 },
      ],
      franchises: [
        {
          id: "franchise",
          name: "Франшиза",
          categoryId: "cat",
          categoryPosition: 1,
        },
      ],
    },
    "franchise",
    "franchise",
    -1,
  );

  assert.equal(commands.length, 2);
  assert.equal(
    commands.find((command) => command.value.id === "franchise").value
      .categoryPosition,
    0,
  );
  assert.equal(
    commands.find((command) => command.value.id === "movie").value
      .categoryPosition,
    1,
  );
});
