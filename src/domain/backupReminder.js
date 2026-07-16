export function isBackupReminderDue({
  movieCount,
  lastBackupAt,
  dismissedUntil,
  reminderDays = 30,
  now = Date.now(),
}) {
  if (movieCount <= 0) return false;

  const dismissedTimestamp = Date.parse(dismissedUntil ?? "");
  if (
    Number.isFinite(dismissedTimestamp) &&
    dismissedTimestamp > Number(now)
  ) {
    return false;
  }

  const backupTimestamp = Date.parse(lastBackupAt ?? "");
  if (!Number.isFinite(backupTimestamp)) return true;
  return (
    Number(now) - backupTimestamp >=
    Math.max(1, reminderDays) * 24 * 60 * 60 * 1000
  );
}

export function createReminderDismissalDate(
  reminderDays = 30,
  now = Date.now(),
) {
  return new Date(
    Number(now) + Math.max(1, reminderDays) * 24 * 60 * 60 * 1000,
  ).toISOString();
}

