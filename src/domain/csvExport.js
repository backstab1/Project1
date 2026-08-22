import { MOVIE_STATUS_LABELS, calculateAverageRating } from "./entities.js";
import { getMovieStatus } from "./catalogQuery.js";
import { getMovieFranchiseMap } from "./libraryRules.js";

const COLUMNS = [
  "Название",
  "Оригинальное название",
  "Год",
  "Длительность",
  "Страна",
  "Жанры",
  "Список",
  "Коллекция",
  "Статус",
  "Дата просмотра",
  "Средняя оценка",
  "Оценки",
  "Теги",
  "Избранное",
  "Заметка",
  "TMDB ID",
];

// Экспорт в CSV нужен для чтения библиотеки в таблице, а не для восстановления:
// полный перенос по-прежнему делает JSON-копия.
export function buildLibraryCsv(library, { delimiter = ";" } = {}) {
  const categories = new Map(
    (library.categories ?? []).map((category) => [category.id, category.name]),
  );
  const franchiseByMovieId = getMovieFranchiseMap(library.franchises ?? []);

  const rows = [...(library.movies ?? [])]
    .sort((a, b) => a.title.localeCompare(b.title, "ru-RU"))
    .map((movie) => {
      const rating = calculateAverageRating(movie.ratings);
      return [
        movie.title,
        movie.originalTitle,
        movie.releaseYear,
        movie.durationMinutes,
        movie.country,
        (movie.genres ?? []).join(", "),
        categories.get(movie.categoryId) ?? "",
        franchiseByMovieId.get(movie.id)?.name ?? "",
        MOVIE_STATUS_LABELS[getMovieStatus(movie)],
        movie.watchedAt ? movie.watchedAt.slice(0, 10) : "",
        rating ?? "",
        (movie.ratings ?? [])
          .map((item) => `${item.participantName}: ${item.value}`)
          .join(", "),
        (movie.tags ?? []).join(", "),
        movie.isFavorite ? "да" : "",
        movie.notes,
        movie.tmdbId ?? "",
      ];
    });

  return [COLUMNS, ...rows]
    .map((row) => row.map((value) => escapeCsvCell(value, delimiter)).join(delimiter))
    .join("\r\n");
}

export function escapeCsvCell(value, delimiter = ";") {
  const text = value === null || value === undefined ? "" : String(value);
  // Кавычки, переводы строк и сам разделитель ломают таблицу, если не экранировать.
  if (text.includes('"') || text.includes(delimiter) || /[\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export const CSV_COLUMNS = Object.freeze(COLUMNS);
