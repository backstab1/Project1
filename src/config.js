export const APP_NAME = "CineVault";
export const APP_VERSION = "0.11.0-beta.1";

// Адрес проекта Supabase и анонимный ключ. Ключ публичный по назначению:
// доступ ограничивают политики RLS, а не его скрытность. Ключ service_role
// сюда не попадает никогда — он даёт полный доступ в обход политик.
export const SUPABASE_URL = "";
export const SUPABASE_ANON_KEY = "";

export function isServerConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
export const DATABASE_NAME = "cinevault";
export const DATABASE_VERSION = 3;

export const STORE_NAMES = Object.freeze({
  meta: "meta",
  settings: "settings",
  categories: "categories",
  movies: "movies",
  franchises: "franchises",
  participants: "participants",
  rollSessions: "rollSessions",
});

export const LEGACY_STORAGE_KEYS = Object.freeze([
  "mv_final_movies",
  "mv_final_franch",
  "mv_final_cats",
  "mv_final_saves",
]);

export const DEFAULT_SETTINGS = Object.freeze({
  categoryDepthHint: 5,
  savesEnabledAboveRemaining: 3,
  soundEnabled: true,
  reducedMotion: false,
  backupReminderDays: 30,
  autoBackupDays: 7,
  lastAutoBackupAt: null,
  lastBackupAt: null,
  backupReminderDismissedUntil: null,
});
