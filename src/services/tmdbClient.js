const JSON_HEADERS = Object.freeze({ "Content-Type": "application/json" });

export function getTmdbStatus() {
  return requestJson("/api/tmdb/status");
}

export function configureTmdbToken(token) {
  return requestJson("/api/tmdb/token", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ token }),
  });
}

export function clearTmdbToken() {
  return requestJson("/api/tmdb/token", { method: "DELETE" });
}

export function searchTmdbMovies(query, year = null) {
  const parameters = new URLSearchParams({ query: String(query ?? "").trim() });
  if (year) parameters.set("year", String(year));
  return requestJson(`/api/tmdb/search?${parameters}`);
}

export function getTmdbMovie(tmdbId) {
  return requestJson(`/api/tmdb/movie/${encodeURIComponent(tmdbId)}`);
}

export function cacheTmdbPoster(tmdbId, posterPath) {
  return requestJson("/api/tmdb/poster", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ tmdbId, posterPath }),
  });
}

export function tmdbPosterPreviewUrl(posterPath) {
  if (!posterPath || !/^\/[A-Za-z0-9._-]+$/.test(posterPath)) return "";
  return `https://image.tmdb.org/t/p/w185${posterPath}`;
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error("Локальный сервис CineVault недоступен.");
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Ошибка ниже остаётся понятной даже при повреждённом ответе сервера.
  }
  if (!response.ok) {
    throw new Error(payload.error || `TMDB вернул ошибку ${response.status}.`);
  }
  return payload;
}
