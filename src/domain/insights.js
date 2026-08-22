import { MOVIE_STATUS, calculateAverageRating } from "./entities.js";
import { getMovieStatus } from "./catalogQuery.js";

const MIN_RATED_PER_GENRE = 2;
const RECOMMENDATION_LIMIT = 6;

// Аналитика считается из исходных данных при каждом открытии раздела:
// дублирующих счётчиков в базе нет, поэтому расхождений быть не может.
export function buildInsights(library, { now = new Date() } = {}) {
  const movies = library?.movies ?? [];
  const watched = movies.filter((movie) => movie.watchedAt);

  return {
    decades: countDecades(movies),
    genres: rankGenres(movies),
    countries: rankCountries(movies),
    watchPace: buildWatchPace(watched, now),
    tasteProfile: buildTasteProfile(movies),
    recommendations: buildRecommendations(movies),
    statusBreakdown: countStatuses(movies),
  };
}

export function countStatuses(movies) {
  const counts = {
    [MOVIE_STATUS.queued]: 0,
    [MOVIE_STATUS.watching]: 0,
    [MOVIE_STATUS.watched]: 0,
    [MOVIE_STATUS.dropped]: 0,
  };
  for (const movie of movies ?? []) {
    counts[getMovieStatus(movie)] += 1;
  }
  return counts;
}

export function countDecades(movies) {
  const byDecade = new Map();
  for (const movie of movies ?? []) {
    if (!Number.isInteger(movie.releaseYear)) continue;
    const decade = Math.floor(movie.releaseYear / 10) * 10;
    byDecade.set(decade, (byDecade.get(decade) ?? 0) + 1);
  }

  return [...byDecade.entries()]
    .map(([decade, count]) => ({ decade, count }))
    .sort((a, b) => a.decade - b.decade);
}

export function rankGenres(movies) {
  const byGenre = new Map();
  for (const movie of movies ?? []) {
    const rating = calculateAverageRating(movie.ratings);
    for (const genre of movie.genres ?? []) {
      const entry = byGenre.get(genre) ?? { genre, count: 0, ratings: [] };
      entry.count += 1;
      if (rating !== null) entry.ratings.push(rating);
      byGenre.set(genre, entry);
    }
  }

  return [...byGenre.values()]
    .map(({ genre, count, ratings }) => ({
      genre,
      count,
      ratedCount: ratings.length,
      averageRating: ratings.length
        ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10
        : null,
    }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre, "ru-RU"));
}

export function rankCountries(movies) {
  const byCountry = new Map();
  for (const movie of movies ?? []) {
    // TMDB отдаёт страны одной строкой через запятую.
    for (const country of String(movie.country ?? "").split(",")) {
      const name = country.trim();
      if (!name) continue;
      byCountry.set(name, (byCountry.get(name) ?? 0) + 1);
    }
  }

  return [...byCountry.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country, "ru-RU"));
}

export function buildWatchPace(watchedMovies, now = new Date(), months = 12) {
  const buckets = [];
  const reference = new Date(now.getFullYear(), now.getMonth(), 1);

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(reference.getFullYear(), reference.getMonth() - offset, 1);
    buckets.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      count: 0,
      minutes: 0,
    });
  }

  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const movie of watchedMovies ?? []) {
    const date = new Date(movie.watchedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = byKey.get(key);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.minutes += movie.durationMinutes ?? 0;
  }

  return buckets;
}

// Вкус считается только по оценённым фильмам: жанр, который просто часто
// встречается в библиотеке, ещё ничего не говорит о симпатии.
export function buildTasteProfile(movies) {
  return rankGenres(movies)
    .filter((entry) => entry.ratedCount >= MIN_RATED_PER_GENRE)
    .sort((a, b) => b.averageRating - a.averageRating || b.ratedCount - a.ratedCount)
    .slice(0, 5);
}

export function buildRecommendations(movies) {
  const affinity = new Map(
    buildTasteProfile(movies).map((entry) => [entry.genre, entry.averageRating]),
  );
  if (affinity.size === 0) return [];

  return (movies ?? [])
    .filter((movie) => getMovieStatus(movie) === MOVIE_STATUS.queued)
    .map((movie) => {
      let score = 0;
      let reason = null;
      for (const genre of movie.genres ?? []) {
        const value = affinity.get(genre);
        if (value === undefined) continue;
        score += value;
        if (!reason || value > affinity.get(reason)) reason = genre;
      }
      if (movie.isFavorite) score += 1;
      return { movie, score, reason };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score ||
      a.movie.title.localeCompare(b.movie.title, "ru-RU"))
    .slice(0, RECOMMENDATION_LIMIT);
}
