// Поиск и карточка фильма в TMDB.
//
// Токен TMDB — секрет этой функции, один на весь сервис: просить сотню человек
// завести собственный токен нереалистично. Отсюда два следствия, которых не
// было у прежнего прокси в launch.py:
//
//   1. функция доступна только вошедшему — иначе чужим токеном пользовался бы
//      кто угодно, кто знает адрес;
//   2. у каждого аккаунта своя дневная квота: общий токен расходуется всеми
//      сразу, и один пакетный прогон не должен оставлять остальных без TMDB.
//
// Ответы повторяют формат прежнего прокси один в один, поэтому разбор в
// domain/tmdbEnrichment.js не менялся.

import { createClient } from "jsr:@supabase/supabase-js@2";

const TMDB_API_ROOT = "https://api.themoviedb.org/3";
const DAILY_LIMIT = Number(Deno.env.get("TMDB_DAILY_LIMIT") ?? "300");
const SEARCH_LIMIT = 12;

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  // supabase-js добавляет к запросу свои заголовки: без них preflight
  // не проходит, и функция недоступна из браузера вовсе.
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function tmdbRequest(path: string, params: Record<string, string>) {
  const token = Deno.env.get("TMDB_READ_TOKEN");
  if (!token) {
    return { status: 503, body: { error: "TMDB не подключён на сервере." } };
  }

  const query = new URLSearchParams({ language: "ru-RU", ...params });
  let response: Response;
  try {
    response = await fetch(`${TMDB_API_ROOT}${path}?${query}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "CineVault/0.11",
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return { status: 502, body: { error: "Не удалось связаться с TMDB." } };
  }

  if (response.status === 401 || response.status === 403) {
    // Токен сервиса, а не пользователя: чинить это некому, кроме нас.
    return { status: 502, body: { error: "TMDB отклонил токен сервиса." } };
  }
  if (response.status === 404) {
    return { status: 404, body: { error: "Фильм не найден в TMDB." } };
  }
  if (!response.ok) {
    return {
      status: 502,
      body: { error: `TMDB временно недоступен (HTTP ${response.status}).` },
    };
  }

  try {
    return { status: 200, body: await response.json() };
  } catch {
    return { status: 502, body: { error: "TMDB вернул неожиданный ответ." } };
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") {
    return json(405, { error: "Метод не поддерживается." });
  }

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json(401, { error: "Требуется вход в аккаунт." });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) {
    return json(401, { error: "Сессия недействительна." });
  }

  let body: { action?: string; query?: string; year?: string | number; tmdbId?: string | number };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Тело запроса нечитаемо." });
  }

  const action = String(body.action ?? "");

  // Состояние подключения квоту не тратит: его спрашивает каждый запуск
  // приложения, а к самому TMDB этот ответ не ходит.
  if (action === "status") {
    return json(200, { configured: Boolean(Deno.env.get("TMDB_READ_TOKEN")) });
  }

  if (action !== "search" && action !== "movie") {
    return json(400, { error: "Неизвестное действие." });
  }

  // Аргументы разбираются до квоты: на кривом запросе к TMDB мы не ходим,
  // значит и списывать за него нечего.
  const query = String(body.query ?? "").trim();
  const tmdbId = Number(body.tmdbId);
  if (action === "search" && !query) {
    return json(400, { error: "Введите название фильма для поиска." });
  }
  if (action === "movie" && (!Number.isInteger(tmdbId) || tmdbId <= 0)) {
    return json(400, { error: "Некорректный идентификатор фильма TMDB." });
  }

  const { data: left, error: quotaError } = await caller.rpc("take_tmdb_quota", {
    p_limit: DAILY_LIMIT,
  });
  if (quotaError) {
    if (quotaError.code === "PT429") {
      return json(429, {
        error: `Дневной лимит запросов к TMDB исчерпан: ${DAILY_LIMIT} за сутки. Попробуйте завтра.`,
      });
    }
    return json(500, { error: "Не удалось учесть запрос к TMDB." });
  }

  // Уборка старых суток — раз в сутки, на первом запросе пользователя.
  // Построитель запросов supabase-js не обещание, а thenable: catch на нём
  // может не оказаться, поэтому обычный try.
  if (Number(left) === DAILY_LIMIT - 1) {
    try {
      await caller.rpc("prune_tmdb_usage");
    } catch {
      // Уборка не обязана удаться: она не влияет на ответ пользователю.
    }
  }

  if (action === "search") {
    const params: Record<string, string> = {
      query,
      include_adult: "false",
      page: "1",
    };
    const year = String(body.year ?? "").trim();
    if (year) params.primary_release_year = year;

    const result = await tmdbRequest("/search/movie", params);
    if (result.status !== 200) return json(result.status, result.body);

    const results = Array.isArray((result.body as { results?: unknown[] }).results)
      ? (result.body as { results: unknown[] }).results.slice(0, SEARCH_LIMIT)
      : [];
    return json(200, { results, quotaLeft: Number(left) });
  }

  const result = await tmdbRequest(`/movie/${tmdbId}`, {});
  return json(result.status, result.body);
});
