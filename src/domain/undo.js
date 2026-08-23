import { STORE_NAMES } from "../config.js";

const STORE_TO_COLLECTION = Object.freeze({
  [STORE_NAMES.movies]: "movies",
  [STORE_NAMES.categories]: "categories",
  [STORE_NAMES.franchises]: "franchises",
  [STORE_NAMES.participants]: "participants",
  [STORE_NAMES.rollSessions]: "rollSessions",
});

// Удаление в CineVault всегда описывается списком команд к базе. Значит,
// отменить его можно, не зная подробностей операции: достаточно снять слепок
// затронутых записей до применения и построить обратный список.
export function buildUndoCommands(library, commands) {
  const undo = [];

  for (const command of commands ?? []) {
    const collection = STORE_TO_COLLECTION[command.storeName];
    if (!collection) continue;
    const records = library?.[collection] ?? [];

    if (command.type === "delete") {
      const previous = records.find((record) => record.id === command.key);
      if (previous) {
        undo.push({ type: "put", storeName: command.storeName, value: { ...previous } });
      }
      continue;
    }

    if (command.type === "put") {
      const previous = records.find((record) => record.id === command.value?.id);
      undo.push(previous
        ? { type: "put", storeName: command.storeName, value: { ...previous } }
        // Записи не было — значит, отмена должна её убрать.
        : { type: "delete", storeName: command.storeName, key: command.value?.id });
    }
  }

  // Обратный порядок: сначала возвращаем то, что удалили последним.
  return undo.reverse();
}

export function describeDeletion(count, forms = ["фильм", "фильма", "фильмов"]) {
  const value = Math.abs(count) % 100;
  const remainder = value % 10;
  if (value > 10 && value < 20) return `${count} ${forms[2]}`;
  if (remainder > 1 && remainder < 5) return `${count} ${forms[1]}`;
  if (remainder === 1) return `${count} ${forms[0]}`;
  return `${count} ${forms[2]}`;
}
