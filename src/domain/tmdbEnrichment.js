import { normalizeText, normalizeTags } from "./entities.js";

// Пакетное обогащение сопоставляет фильм библиотеки с карточкой TMDB
// автоматически, поэтому решение должно быть объяснимым: совпало ли название
// целиком и совпал ли год. Всё остальное человек подтверждает руками.

export const MATCH_CONFIDENCE = Object.freeze({
  exact: "exact",
  likely: "likely",
  unsure: "unsure",
});

export function selectEnrichmentCandidates(movies, options = {}) {
  const { onlyMissingPoster = false, includeLinked = false } = options;

  return (movies ?? []).filter((movie) => {
    if (!includeLinked && movie.tmdbId) return false;
    if (onlyMissingPoster) return !movie.posterPath && !movie.coverUrl;
    return (
      (!movie.posterPath && !movie.coverUrl) ||
      !movie.overview ||
      (movie.genres ?? []).length === 0
    );
  });
}

export function getTmdbYear(candidate) {
  const year = Number.parseInt(String(candidate?.release_date ?? "").slice(0, 4), 10);
  return Number.isInteger(year) ? year : null;
}

export function scoreTmdbMatch(movie, candidate) {
  const titles = [candidate?.title, candidate?.original_title]
    .filter(Boolean)
    .map((value) => normalizeText(value));
  const movieTitles = [movie?.title, movie?.originalTitle]
    .filter(Boolean)
    .map((value) => normalizeText(value));

  let titleScore = 0;
  for (const title of titles) {
    for (const own of movieTitles) {
      if (!title || !own) continue;
      if (title === own) titleScore = Math.max(titleScore, 2);
      else if (title.includes(own) || own.includes(title)) {
        titleScore = Math.max(titleScore, 1);
      }
    }
  }

  const candidateYear = getTmdbYear(candidate);
  const movieYear = Number.isInteger(movie?.releaseYear) ? movie.releaseYear : null;
  let yearScore = 0.5;
  if (candidateYear !== null && movieYear !== null) {
    const distance = Math.abs(candidateYear - movieYear);
    yearScore = distance === 0 ? 2 : distance === 1 ? 1 : 0;
  }

  return { titleScore, yearScore, total: titleScore + yearScore };
}

export function pickBestMatch(movie, results) {
  const scored = (results ?? [])
    .map((candidate) => ({ candidate, ...scoreTmdbMatch(movie, candidate) }))
    .sort((a, b) => b.total - a.total || (b.candidate.popularity ?? 0) - (a.candidate.popularity ?? 0));

  const best = scored[0];
  if (!best || best.titleScore === 0) {
    return { match: null, confidence: MATCH_CONFIDENCE.unsure, alternatives: scored.slice(0, 3) };
  }

  // Второй кандидат с тем же счётом означает неоднозначность: например,
  // оригинал и ремейк с одинаковым названием и близкими годами.
  const ambiguous = scored[1] && scored[1].total === best.total;
  let confidence = MATCH_CONFIDENCE.unsure;
  if (best.titleScore === 2 && best.yearScore === 2 && !ambiguous) {
    confidence = MATCH_CONFIDENCE.exact;
  } else if (best.titleScore === 2 && best.yearScore >= 0.5 && !ambiguous) {
    confidence = MATCH_CONFIDENCE.likely;
  } else if (best.titleScore >= 1 && best.yearScore === 2 && !ambiguous) {
    confidence = MATCH_CONFIDENCE.likely;
  }

  return {
    match: best.candidate,
    confidence,
    alternatives: scored.slice(0, 3).map((entry) => entry.candidate),
  };
}

// Обогащение дополняет карточку, а не переписывает её: то, что человек уже
// заполнил руками, остаётся нетронутым.
export function buildEnrichmentPatch(movie, details, options = {}) {
  const { overwrite = false } = options;
  const patch = {};
  const fill = (field, value) => {
    if (value === null || value === undefined || value === "") return;
    if (!overwrite && movie[field]) return;
    patch[field] = value;
  };

  fill("originalTitle", String(details?.original_title ?? "").trim());
  fill("overview", String(details?.overview ?? "").trim());
  fill("releaseYear", getTmdbYear(details));
  fill("durationMinutes", Number.isInteger(details?.runtime) ? details.runtime : null);
  fill(
    "country",
    (details?.production_countries ?? [])
      .map((country) => country?.name).filter(Boolean).join(", "),
  );
  fill("posterPath", String(details?.poster_path ?? "").trim());

  const genres = normalizeTags(
    (details?.genres ?? []).map((genre) => genre?.name).filter(Boolean),
  );
  if (genres.length && (overwrite || (movie.genres ?? []).length === 0)) {
    patch.genres = genres;
  }

  if (details?.id) {
    patch.tmdbId = details.id;
    patch.tmdbUpdatedAt = new Date().toISOString();
  }

  return patch;
}

export function summarizeEnrichment(results) {
  const summary = { updated: 0, review: 0, missing: 0, failed: 0 };
  for (const result of results ?? []) {
    if (summary[result?.outcome] !== undefined) {
      summary[result.outcome] += 1;
    }
  }
  return summary;
}
