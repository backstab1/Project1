// Заголовки CORS — одни на все функции.
//
// Раньше каждая функция несла свою копию, и копии разошлись дважды: сначала в
// списке разрешённых заголовков не оказалось `x-client-info`, который шлёт
// supabase-js, — браузер не проходил preflight и функция была недоступна
// вовсе; потом в APP_ORIGIN появился список адресов, и функция, не знавшая об
// этом, отдала бы весь список одной строкой. Поэтому здесь одно место.
//
// В APP_ORIGIN лежит перечень адресов через запятую: боевой сайт и localhost
// для разработки. Пока переменная не задана, пускаем кого угодно — так удобно
// на старте, пока адрес сервиса ещё не известен.

const ALLOWED_ORIGINS = (Deno.env.get("APP_ORIGIN") ?? "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export function corsFor(request: Request, methods = "POST, OPTIONS") {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = ALLOWED_ORIGINS.includes("*")
    ? "*"
    : ALLOWED_ORIGINS.includes(origin)
      ? origin
      : ALLOWED_ORIGINS[0] ?? "";

  return {
    "Access-Control-Allow-Origin": allowed,
    // Ответ зависит от заголовка Origin, и кэш обязан это учитывать.
    "Vary": "Origin",
    // supabase-js добавляет к запросу свои заголовки: без них preflight не
    // проходит, и функция недоступна из браузера.
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": methods,
  };
}

export function jsonResponse(request: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(request), "Content-Type": "application/json" },
  });
}

export function preflight(request: Request) {
  return new Response(null, { headers: corsFor(request) });
}
