import {
  calculateAverageRating,
  calculateFranchiseRating,
} from "./entities.js";

export function buildLibraryStatistics({ movies, categories, franchises }) {
  const movieById = new Map(movies.map((movie) => [movie.id, movie]));
  const watchedMovies = movies.filter((movie) => Boolean(movie.watchedAt));
  const ratedMovies = movies
    .map((movie) => ({
      movie,
      rating: calculateAverageRating(movie.ratings),
    }))
    .filter((entry) => entry.rating !== null);

  const sortedRatings = [...ratedMovies].sort((a, b) => b.rating - a.rating);
  const watchedFranchises = franchises.filter((franchise) => {
    const members = franchise.movieIds
      .map((movieId) => movieById.get(movieId))
      .filter(Boolean);
    return members.length > 0 && members.every((movie) => movie.watchedAt);
  });

  return {
    movieCount: movies.length,
    watchedMovieCount: watchedMovies.length,
    unwatchedMovieCount: movies.length - watchedMovies.length,
    categoryCount: categories.length,
    franchiseCount: franchises.length,
    watchedFranchiseCount: watchedFranchises.length,
    highestRatedMovie: sortedRatings[0] ?? null,
    lowestRatedMovie: sortedRatings.at(-1) ?? null,
    franchiseRatings: franchises.map((franchise) => ({
      franchise,
      rating: calculateFranchiseRating(franchise, movieById),
    })),
  };
}

