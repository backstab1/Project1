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

export function getMovieSorter(sort) {
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
