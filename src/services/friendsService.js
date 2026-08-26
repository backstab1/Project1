// Друзья: заявки, ответы и приватность библиотеки.
//
// Ничего не решает сам — решают политики RLS и триггер friendships_guard.
// Здесь только запросы и приведение строк к виду, который понимает
// src/domain/friends.js.
//
// Профили не приезжают вместе с заявкой: внешние ключи friendships ведут в
// auth.users, а не в public.profiles, поэтому вложить их одним запросом
// PostgREST не может. Профили дочитываются вторым запросом — политика
// profiles_select отдаёт ровно тех, с кем есть заявка.

import { getSupabaseClient } from "./supabaseClient.js";

export async function loadFriendships(selfId) {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("friendships")
    .select("id, requester_id, addressee_id, status, responded_at, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = data ?? [];
  const otherIds = [
    ...new Set(
      rows.map((row) =>
        row.requester_id === selfId ? row.addressee_id : row.requester_id,
      ),
    ),
  ];

  const profiles = await loadProfiles(client, otherIds);
  return rows.map((row) => ({
    ...row,
    profile: profiles.get(
      row.requester_id === selfId ? row.addressee_id : row.requester_id,
    ) ?? null,
  }));
}

async function loadProfiles(client, ids) {
  if (ids.length === 0) return new Map();
  const { data, error } = await client
    .from("profiles")
    .select("id, handle, display_name")
    .in("id", ids);
  if (error) throw error;
  return new Map((data ?? []).map((profile) => [profile.id, profile]));
}

// Поиск идёт через функцию: таблица профилей закрыта политикой, выгрузить
// список всех пользователей нельзя даже постранично.
export async function findProfileByHandle(handle) {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc("find_profile_by_handle", {
    p_handle: handle,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function sendFriendRequest(userId) {
  const client = await getSupabaseClient();
  const { data: auth } = await client.auth.getUser();
  const selfId = auth?.user?.id;
  if (!selfId) throw new Error("Требуется вход в аккаунт.");

  const { data, error } = await client
    .from("friendships")
    .insert({ requester_id: selfId, addressee_id: userId, status: "pending" })
    .select("id, requester_id, addressee_id, status, responded_at, created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function acceptFriendRequest(id) {
  const client = await getSupabaseClient();
  const { error } = await client
    .from("friendships")
    .update({ status: "accepted" })
    .eq("id", id);
  if (error) throw error;
}

// Отклонение, отмена своей заявки, удаление из друзей и снятие блокировки —
// одно и то же действие: строки просто не остаётся. Заявку можно подать
// заново, история отношений в базе не копится.
export async function removeFriendship(id) {
  const client = await getSupabaseClient();
  const { error } = await client.from("friendships").delete().eq("id", id);
  if (error) throw error;
}

// Блокировка ставится на существующую строку, а если её нет — создаётся сразу
// заблокированной: заблокировать можно и того, кто ещё не написал.
export async function blockUser({ friendshipId, userId }) {
  const client = await getSupabaseClient();

  if (friendshipId) {
    const { error } = await client
      .from("friendships")
      .update({ status: "blocked" })
      .eq("id", friendshipId);
    if (error) throw error;
    return;
  }

  const { data: auth } = await client.auth.getUser();
  const selfId = auth?.user?.id;
  if (!selfId) throw new Error("Требуется вход в аккаунт.");

  const { error } = await client
    .from("friendships")
    .insert({ requester_id: selfId, addressee_id: userId, status: "blocked" });
  if (error) throw error;
}

// Приватность библиотеки: 'private' — не видит никто, 'friends' — принятые
// друзья. Проверяет это не клиент, а library_visible_to в политиках.
export async function setLibraryVisibility(visibility) {
  const client = await getSupabaseClient();
  const { data: auth } = await client.auth.getUser();
  const selfId = auth?.user?.id;
  if (!selfId) throw new Error("Требуется вход в аккаунт.");

  const { data, error } = await client
    .from("profiles")
    .update({ library_visibility: visibility })
    .eq("id", selfId)
    .select("id, handle, display_name, library_visibility")
    .single();
  if (error) throw error;
  return data;
}
