// Ход в совместной сессии колеса.
//
// Клиент не пишет в журнал сам: политика roll_events разрешает только чтение.
// Всё, что клиент может, — попросить сервер о ходе. Сервер решает две вещи,
// которых браузеру доверять нельзя: случайность спина и право хода.
//
// Правила игры при этом не переписываются на сервере заново — функция
// импортирует тот же редьюсер, что и браузер. Если ход незаконен, редьюсер
// бросит исключение здесь, ещё до записи события.

import { createClient } from "jsr:@supabase/supabase-js@2";

import {
  LOG_EVENTS,
  applyRollEvent,
  buildSessionFromLog,
} from "../../../src/domain/rollSessionLog.js";

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  // supabase-js добавляет к запросу свои заголовки: без них preflight
  // не проходит, и функция недоступна из браузера вовсе.
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Сколько длится вращение и насколько вперёд назначается общий старт.
const SPIN_DURATION_MS = 7200;
const SPIN_LEAD_MS = 350;

const ALLOWED = new Set<string>([
  LOG_EVENTS.started,
  LOG_EVENTS.spin,
  LOG_EVENTS.reroll,
  LOG_EVENTS.save,
  LOG_EVENTS.eliminate,
  LOG_EVENTS.restore,
]);

// Ведущий распоряжается ходом колеса; сейв тратит любой участник, потому что
// сейв принадлежит игроку, а не ведущему.
const HOST_ONLY = new Set<string>([
  LOG_EVENTS.started,
  LOG_EVENTS.spin,
  LOG_EVENTS.eliminate,
  LOG_EVENTS.restore,
]);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json(405, { error: "Метод не поддерживается." });

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json(401, { error: "Требуется вход в аккаунт." });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return json(401, { error: "Сессия недействительна." });
  const actorId = userData.user.id;

  let body: { sessionId?: string; action?: string; payload?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Тело запроса нечитаемо." });
  }

  const sessionId = String(body.sessionId ?? "");
  const action = String(body.action ?? "");
  if (!sessionId || !ALLOWED.has(action)) {
    return json(400, { error: "Неизвестный ход." });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: session, error: sessionError } = await admin
    .from("roll_sessions")
    .select("id, host_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) return json(500, { error: "Сессия недоступна." });
  if (!session) return json(404, { error: "Сессия не найдена." });
  if (session.status !== "active") return json(409, { error: "Сессия уже завершена." });

  const { data: membership } = await admin
    .from("roll_session_members")
    .select("user_id")
    .eq("session_id", sessionId)
    .eq("user_id", actorId)
    .maybeSingle();
  if (session.host_id !== actorId && !membership) {
    return json(403, { error: "Вы не участник этой сессии." });
  }
  if (HOST_ONLY.has(action) && session.host_id !== actorId) {
    return json(403, { error: "Этот ход делает ведущий." });
  }

  const { data: events, error: eventsError } = await admin
    .from("roll_events")
    .select("seq, type, payload, created_at, actor_id")
    .eq("session_id", sessionId)
    .order("seq", { ascending: true });
  if (eventsError) return json(500, { error: "Журнал недоступен." });

  let state;
  try {
    state = buildSessionFromLog(
      (events ?? []).map((event) => ({ ...event, at: event.created_at })),
    );
  } catch (error) {
    console.error("roll-action: журнал не собирается", error);
    return json(500, { error: "Журнал сессии повреждён." });
  }

  const at = new Date().toISOString();
  const payload = { ...(body.payload ?? {}) };

  // Состав сессии фиксируется один раз: журнал начинается с одного события,
  // и переписать начало задним числом нельзя.
  if (action === LOG_EVENTS.started) {
    if (state) {
      return json(409, { error: "Сессия уже начата." });
    }
    payload.sessionId = sessionId;
  } else if (!state) {
    return json(409, { error: "Сессия ещё не начата." });
  }

  // Случайность — единственное, чего нет в запросе клиента и не может быть.
  if (action === LOG_EVENTS.spin) {
    if (!state || state.pool.length === 0) {
      return json(409, { error: "В колесе некого выбирать." });
    }
    const random = crypto.getRandomValues(new Uint32Array(2));
    payload.index = random[0] % state.pool.length;
    // Вращение задаёт сервер целиком: не только чем закончится, но и сколько
    // оборотов и когда начать. Иначе у каждого участника колесо крутилось бы
    // по-своему, а «синхронно» превратилось бы в «примерно одинаково».
    payload.turns = 5 + (random[1] % 4);
    payload.duration = SPIN_DURATION_MS;
    // Небольшая фора на доставку события: к этому моменту его успевают
    // получить все, и колесо трогается у всех разом по общим часам.
    payload.startAt = new Date(Date.now() + SPIN_LEAD_MS).toISOString();
  }

  const candidate = {
    seq: (state?.events?.length ?? 0) + 1,
    type: action,
    at,
    actor_id: actorId,
    payload,
  };

  // Проверка законности хода — тем же кодом, что и в браузере.
  let nextState;
  try {
    nextState = applyRollEvent(state, candidate);
  } catch (error) {
    return json(409, { error: (error as Error).message });
  }

  const { error: insertError } = await admin.from("roll_events").insert({
    session_id: sessionId,
    actor_id: actorId,
    type: action,
    payload,
    created_at: at,
  });
  if (insertError) {
    console.error("roll-action: событие не записано", insertError);
    return json(500, { error: "Ход не записан." });
  }

  // Свёрнутый снимок нужен тем, кто присоединится посреди сессии и не станет
  // перечитывать весь журнал.
  await admin
    .from("roll_sessions")
    .update({
      state: nextState,
      status: nextState.status === "completed" ? "completed" : "active",
      completed_at: nextState.completedAt ?? null,
    })
    .eq("id", sessionId);

  return json(200, { at, action, payload });
});
