import {
  createCategory,
  createFranchise,
  createMovie,
  createParticipant,
  normalizeText,
  upsertRating,
} from "./entities.js";

const FIELD_ALIASES = {
  title: ["название", "фильм", "title", "movie"],
  originalTitle: ["оригинальное название", "original title", "originaltitle"],
  category: ["категория", "category", "подборка"],
  franchise: ["франшиза", "franchise", "серия"],
  year: ["год", "year", "release year"],
  duration: ["длительность", "продолжительность", "duration", "минуты"],
  country: ["страна", "country"],
  cover: ["обложка", "постер", "cover", "poster", "cover url"],
  watched: ["просмотрено", "просмотрен", "watched", "status"],
  watchedAt: ["дата просмотра", "watched at", "watcheddate"],
};

export function parseDelimitedText(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) {
    throw new Error("Таблица должна содержать заголовок и минимум одну строку.");
  }

  const headers = rows[0].map((header) =>
    String(header).replace(/^\uFEFF/, "").trim()
  );
  return rows.slice(1).map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    ),
  );
}

export function tableRowsToLibrary(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("В таблице нет строк для импорта.");
  }

  const headers = Object.keys(rows[0]);
  const fields = resolveFields(headers);
  if (!fields.title) {
    throw new Error(
      "Не найден столбец с названием фильма. Используйте заголовок «Название» или «Фильм».",
    );
  }

  const categories = [];
  const categoryByPath = new Map();
  const movies = [];
  const franchiseMovies = new Map();
  const participants = new Map();
  const categoryPositions = new Map();
  const ratingColumns = findRatingColumns(headers);

  for (const row of rows) {
    const title = cell(row, fields.title);
    if (!title) continue;

    const categoryId = ensureCategoryPath(
      cell(row, fields.category),
      categories,
      categoryByPath,
    );
    const categoryPosition = categoryPositions.get(categoryId) ?? 0;
    categoryPositions.set(categoryId, categoryPosition + 1);

    let ratings = [];
    for (const column of ratingColumns) {
      const value = parseRating(cell(row, column.header));
      if (value === null) continue;
      ratings = upsertRating(ratings, {
        participantName: column.participantName,
        value,
      });
      participants.set(
        normalizeText(column.participantName),
        createParticipant({ name: column.participantName }),
      );
    }

    const watchedAt = parseWatchedAt(
      cell(row, fields.watched),
      cell(row, fields.watchedAt),
    );
    const movie = createMovie({
      title,
      originalTitle: cell(row, fields.originalTitle),
      categoryId,
      categoryPosition,
      releaseYear: cell(row, fields.year),
      durationMinutes: cell(row, fields.duration),
      country: cell(row, fields.country),
      coverUrl: cell(row, fields.cover),
      watchedAt,
      ratings,
    });
    movies.push(movie);

    const franchiseName = cell(row, fields.franchise);
    if (franchiseName) {
      const key = normalizeText(franchiseName);
      if (!franchiseMovies.has(key)) {
        franchiseMovies.set(key, {
          name: franchiseName,
          categoryId,
          movieIds: [],
        });
      }
      franchiseMovies.get(key).movieIds.push(movie.id);
    }
  }

  if (movies.length === 0) {
    throw new Error("В таблице не найдено ни одного фильма с названием.");
  }

  return {
    movies,
    categories,
    franchises: [...franchiseMovies.values()].map((franchise, position) =>
      createFranchise({ ...franchise, categoryPosition: position })
    ),
    participants: [...participants.values()],
    rollSessions: [],
  };
}

export function detectDelimiter(text) {
  const firstLine = String(text).split(/\r?\n/, 1)[0] ?? "";
  const candidates = [";", "\t", ","];
  return candidates
    .map((delimiter) => ({
      delimiter,
      count: countOutsideQuotes(firstLine, delimiter),
    }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ";";
}

function resolveFields(headers) {
  const normalized = new Map(
    headers.map((header) => [normalizeText(header), header]),
  );
  return Object.fromEntries(
    Object.entries(FIELD_ALIASES).map(([field, aliases]) => [
      field,
      aliases.map((alias) => normalized.get(normalizeText(alias))).find(Boolean),
    ]),
  );
}

function findRatingColumns(headers) {
  return headers.flatMap((header) => {
    const match = /^(?:оценка|rating)\s*[:\-]?\s*(.+)$/iu.exec(header.trim());
    if (!match?.[1]) return [];
    return [{ header, participantName: match[1].trim() }];
  });
}

function ensureCategoryPath(path, categories, categoryByPath) {
  const parts = String(path ?? "")
    .split(/\s*(?:>|\/|\\)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  let parentId = null;
  let fullPath = "";
  for (const part of parts) {
    fullPath = fullPath ? `${fullPath}/${normalizeText(part)}` : normalizeText(part);
    if (!categoryByPath.has(fullPath)) {
      const siblings = categories.filter(
        (category) => category.parentId === parentId,
      );
      const category = createCategory({
        name: part,
        parentId,
        position: siblings.length,
      });
      categories.push(category);
      categoryByPath.set(fullPath, category);
    }
    parentId = categoryByPath.get(fullPath).id;
  }
  return parentId;
}

function parseWatchedAt(watchedValue, dateValue) {
  const date = parseDate(dateValue);
  if (date) return date;
  const normalized = normalizeText(watchedValue);
  if (["да", "yes", "true", "1", "просмотрено", "просмотрен"].includes(normalized)) {
    return new Date().toISOString();
  }
  return null;
}

function parseDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 1 && serial < 100000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      return new Date(excelEpoch + serial * 86400000).toISOString();
    }
  }
  const russian = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  const date = russian
    ? new Date(Number(russian[3]), Number(russian[2]) - 1, Number(russian[1]), 12)
    : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseRating(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) && number >= 1 && number <= 10
    ? number
    : null;
}

function cell(row, header) {
  return header ? String(row[header] ?? "").trim() : "";
}

function countOutsideQuotes(text, delimiter) {
  let count = 0;
  let quoted = false;
  for (const character of text) {
    if (character === '"') quoted = !quoted;
    if (character === delimiter && !quoted) count += 1;
  }
  return count;
}
