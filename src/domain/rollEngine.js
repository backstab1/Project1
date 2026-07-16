import { createId } from "./entities.js";
import { buildCategoryQueue } from "./libraryRules.js";

export function buildRollPool(library) {
  const selectedKeys = new Set();
  const pool = [];
  const categories = flattenCategories(library.categories);

  for (const category of categories) {
    if (!Number.isInteger(category.rollQuota) || category.rollQuota <= 0) {
      continue;
    }

    const categoryIds = new Set([
      category.id,
      ...getDescendantCategoryIds(library.categories, category.id),
    ]);
    const candidates = [...categoryIds]
      .flatMap((categoryId) => buildCategoryQueue(library, categoryId))
      .filter((item) => isQueueItemEligible(item, library))
      .sort(
        (a, b) =>
          a.position - b.position ||
          a.title.localeCompare(b.title, "ru-RU"),
      );

    let added = 0;
    for (const candidate of candidates) {
      const key = `${candidate.type}:${candidate.id}`;
      if (selectedKeys.has(key)) {
        continue;
      }
      selectedKeys.add(key);
      pool.push(toParticipantSnapshot(candidate, category.id));
      added += 1;
      if (added >= category.rollQuota) {
        break;
      }
    }
  }

  return pool;
}

export function shufflePool(pool, random = Math.random) {
  const result = pool.map((item) => ({ ...item }));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function createRollSession({
  pool,
  participants,
  savesEnabledAboveRemaining,
}) {
  if (!Array.isArray(pool) || pool.length < 2) {
    throw new Error("Для запуска колеса нужно минимум два участника.");
  }
  const normalizedParticipants = normalizeParticipants(participants);
  if (normalizedParticipants.length === 0) {
    throw new Error("Добавьте хотя бы одного игрока.");
  }

  const now = new Date().toISOString();
  return {
    id: createId(),
    status: "active",
    createdAt: now,
    completedAt: null,
    originalPool: pool.map((item) => ({ ...item })),
    pool: pool.map((item) => ({ ...item })),
    eliminated: [],
    participants: normalizedParticipants,
    savesEnabledAboveRemaining: Math.max(
      1,
      Number.parseInt(savesEnabledAboveRemaining, 10) || 1,
    ),
    pendingIndex: null,
    winner: null,
    events: [
      createEvent("session-started", {
        participantCount: pool.length,
      }),
    ],
  };
}

export function spinSession(session, random = Math.random) {
  assertActiveSession(session);
  if (session.pendingIndex !== null) {
    throw new Error("Сначала подтвердите результат или перекрутите колесо.");
  }

  const pendingIndex = Math.min(
    session.pool.length - 1,
    Math.floor(random() * session.pool.length),
  );
  const selected = session.pool[pendingIndex];

  return {
    ...session,
    pendingIndex,
    events: [
      ...session.events,
      createEvent("spin-result", {
        entityType: selected.type,
        entityId: selected.id,
        title: selected.title,
      }),
    ],
  };
}

export function rerollSession(session) {
  assertActiveSession(session);
  if (session.pendingIndex === null) {
    return session;
  }
  const selected = session.pool[session.pendingIndex];

  return {
    ...session,
    pendingIndex: null,
    events: [
      ...session.events,
      createEvent("reroll", {
        entityType: selected.type,
        entityId: selected.id,
        title: selected.title,
      }),
    ],
  };
}

export function useSave(session, participantId) {
  assertActiveSession(session);
  if (session.pendingIndex === null) {
    throw new Error("Сейчас нет участника, которого можно спасти.");
  }
  if (session.pool.length <= session.savesEnabledAboveRemaining) {
    throw new Error("На этой стадии сейвы уже отключены.");
  }

  const participantIndex = session.participants.findIndex(
    (participant) => participant.id === participantId,
  );
  const participant = session.participants[participantIndex];
  if (!participant || participant.savesRemaining <= 0) {
    throw new Error("У выбранного игрока не осталось сейвов.");
  }

  const selected = session.pool[session.pendingIndex];
  const participants = session.participants.map((item, index) =>
    index === participantIndex
      ? { ...item, savesRemaining: item.savesRemaining - 1 }
      : item,
  );

  return {
    ...session,
    participants,
    pendingIndex: null,
    events: [
      ...session.events,
      createEvent("save-used", {
        participantId: participant.id,
        participantName: participant.name,
        entityType: selected.type,
        entityId: selected.id,
        title: selected.title,
      }),
    ],
  };
}

export function confirmElimination(session) {
  assertActiveSession(session);
  if (session.pendingIndex === null) {
    throw new Error("Нет результата для подтверждения.");
  }

  const pool = [...session.pool];
  const [eliminatedItem] = pool.splice(session.pendingIndex, 1);
  const eliminated = [
    {
      ...eliminatedItem,
      eliminatedAt: new Date().toISOString(),
    },
    ...session.eliminated,
  ];
  const events = [
    ...session.events,
    createEvent("entity-eliminated", {
      entityType: eliminatedItem.type,
      entityId: eliminatedItem.id,
      title: eliminatedItem.title,
      remaining: pool.length,
    }),
  ];

  if (pool.length === 1) {
    const winner = pool[0];
    const completedAt = new Date().toISOString();
    return {
      ...session,
      status: "completed",
      completedAt,
      pool,
      eliminated,
      pendingIndex: null,
      winner,
      events: [
        ...events,
        createEvent("winner-declared", {
          entityType: winner.type,
          entityId: winner.id,
          title: winner.title,
        }),
      ],
    };
  }

  return {
    ...session,
    pool,
    eliminated,
    pendingIndex: null,
    events,
  };
}

export function restoreEliminated(session, entityType, entityId) {
  assertActiveSession(session);
  const index = session.eliminated.findIndex(
    (item) => item.type === entityType && item.id === entityId,
  );
  if (index < 0) {
    return session;
  }

  const eliminated = [...session.eliminated];
  const [restored] = eliminated.splice(index, 1);
  const { eliminatedAt, ...participant } = restored;

  return {
    ...session,
    pool: [...session.pool, participant],
    eliminated,
    pendingIndex: null,
    events: [
      ...session.events,
      createEvent("entity-restored", {
        entityType,
        entityId,
        title: participant.title,
      }),
    ],
  };
}

function flattenCategories(categories) {
  const childrenByParent = new Map();
  for (const category of categories) {
    const parentId = category.parentId ?? null;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(category);
  }
  for (const children of childrenByParent.values()) {
    children.sort(
      (a, b) =>
        a.position - b.position ||
        a.name.localeCompare(b.name, "ru-RU"),
    );
  }

  const result = [];
  const visit = (parentId) => {
    for (const category of childrenByParent.get(parentId) ?? []) {
      result.push(category);
      visit(category.id);
    }
  };
  visit(null);
  return result;
}

function getDescendantCategoryIds(categories, categoryId) {
  const result = [];
  const visit = (parentId) => {
    for (const category of categories) {
      if (category.parentId === parentId) {
        result.push(category.id);
        visit(category.id);
      }
    }
  };
  visit(categoryId);
  return result;
}

function isQueueItemEligible(item, library) {
  if (item.type === "movie") {
    const belongsToFranchise = library.franchises.some((franchise) =>
      franchise.movieIds.includes(item.id),
    );
    return !belongsToFranchise && !item.value.watchedAt;
  }

  const members = item.value.movieIds
    .map((movieId) => library.movies.find((movie) => movie.id === movieId))
    .filter(Boolean);
  return members.length > 0 && members.some((movie) => !movie.watchedAt);
}

function toParticipantSnapshot(item, sourceCategoryId) {
  return {
    type: item.type,
    id: item.id,
    title: item.title,
    sourceCategoryId,
  };
}

function normalizeParticipants(participants) {
  if (!Array.isArray(participants)) {
    return [];
  }

  return participants
    .map((participant) => ({
      id: participant.id ?? createId(),
      name: String(participant.name ?? "").trim(),
      savesInitial: Math.max(
        0,
        Number.parseInt(participant.saves, 10) || 0,
      ),
    }))
    .filter((participant) => participant.name)
    .map((participant) => ({
      ...participant,
      savesRemaining: participant.savesInitial,
    }));
}

function assertActiveSession(session) {
  if (!session || session.status !== "active") {
    throw new Error("Сессия уже завершена или не была создана.");
  }
}

function createEvent(type, details) {
  return {
    id: createId(),
    type,
    createdAt: new Date().toISOString(),
    ...details,
  };
}
