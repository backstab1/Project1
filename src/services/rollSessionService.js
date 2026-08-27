// Совместная сессия колеса: создание, подписка на журнал и ходы.
//
// Клиент не пишет в журнал сам — политика `roll_events` разрешает ему только
// чтение. Всё, что он может, — попросить сервер о ходе через Edge Function
// `roll-action`, а результат получить обратно из журнала. Поэтому здесь нет
// ни одной строки правил игры: они в domain/rollSessionLog.js и исполняются
// одинаково на сервере и в браузере.
//
// Доставку событий берёт на себя Realtime: сервер сам присылает новую строку
// журнала всем подписанным. Опрос «не появилось ли событие» был бы лишним
// трафиком у сотни человек и рваной синхронностью вместо ровной.

import { buildSessionFromLog } from "../domain/rollSessionLog.js";
import { getSupabaseClient } from "./supabaseClient.js";

export async function createSharedSession({
  pool,
  participants,
  savesEnabledAboveRemaining,
  guestIds = [],
}) {
  const client = await getSupabaseClient();
  const { data: session, error } = await client
    .from("roll_sessions")
    .insert({ save_threshold: Math.max(1, savesEnabledAboveRemaining ?? 1) })
    .select("id")
    .single();
  if (error) throw error;

  if (guestIds.length > 0) {
    const saves = countSaves(participants);
    const { error: membersError } = await client
      .from("roll_session_members")
      .insert(guestIds.map((userId) => ({
        session_id: session.id,
        user_id: userId,
        saves_left: saves,
      })));
    if (membersError) throw membersError;
  }

  // Состав фиксируется одним событием: журнал начинается с него, и переписать
  // начало задним числом нельзя.
  await actInSession(session.id, "session-started", {
    pool,
    participants,
    savesEnabledAboveRemaining,
  });

  return session.id;
}

export async function inviteToSession(sessionId, userId, saves = 0) {
  const client = await getSupabaseClient();
  const { error } = await client
    .from("roll_session_members")
    .insert({ session_id: sessionId, user_id: userId, saves_left: saves });
  if (error) throw error;
}

// Присоединившемуся посреди сессии журнал целиком не нужен: в roll_sessions
// лежит свёрнутый снимок состояния, собранный сервером после последнего хода.
export async function loadSharedSession(sessionId) {
  const client = await getSupabaseClient();
  const [session, members] = await Promise.all([
    client
      .from("roll_sessions")
      .select("id, host_id, status, state, save_threshold, completed_at")
      .eq("id", sessionId)
      .maybeSingle(),
    client
      .from("roll_session_members")
      .select("user_id, saves_left")
      .eq("session_id", sessionId),
  ]);
  if (session.error) throw session.error;
  if (members.error) throw members.error;
  if (!session.data) return null;

  return {
    id: session.data.id,
    hostId: session.data.host_id,
    status: session.data.status,
    state: session.data.state ?? null,
    saveThreshold: session.data.save_threshold,
    members: members.data ?? [],
  };
}

// Журнал целиком — на случай, когда снимку доверять нельзя: после обрыва связи
// клиент собирает состояние заново тем же редьюсером, что и сервер.
export async function loadSessionLog(sessionId) {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("roll_events")
    .select("seq, type, payload, actor_id, created_at")
    .eq("session_id", sessionId)
    .order("seq", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toLogEvent);
}

/**
 * Наблюдение за сессией: подписка плюс дочитывание журнала.
 *
 * Возвращает функцию отписки. Одной подписки мало по двум причинам, и обе
 * проверены на живом проекте:
 *
 *   1. между подтверждением подписки и началом доставки есть окно — событие,
 *      записанное в этот момент, до клиента не доходит. Так терялось начало
 *      сессии: спин приходил, а событие старта — нет;
 *   2. Realtime доставляет события, только пока живо соединение. После обрыва
 *      пропущенное не досылается.
 *
 * Поэтому журнал дочитывается из базы после каждого подключения, а события
 * складываются по `seq` — повтор и пропуск обрабатываются одинаково.
 *
 * Наружу отдаётся не сырое событие, а собранное состояние: сворачивает его
 * тот же редьюсер, что и на сервере.
 */
export async function watchSession(sessionId, handlers = {}) {
  const { onState, onError } = handlers;
  const client = await getSupabaseClient();

  const events = new Map();
  let stopped = false;

  const publish = () => {
    if (stopped) return;
    try {
      onState?.(buildSessionFromLog([...events.values()]));
    } catch (error) {
      onError?.(error);
    }
  };

  const remember = (event) => {
    if (!Number.isFinite(event.seq)) return false;
    if (events.has(event.seq)) return false;
    events.set(event.seq, event);
    return true;
  };

  const catchUp = async () => {
    try {
      const log = await loadSessionLog(sessionId);
      let changed = false;
      for (const event of log) changed = remember(event) || changed;
      if (changed || events.size === log.length) publish();
    } catch (error) {
      onError?.(error);
    }
  };

  const channel = client
    .channel(`roll-session:${sessionId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "roll_events",
        filter: `session_id=eq.${sessionId}`,
      },
      (message) => {
        if (remember(toLogEvent(message.new))) publish();
      },
    )
    .subscribe((status) => {
      // SUBSCRIBED приходит и при первом подключении, и после восстановления
      // связи. Оба случая лечатся одинаково — дочитыванием.
      if (status === "SUBSCRIBED") catchUp();
    });

  return () => {
    stopped = true;
    client.removeChannel(channel);
  };
}

export async function actInSession(sessionId, action, payload = {}) {
  const client = await getSupabaseClient();
  const { data, error } = await client.functions.invoke("roll-action", {
    body: { sessionId, action, payload },
  });
  if (!error) return data;

  const detail = await readFunctionError(error);
  throw new Error(detail || "Ход не прошёл.");
}

// Строка журнала приходит из двух мест — из выборки и из Realtime — и в обоих
// случаях называется по-своему. Приводим к тому виду, который ждёт редьюсер.
function toLogEvent(row) {
  return {
    seq: Number(row.seq),
    type: row.type,
    payload: row.payload ?? {},
    actorId: row.actor_id ?? null,
    at: row.created_at,
  };
}

function countSaves(participants) {
  const first = (participants ?? [])[0];
  return Number.isInteger(first?.saves) ? first.saves : 0;
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
