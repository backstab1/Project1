// Работа с аккаунтом: вход, регистрация, профиль, восстановление пароля.
//
// Профиль создаётся только после первого успешного входа — раньше просто
// некому: до подтверждения почты сессии нет, а create_profile требует
// auth.uid(). Поэтому имя пользователя запоминается на устройстве и
// применяется, как только сессия появилась.

import { getSupabaseClient } from "./supabaseClient.js";

const PENDING_PROFILE_KEY = "cinevault-pending-profile";

export async function getSession() {
  const client = await getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session ?? null;
}

export async function onAuthChange(handler) {
  const client = await getSupabaseClient();
  const { data } = client.auth.onAuthStateChange((event, session) => {
    handler(event, session);
  });
  return () => data.subscription.unsubscribe();
}

export async function signIn({ email, password }) {
  const client = await getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signUp({ email, password, handle, displayName }) {
  const client = await getSupabaseClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${location.origin}${location.pathname}`,
      data: { handle, display_name: displayName },
    },
  });
  if (error) throw error;

  rememberPendingProfile({ handle, displayName });

  // Если подтверждение почты выключено, сессия приходит сразу — тогда профиль
  // можно создать не откладывая.
  if (data.session) {
    await ensureProfile();
  }

  return { session: data.session ?? null, needsConfirmation: !data.session };
}

export async function signOut() {
  const client = await getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
  forgetPendingProfile();
}

export async function requestPasswordReset(email) {
  const client = await getSupabaseClient();
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: `${location.origin}${location.pathname}`,
  });
  if (error) throw error;
}

export async function updatePassword(password) {
  const client = await getSupabaseClient();
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
}

export async function loadProfile() {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("profiles")
    .select("id, handle, display_name, library_visibility")
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function createProfile({ handle, displayName }) {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc("create_profile", {
    p_handle: handle,
    p_display_name: displayName,
  });
  if (error) throw error;
  forgetPendingProfile();
  return data;
}

// Возвращает профиль, если он есть или может быть создан из запомненного
// имени. null означает «нужно спросить имя пользователя».
export async function ensureProfile() {
  const existing = await loadProfile();
  if (existing) {
    forgetPendingProfile();
    return existing;
  }

  const pending = readPendingProfile();
  if (!pending) return null;

  return createProfile(pending);
}

// Удаление аккаунта требует прав, которых у браузера нет и не должно быть,
// поэтому его выполняет Edge Function ключом service_role.
export async function deleteAccount() {
  const client = await getSupabaseClient();
  const { error } = await client.functions.invoke("delete-account", { body: {} });
  if (error) throw error;
  await client.auth.signOut();
  forgetPendingProfile();
}

// Ссылка восстановления приводит человека обратно в приложение с особым
// состоянием сессии: пароль нужно задать прежде, чем пускать дальше.
export function isRecoveryEntry() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(location.search);
  return hash.get("type") === "recovery" || query.get("type") === "recovery";
}

function rememberPendingProfile(value) {
  try {
    localStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify(value));
  } catch {
    // Хранилище может быть недоступно: тогда код спросим ещё раз после входа.
  }
}

function readPendingProfile() {
  try {
    const raw = localStorage.getItem(PENDING_PROFILE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value?.handle || !value?.displayName) return null;
    return value;
  } catch {
    return null;
  }
}

function forgetPendingProfile() {
  try {
    localStorage.removeItem(PENDING_PROFILE_KEY);
  } catch {
    // Ничего страшного: лишний ключ никому не мешает.
  }
}
