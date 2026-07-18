import test from "node:test";
import assert from "node:assert/strict";

import {
  configureTmdbToken,
  searchTmdbMovies,
  tmdbPosterPreviewUrl,
} from "../src/services/tmdbClient.js";

test("поиск TMDB кодирует название и год", async (context) => {
  context.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "/api/tmdb/search?query=%D0%94%D1%8E%D0%BD%D0%B0&year=2021");
    return new Response(JSON.stringify({ results: [{ id: 438631 }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const payload = await searchTmdbMovies(" Дюна ", 2021);
  assert.equal(payload.results[0].id, 438631);
});

test("токен передаётся только локальному API в теле POST", async (context) => {
  context.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/tmdb/token");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { token: "secret-token-value" });
    return new Response(JSON.stringify({ configured: true }), { status: 200 });
  });

  assert.equal((await configureTmdbToken("secret-token-value")).configured, true);
});

test("URL превью принимает только безопасный путь постера", () => {
  assert.equal(
    tmdbPosterPreviewUrl("/poster_1.jpg"),
    "https://image.tmdb.org/t/p/w185/poster_1.jpg",
  );
  assert.equal(tmdbPosterPreviewUrl("https://example.com/a.jpg"), "");
  assert.equal(tmdbPosterPreviewUrl("/../token.jpg"), "");
});
