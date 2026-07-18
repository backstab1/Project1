export const THEME_STORAGE_KEY = "cinevault-theme";
export const THEMES = Object.freeze(["light", "dark"]);

export function getInitialTheme({ storage, prefersDark } = {}) {
  const resolvedStorage = storage ?? globalThis.localStorage;
  try {
    const savedTheme = resolvedStorage?.getItem(THEME_STORAGE_KEY);
    if (THEMES.includes(savedTheme)) return savedTheme;
  } catch {
    // Недоступное локальное хранилище не должно блокировать запуск приложения.
  }

  const resolvedPreference = prefersDark ?? globalThis.matchMedia?.(
    "(prefers-color-scheme: dark)",
  ).matches;
  return resolvedPreference ? "dark" : "light";
}

export function applyTheme(theme, documentElement = globalThis.document?.documentElement) {
  const normalizedTheme = THEMES.includes(theme) ? theme : "light";
  if (documentElement) {
    documentElement.dataset.theme = normalizedTheme;
    documentElement.style.colorScheme = normalizedTheme;
  }
  return normalizedTheme;
}

export function saveTheme(theme, storage = globalThis.localStorage) {
  const normalizedTheme = THEMES.includes(theme) ? theme : "light";
  try {
    storage?.setItem(THEME_STORAGE_KEY, normalizedTheme);
  } catch {
    // Тема всё равно применяется на время текущего сеанса.
  }
  return normalizedTheme;
}

export function toggleTheme(theme) {
  return theme === "dark" ? "light" : "dark";
}
