import {
  MOVIE_STATUS,
  calculateAverageRating,
} from "./entities.js";
import { getMovieFranchiseMap } from "./libraryRules.js";

export const DEFAULT_CATALOG_FILTERS = Object.freeze({
  query: "",
  categoryId: "",
  genre: "",
  tag: "",
  status: "all",
  favoritesOnly: false,
  sort: "title",
});

export function getMovieStatus(movie) {
  return movie?.watchedAt
    ? MOVIE_STATUS.watched
    : movie?.status ?? MOVIE_STATUS.queued;
}

// Каталог и массовые операции обязаны видеть один и тот же список: иначе
// «выделить всё на экране» тихо захватит фильмы, скрытые фильтром.
export function filterCatalogMovies(library, filters = DEFAULT_CATALOG_FILTERS) {
  const categories = new Map(
    (library.categories ?? []).map((category) => [category.id, category]),
  );
  const franchiseByMovieId = getMovieFranchiseMap(library.franchises ?? []);
  const query = String(filters.query ?? "").trim().toLocaleLowerCase("ru-RU");

  return (library.movies ?? [])
    .filter((movie) => {
      if (query && ![
        movie.title,
        movie.originalTitle,
        movie.country,
        movie.overview,
        ...(movie.genres ?? []),
        ...(movie.tags ?? []),
        categories.get(movie.categoryId)?.name,
        franchiseByMovieId.get(movie.id)?.name,
        movie.releaseYear,
      ].some((value) => String(value ?? "").toLocaleLowerCase("ru-RU").includes(query))) {
        return false;
      }
      if (filters.categoryId && movie.categoryId !== filters.categoryId) return false;
      if (filters.genre &&
        !(movie.genres ?? []).some((genre) => genre === filters.genre)) return false;
      if (filters.status !== "all" && getMovieStatus(movie) !== filters.status) return false;
      if (filters.favoritesOnly && !movie.isFavorite) return false;
      if (filters.tag && !(movie.tags ?? []).some((tag) => tag === filters.tag)) return false;
      return true;
    })
    .sort(getMovieSorter(filters.sort));
}

// Порядок каталога. Значения совпадают с value в выпадающем списке вида.
export const CATALOG_SORTS = Object.freeze([
  ["title", "По названию"],
  ["recent", "Сначала новые в библиотеке"],
  ["year", "По году выхода"],
  ["rating", "По рейтингу"],
  ["duration", "Сначала короткие"],
  ["queue", "По очереди"],
]);

export function getMovieSorter(sort) {
  if (sort === "recent") {
    return (a, b) =>
      String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) ||
      a.title.localeCompare(b.title, "ru-RU");
  }
  if (sort === "duration") {
    // Длительность нужна, чтобы выбрать фильм под остаток вечера, поэтому
    // короткие идут первыми, а карточки без длительности — в конец списка.
    return (a, b) =>
      (Number(a.durationMinutes) || Infinity) - (Number(b.durationMinutes) || Infinity) ||
      a.title.localeCompare(b.title, "ru-RU");
  }
  if (sort === "year") {
    return (a, b) =>
      (b.releaseYear ?? -1) - (a.releaseYear ?? -1) ||
      a.title.localeCompare(b.title, "ru-RU");
  }
  if (sort === "rating") {
    return (a, b) =>
      (calculateAverageRating(b.ratings) ?? -1) -
        (calculateAverageRating(a.ratings) ?? -1) ||
      a.title.localeCompare(b.title, "ru-RU");
  }
  if (sort === "queue") {
    return (a, b) =>
      String(a.categoryId ?? "").localeCompare(String(b.categoryId ?? "")) ||
      a.categoryPosition - b.categoryPosition;
  }
  return (a, b) => a.title.localeCompare(b.title, "ru-RU");
}

// Случайный фильм из того, что человек сейчас видит. Генератор передаётся
// снаружи — так выбор проверяется тестом, а не удачей.
export function pickRandomMovie(movies, random = Math.random) {
  const list = Array.isArray(movies) ? movies : [];
  if (list.length === 0) return null;
  const index = Math.min(list.length - 1, Math.max(0, Math.floor(random() * list.length)));
  return list[index];
}
