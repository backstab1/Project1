import test from "node:test";
import assert from "node:assert/strict";

import {
  createCategory,
  createFranchise,
  createMovie,
} from "../src/domain/entities.js";
import { CSV_COLUMNS, buildLibraryCsv, escapeCsvCell } from "../src/domain/csvExport.js";

test("ячейка экранируется, если содержит разделитель, кавычки или перенос", () => {
  assert.equal(escapeCsvCell("Дюна"), "Дюна");
  assert.equal(escapeCsvCell("Дюна; часть вторая"), '"Дюна; часть вторая"');
  assert.equal(escapeCsvCell('Он сказал "да"'), '"Он сказал ""да"""');
  assert.equal(escapeCsvCell("первая\nвторая"), '"первая\nвторая"');
  assert.equal(escapeCsvCell(null), "");
});

test("экспорт содержит заголовок и строку на каждый фильм", () => {
  const library = {
    categories: [createCategory({ id: "cat", name: "Фантастика" })],
    franchises: [createFranchise({ id: "fr", name: "Средиземье", movieIds: ["m2"] })],
    movies: [
      createMovie({
        id: "m1",
        title: "Дюна",
        categoryId: "cat",
        releaseYear: 2021,
        genres: ["Фантастика", "Драма"],
        tags: ["Пересмотр"],
        isFavorite: true,
        watchedAt: "2026-07-12T19:30:00.000Z",
        ratings: [{ participantName: "Антон", value: 9 }],
      }),
      createMovie({ id: "m2", title: "Братство Кольца" }),
    ],
  };

  const csv = buildLibraryCsv(library);
  const lines = csv.split("\r\n");

  assert.equal(lines.length, 3);
  assert.equal(lines[0], CSV_COLUMNS.join(";"));
  // Сортировка по названию: «Братство Кольца» раньше «Дюны».
  assert.ok(lines[1].startsWith("Братство Кольца;"));
  assert.ok(lines[1].includes("Средиземье"));
  assert.ok(lines[2].includes("Просмотрен"));
  assert.ok(lines[2].includes("2026-07-12"));
  // Разделитель — точка с запятой, поэтому запятая внутри ячейки безопасна.
  assert.ok(lines[2].includes("Фантастика, Драма"));
  assert.ok(!lines[2].includes('"Фантастика, Драма"'));
  assert.ok(lines[2].includes("Антон: 9"));
  assert.ok(lines[2].includes("да"));
});
