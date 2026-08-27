// Проверка Edge Function `tmdb` на живом проекте (этап 17).
//
// Запуск: npm run check:tmdb
// Требуются переменные окружения из .env.local (см. .env.example).
// Скрипт создаёт временного пользователя и удаляет его за собой — запускать
// только на dev-проекте.
//
// Проверяется то, ради чего прокси переехал на сервер: токен доступен только
// вошедшему, ответы приходят на русском и в прежнем формате, а расход считает
// дневная квота на аккаунт.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !serviceKey || !anonKey) {
  console.error("Не заданы SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY и SUPABASE_ANON_KEY.");
  process.exit(2);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let failures = 0;
let total = 0;

function check(name, passed, detail = "") {
  total += 1;
  if (!passed) failures += 1;
  console.log(`${passed ? "  ok  " : " FAIL "} ${name}${detail && !passed ? ` — ${detail}` : ""}`);
}

function stamp() {
  return Math.random().toString(36).slice(2, 8);
}

async function createUser(handle) {
  const email = `tmdb-${handle}-${stamp()}@cinevault.test`;
  const password = `pwd-${stamp()}-${stamp()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) throw new Error(`создание пользователя: ${error.message}`);

  const code = `T${stamp().toUpperCase().padEnd(7, "X").slice(0, 7)}`;
  const invite = await admin.from("invites").insert({ code }).select().single();
  if (invite.error) throw new Error(`приглашение: ${invite.error.message}`);

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`вход: ${signIn.error.message}`);

  const profile = await client.rpc("redeem_invite", {
    p_code: code, p_handle: handle, p_display_name: handle,
  });
  if (profile.error) throw new Error(`redeem_invite: ${profile.error.message}`);

  return { id: data.user.id, client, token: signIn.data.session.access_token };
}

// Прямой вызов по HTTP: код ответа функции виден целиком, а не только через
// обёртку supabase-js.
async function callRaw(token, body) {
  const response = await fetch(`${url}/functions/v1/tmdb`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function main() {
  const user = await createUser(`probe${stamp()}`);

  try {
    const anonymous = await callRaw(null, { action: "status" });
    check(
      "без входа функция не отвечает",
      anonymous.status === 401,
      `HTTP ${anonymous.status}`,
    );

    const status = await callRaw(user.token, { action: "status" });
    check(
      "токен TMDB подключён на сервере",
      status.status === 200 && status.payload.configured === true,
      JSON.stringify(status.payload),
    );

    const search = await callRaw(user.token, { action: "search", query: "Дюна", year: 2021 });
    const first = search.payload?.results?.[0];
    check(
      "поиск возвращает совпадения",
      search.status === 200 && Array.isArray(search.payload.results) && search.payload.results.length > 0,
      `HTTP ${search.status}: ${JSON.stringify(search.payload).slice(0, 160)}`,
    );
    check(
      "в ответе есть идентификатор и путь постера",
      Number.isInteger(first?.id) && typeof first?.poster_path === "string",
      JSON.stringify(first ?? {}).slice(0, 160),
    );
    check(
      "ответ приходит на русском",
      typeof first?.title === "string" && /[а-яё]/i.test(first.title + (first.overview ?? "")),
      `название: ${first?.title}`,
    );

    const movie = await callRaw(user.token, { action: "movie", tmdbId: 438631 });
    check(
      "карточка фильма приходит целиком",
      movie.status === 200 &&
        movie.payload.id === 438631 &&
        Number.isInteger(movie.payload.runtime) &&
        Array.isArray(movie.payload.genres),
      `HTTP ${movie.status}: ${JSON.stringify(movie.payload).slice(0, 160)}`,
    );

    check(
      "квота расходуется на каждый запрос",
      Number.isInteger(search.payload.quotaLeft) &&
        (await callRaw(user.token, { action: "search", query: "Дюна" })).payload.quotaLeft <
          search.payload.quotaLeft,
      `после первого поиска осталось: ${search.payload.quotaLeft}`,
    );

    const statusAgain = await callRaw(user.token, { action: "status" });
    check(
      "состояние подключения квоту не тратит",
      statusAgain.status === 200 && statusAgain.payload.quotaLeft === undefined,
      JSON.stringify(statusAgain.payload),
    );

    const unknown = await callRaw(user.token, { action: "нечто" });
    check(
      "неизвестное действие отвергается",
      unknown.status === 400,
      `HTTP ${unknown.status}`,
    );

    const badId = await callRaw(user.token, { action: "movie", tmdbId: "не число" });
    check(
      "некорректный идентификатор отвергается",
      badId.status === 400,
      `HTTP ${badId.status}`,
    );

    const usage = await admin
      .from("tmdb_usage")
      .select("requests")
      .eq("user_id", user.id)
      .maybeSingle();
    // Ровно три: два поиска и одна карточка. Состояние подключения, неизвестное
    // действие и кривой идентификатор до TMDB не доходят и квоту не тратят.
    check(
      "квоту тратят только запросы, дошедшие до TMDB",
      Number(usage.data?.requests) === 3,
      `в счётчике: ${usage.data?.requests ?? "нет строки"}`,
    );
  } finally {
    await admin.auth.admin.deleteUser(user.id).catch(() => {});
  }

  console.log(`\nПроверок: ${total}, провалено: ${failures}.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nПроверка прервана: ${error.message}`);
  process.exit(2);
});
