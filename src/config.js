export const APP_NAME = "CineVault";
export const APP_VERSION = "0.11.0-beta.1";

// Адрес проекта Supabase и анонимный ключ. Ключ публичный по назначению:
// доступ ограничивают политики RLS, а не его скрытность. Ключ service_role
// сюда не попадает никогда — он даёт полный доступ в обход политик.
export const SUPABASE_URL = "https://yeibqfkzzkzykerxpuwu.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllaWJxZmt6emt6eWtlcnhwdXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NDYyMzYsImV4cCI6MjEwMzEyMjIzNn0.Vm5g9x8dVf3hAImkesmjnj6fbmZ2z5uY5nHb-qY02os";

export function isServerConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
export const DATABASE_NAME = "cinevault";
export const DATABASE_VERSION = 4;

export const STORE_NAMES = Object.freeze({
  meta: "meta",
  settings: "settings",
  categories: "categories",
  movies: "movies",
  franchises: "franchises",
  participants: "participants",
  rollSessions: "rollSessions",
  // Снимок последней загрузки библиотеки: одна запись на аккаунт, только
  // на чтение. Записи прежней локальной версии он не трогает.
  snapshots: "snapshots",
});

// Настройки живут в user_settings на сервере. Значения по умолчанию нужны
// новому аккаунту: до первой правки его строка настроек пуста.
export const DEFAULT_SETTINGS = Object.freeze({
  categoryDepthHint: 5,
  savesEnabledAboveRemaining: 3,
  soundEnabled: true,
  reducedMotion: false,
});
