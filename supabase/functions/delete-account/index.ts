// Удаление собственного аккаунта.
//
// Браузер этого сделать не может и не должен: удаление пользователя требует
// ключа service_role. Функция проверяет, кто пришёл, и удаляет ровно его.
// Библиотека, оценки, дружбы и сессии уходят следом каскадом по внешним
// ключам на auth.users.

import { createClient } from "jsr:@supabase/supabase-js@2";

import { jsonResponse, preflight } from "../_shared/cors.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflight(request);
  if (request.method !== "POST") {
    return jsonResponse(request, 405, { error: "Метод не поддерживается." });
  }

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return jsonResponse(request, 401, { error: "Требуется вход в аккаунт." });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Кто пришёл — решает не тело запроса, а токен: подставить чужой
  // идентификатор в JSON нельзя.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse(request, 401, { error: "Сессия недействительна." });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.auth.admin.deleteUser(userData.user.id);
  if (error) {
    console.error("delete-account", error);
    return jsonResponse(request, 500, { error: "Не удалось удалить аккаунт." });
  }

  return jsonResponse(request, 200, { deleted: true });
});
