// Копия на диск лежит рядом с данными приложения и переживает очистку
// браузерного профиля — в отличие от самой библиотеки в IndexedDB.
export async function saveLocalBackup(backup) {
  return requestJson("/api/backup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backup),
  });
}

export function getLocalBackupStatus() {
  return requestJson("/api/backup/status");
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error("Служба CineVault недоступна.");
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Ошибка ниже остаётся понятной даже при повреждённом ответе.
  }
  if (!response.ok) {
    throw new Error(payload.error || `Сервис вернул ошибку ${response.status}.`);
  }
  return payload;
}
