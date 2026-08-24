// Сессия колеса как журнал событий.
//
// В совместной сессии состояние нельзя вычислять на каждом клиенте
// самостоятельно: два браузера с собственным Math.random дадут двух разных
// победителей. Поэтому решения принимает сервер и пишет их в roll_events, а
// клиенты применяют журнал вот этим редьюсером. Одинаковый журнал даёт
// одинаковое состояние — это и есть весь механизм синхронности.
//
// Правила игры при этом не дублируются: редьюсер вызывает те же функции
// rollEngine, что и одиночное колесо. Сервер задаёт только две вещи, которых
// клиенту доверять нельзя, — случайность и порядок.

import {
  applySpin,
  confirmElimination,
  createRollSession,
  rerollSession,
  restoreEliminated,
  useSave,
} from "./rollEngine.js";

export const LOG_EVENTS = Object.freeze({
  started: "session-started",
  spin: "spin",
  reroll: "reroll",
  save: "save-used",
  eliminate: "eliminate",
  restore: "restore",
});

export function buildSessionFromLog(events = []) {
  let session = null;
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    session = applyRollEvent(session, event);
  }
  return session;
}

export function applyRollEvent(session, event) {
  if (!event || typeof event.type !== "string") {
    throw new TypeError("Событие журнала должно иметь тип.");
  }

  const at = event.at ?? event.created_at ?? null;
  if (!at) {
    throw new TypeError("Событие журнала должно иметь время сервера.");
  }
  const clock = () => at;
  const payload = event.payload ?? {};

  if (event.type === LOG_EVENTS.started) {
    const started = createRollSession(
      {
        pool: payload.pool,
        participants: payload.participants,
        savesEnabledAboveRemaining: payload.savesEnabledAboveRemaining,
      },
      clock,
    );
    return stampEvents(
      { ...started, id: payload.sessionId ?? started.id, events: [] },
      [],
      started.events,
      event,
    );
  }

  if (!session) {
    throw new Error("Журнал начинается не с начала сессии.");
  }

  const before = session.events;
  let next;

  if (event.type === LOG_EVENTS.spin) {
    next = applySpin(session, payload.index);
  } else if (event.type === LOG_EVENTS.reroll) {
    next = rerollSession(session);
  } else if (event.type === LOG_EVENTS.save) {
    next = useSave(session, payload.participantId);
  } else if (event.type === LOG_EVENTS.eliminate) {
    next = confirmElimination(session, clock);
  } else if (event.type === LOG_EVENTS.restore) {
    next = restoreEliminated(session, payload.entityType, payload.entityId);
  } else {
    throw new TypeError(`Неизвестное событие журнала: ${event.type}`);
  }

  return stampEvents(next, before, next.events.slice(before.length), event);
}

// Текст журнала пишет rollEngine — второго набора формулировок быть не должно.
// Но идентификатор и время у локально созданного события свои, а значит у
// каждого клиента разные. Здесь они заменяются на серверные.
function stampEvents(session, previousEvents, appended, event) {
  const stamped = appended.map((entry, index) => ({
    ...entry,
    id: `${event.seq}-${index}`,
    createdAt: event.at ?? event.created_at,
    actorId: event.actor_id ?? event.actorId ?? null,
  }));

  return { ...session, events: [...previousEvents, ...stamped] };
}

// Что клиент имеет право предложить серверу. Проверять всё равно будет сервер,
// но бессмысленный запрос лучше не отправлять вовсе.
export function canRequest(session, action, actorId) {
  if (action === LOG_EVENTS.spin || action === LOG_EVENTS.eliminate) {
    return Boolean(session) && session.status === "active" && session.hostId === actorId;
  }
  if (action === LOG_EVENTS.save) {
    return (
      Boolean(session) &&
      session.status === "active" &&
      session.pendingIndex !== null &&
      session.pool.length > session.savesEnabledAboveRemaining
    );
  }
  return Boolean(session) && session.status === "active";
}
