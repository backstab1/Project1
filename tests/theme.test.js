import test from "node:test";
import assert from "node:assert/strict";

import {
  applyTheme,
  getInitialTheme,
  saveTheme,
  THEME_STORAGE_KEY,
  toggleTheme,
} from "../src/ui/theme.js";

test("сохранённая тема имеет приоритет над системной", () => {
  const storage = { getItem: () => "light" };
  assert.equal(getInitialTheme({ storage, prefersDark: true }), "light");
});

test("системная тема используется при первом запуске", () => {
  const storage = { getItem: () => null };
  assert.equal(getInitialTheme({ storage, prefersDark: true }), "dark");
  assert.equal(getInitialTheme({ storage, prefersDark: false }), "light");
});

test("тема применяется и сохраняется безопасно", () => {
  const documentElement = { dataset: {}, style: {} };
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value) };

  assert.equal(applyTheme("dark", documentElement), "dark");
  assert.equal(documentElement.dataset.theme, "dark");
  assert.equal(saveTheme("dark", storage), "dark");
  assert.equal(values.get(THEME_STORAGE_KEY), "dark");
  assert.equal(toggleTheme("dark"), "light");
});
