import test from "node:test";
import assert from "node:assert/strict";

import {
  detectDelimiter,
  parseDelimitedText,
  tableRowsToLibrary,
} from "../src/domain/spreadsheetImport.js";

test("CSV с точкой с запятой и кавычками разбирается корректно", () => {
  const rows = parseDelimitedText(
    'Название;Категория;Страна\n"Начало";"Фантастика > Сны";США',
  );
  assert.equal(rows[0].Название, "Начало");
  assert.equal(rows[0].Категория, "Фантастика > Сны");
});

test("разделитель определяется между CSV и TSV", () => {
  assert.equal(detectDelimiter("Название;Год\nНачало;2010"), ";");
  assert.equal(detectDelimiter("Название\tГод\nНачало\t2010"), "\t");
});

test("строки таблицы создают категории, франшизы и оценки", () => {
  const library = tableRowsToLibrary([
    {
      Название: "Братство кольца",
      Категория: "Фэнтези > Средиземье",
      Франшиза: "Властелин колец",
      Год: "2001",
      "Оценка Антон": "9,5",
      Просмотрено: "да",
    },
    {
      Название: "Две крепости",
      Категория: "Фэнтези > Средиземье",
      Франшиза: "Властелин колец",
      Год: "2002",
      "Оценка Антон": "9",
      Просмотрено: "",
    },
  ]);

  assert.equal(library.categories.length, 2);
  assert.equal(library.movies.length, 2);
  assert.equal(library.franchises[0].movieIds.length, 2);
  assert.equal(library.movies[0].ratings[0].value, 9.5);
  assert.ok(library.movies[0].watchedAt);
});

