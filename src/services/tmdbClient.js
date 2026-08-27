// Обращения к TMDB идут через Edge Function `tmdb`.
//
// Токена в браузере нет: он секрет функции, один на весь сервис. Поэтому здесь
// не осталось ни подключения токена, ни его удаления — только поиск, карточка
// и состояние подключения. Квоту считает сервер.

import { getSupabaseClient } from "./supabaseClient.js";

export async function getTmdbStatus() {
  return invoke({ action: "status" });
}

export function searchTmdbMovies(query, year = null) {
  return invoke({
    action: "search",
    query: String(query ?? "").trim(),
    year: year ? String(year) : "",
  });
}

export function getTmdbMovie(tmdbId) {
  return invoke({ action: "movie", tmdbId });
}

async function invoke(body) {
  const client = await getSupabaseClient();
  const { data, error } = await client.functions.invoke("tmdb", { body });

  if (!error) return data;

  // Текст ошибки функция кладёт в тело ответа: без него у пользователя
  // осталось бы «Edge Function returned a non-2xx status code».
  const detail = await readFunctionError(error);
  throw new Error(detail || "Служба TMDB недоступна.");
}

async function readFunctionError(error) {
  try {
    const payload = await error?.context?.json?.();
    if (payload?.error) return String(payload.error);
  } catch {
    // Тело могло быть пустым или нечитаемым — остаётся общий текст.
  }
  return error?.message ?? "";
}
