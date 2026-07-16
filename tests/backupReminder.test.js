import test from "node:test";
import assert from "node:assert/strict";

import {
  createReminderDismissalDate,
  isBackupReminderDue,
} from "../src/domain/backupReminder.js";

const NOW = Date.parse("2026-07-16T12:00:00.000Z");

test("пустая библиотека не показывает напоминание", () => {
  assert.equal(isBackupReminderDue({ movieCount: 0, now: NOW }), false);
});

test("библиотека без резервной копии показывает напоминание", () => {
  assert.equal(isBackupReminderDue({ movieCount: 10, now: NOW }), true);
});

test("отложенное напоминание не показывается раньше срока", () => {
  const dismissedUntil = createReminderDismissalDate(30, NOW);
  assert.equal(
    isBackupReminderDue({
      movieCount: 10,
      dismissedUntil,
      now: NOW + 10 * 24 * 60 * 60 * 1000,
    }),
    false,
  );
});

