// Правила раздела «Друзья»: разбор заявок и список зрителей.
//
// Модуль намеренно чистый: он не знает ни про Supabase, ни про DOM. Сервер
// проверяет то же самое политиками и триггером friendships_guard, но человек
// должен видеть понятный русский ответ, а не код ошибки Postgres.
//
// Имена зрителей больше не вводятся руками: единственный источник имени —
// аккаунт. Поэтому список зрителей строится здесь, из профиля владельца и
// принятых заявок, и одинаково используется оценками и колесом.

import { normalizeHandle, validateHandle } from "./authRules.js";

export const FRIEND_STATUS = Object.freeze({
  pending: "pending",
  accepted: "accepted",
  blocked: "blocked",
});

// Заявка описывается парой «сторона + статус»: одна и та же строка выглядит
// входящей для адресата и исходящей для отправителя.
export function describeFriendship(row, selfId) {
  if (!row || !selfId) return null;
  const requesterId = row.requesterId ?? row.requester_id;
  const addresseeId = row.addresseeId ?? row.addressee_id;
  if (requesterId !== selfId && addresseeId !== selfId) return null;

  const outgoing = requesterId === selfId;
  const otherId = outgoing ? addresseeId : requesterId;
  const status = FRIEND_STATUS[row.status] ?? FRIEND_STATUS.pending;

  return {
    id: row.id,
    status,
    outgoing,
    otherId,
    profile: row.profile ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    respondedAt: row.respondedAt ?? row.responded_at ?? null,
    // Блокировку снимает только тот, кто её поставил: адресату строка видна,
    // но кнопки у него нет.
    ownBlock: status === FRIEND_STATUS.blocked && outgoing,
  };
}

export function groupFriendships(rows, selfId) {
  const groups = { friends: [], incoming: [], outgoing: [], blocked: [] };

  for (const row of rows ?? []) {
    const item = describeFriendship(row, selfId);
    if (!item) continue;
    if (item.status === FRIEND_STATUS.blocked) groups.blocked.push(item);
    else if (item.status === FRIEND_STATUS.accepted) groups.friends.push(item);
    else if (item.outgoing) groups.outgoing.push(item);
    else groups.incoming.push(item);
  }

  groups.friends.sort(byDisplayName);
  groups.incoming.sort(byCreatedAtDesc);
  groups.outgoing.sort(byCreatedAtDesc);
  groups.blocked.sort(byDisplayName);
  return groups;
}

export function countIncoming(rows, selfId) {
  return groupFriendships(rows, selfId).incoming.length;
}

// Зритель — это аккаунт, а не строка имени. Владелец библиотеки идёт первым:
// чаще всего оценку ставит он сам.
export function buildViewers(account, rows = []) {
  if (!account?.id) return [];

  const self = {
    userId: account.id,
    handle: account.handle ?? "",
    name: viewerName(account),
    isSelf: true,
  };

  const friends = groupFriendships(rows, account.id).friends
    .filter((item) => item.profile?.id)
    .map((item) => ({
      userId: item.profile.id,
      handle: item.profile.handle ?? "",
      name: viewerName(item.profile),
      isSelf: false,
    }));

  return [self, ...friends];
}

export function findViewer(viewers, userId) {
  return (viewers ?? []).find((viewer) => viewer.userId === userId) ?? null;
}

// Заявку подают по точному имени пользователя: списка всех аккаунтов сервер
// не отдаёт, найти можно только того, чьё имя знаешь.
export function validateFriendHandle(value, selfHandle = "") {
  const handle = normalizeHandle(value);
  if (!handle) return "Введите имя пользователя.";
  const format = validateHandle(handle);
  if (format) return format;
  if (handle === normalizeHandle(selfHandle)) {
    return "Это ваше имя пользователя.";
  }
  return null;
}

// Ошибки заявки приходят с сервера: часть — от триггеров на русском, часть —
// от Postgres по-английски. Неизвестную не прячем, иначе нечего чинить.
const KNOWN_ERRORS = [
  [/friendships_pair_key|duplicate key/i, "Заявка этому человеку уже есть."],
  [/friendships_not_self/i, "Нельзя добавить в друзья самого себя."],
  [/слишком много заявок/i, "Слишком много заявок за сутки. Попробуйте завтра."],
  [/принять заявку может только адресат/i, "Эту заявку принимает другая сторона."],
  [/дружба начинается с заявки/i, "Сначала нужна заявка."],
  [/снимите блокировку удалением заявки/i, "Снимите блокировку — и подайте заявку заново."],
  [/требуется профиль/i, "Сначала обменяйте код приглашения на профиль."],
  [/failed to fetch|networkerror/i, "Сервер недоступен. Проверьте связь."],
];

export function describeFriendError(error) {
  const message = typeof error === "string" ? error : error?.message ?? "";
  if (!message) return "Не удалось выполнить действие.";
  for (const [pattern, text] of KNOWN_ERRORS) {
    if (pattern.test(message)) return text;
  }
  return message;
}

function viewerName(profile) {
  const name = String(profile?.display_name ?? profile?.displayName ?? "").trim();
  if (name) return name;
  const handle = String(profile?.handle ?? "").trim();
  return handle ? `@${handle}` : "Без имени";
}

function byDisplayName(a, b) {
  return viewerName(a.profile).localeCompare(viewerName(b.profile), "ru-RU");
}

function byCreatedAtDesc(a, b) {
  return String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
}
