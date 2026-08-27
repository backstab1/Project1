import test from "node:test";
import assert from "node:assert/strict";

import { POSTER_SIZES, moviePosterUrl, tmdbPosterUrl } from "../src/domain/posters.js";

test("адрес постера собирается из пути TMDB и размера", () => {
  assert.equal(
    tmdbPosterUrl("/poster_1.jpg"),
    "https://image.tmdb.org/t/p/w342/poster_1.jpg",
  );
  assert.equal(
    tmdbPosterUrl("/poster_1.jpg", POSTER_SIZES.card),
    "https://image.tmdb.org/t/p/w500/poster_1.jpg",
  );
});

test("путь постера принимается только безопасной формы", () => {
  assert.equal(tmdbPosterUrl("https://example.com/a.jpg"), "");
  assert.equal(tmdbPosterUrl("/../token.jpg"), "");
  assert.equal(tmdbPosterUrl("poster.jpg"), "");
  assert.equal(tmdbPosterUrl(""), "");
  assert.equal(tmdbPosterUrl(null), "");
});

test("своя обложка важнее постера TMDB", () => {
  const movie = { coverUrl: "https://example.com/own.jpg", posterPath: "/tmdb.jpg" };
  assert.equal(moviePosterUrl(movie), "https://example.com/own.jpg");
});

test("без своей обложки берётся постер TMDB, без обоих — пусто", () => {
  assert.equal(
    moviePosterUrl({ coverUrl: "", posterPath: "/tmdb.jpg" }),
    "https://image.tmdb.org/t/p/w342/tmdb.jpg",
  );
  assert.equal(moviePosterUrl({ coverUrl: "   ", posterPath: "" }), "");
  assert.equal(moviePosterUrl({}), "");
  assert.equal(moviePosterUrl(null), "");
});
