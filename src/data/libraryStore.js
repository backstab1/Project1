// Единственная точка, через которую приложение обращается к библиотеке.
//
// Библиотека принадлежит аккаунту и живёт в Postgres: локального хранилища
// записей в приложении больше нет. В браузере остаётся только снимок
// последней загрузки — он нужен, чтобы библиотека появлялась мгновенно и не
// исчезала при обрыве связи. Снимок доступен на чтение: любая запись идёт на
// сервер, а не в него.

import { STORE_NAMES } from "../config.js";
import { deleteRecord, getRecord, putRecord } from "./database.js";
import * as server from "./libraryGateway.js";

export {
  LibraryConflictError,
  getLibraryRevision,
  isLibraryConflict,
  saveCategory,
  saveFranchise,
  saveMovie,
  saveParticipant,
  saveRollSession,
  saveSetting,
  deleteMovieRecord,
  deleteCategoryRecord,
  deleteFranchiseRecord,
  deleteParticipantRecord,
  commitLibraryChanges,
} from "./libraryGateway.js";

export async function loadLibrary() {
  const library = await server.loadLibrary();
  await writeSnapshot(library);
  return library;
}

// Мгновенный старт: снимок прошлой загрузки показывается, пока идёт запрос к
// серверу. Он же остаётся на экране, если связи нет.
export async function loadCachedLibrary() {
  try {
    const ownerId = await server.getOwnerId();
    const record = await getRecord(STORE_NAMES.snapshots, ownerId);
    return record?.library ?? null;
  } catch {
    return null;
  }
}

// Выход из аккаунта: снимок стирается вместе с сессией. За чужим компьютером
// библиотека не должна оставаться лежать в браузере после выхода, а свой
// следующий вход соберёт её заново.
export async function resetLibraryStore() {
  try {
    const ownerId = await server.getOwnerId();
    await deleteRecord(STORE_NAMES.snapshots, ownerId);
  } catch {
    // Сессии уже нет или браузер отказал в доступе — удалять нечего.
  }
  server.forgetOwner();
}

async function writeSnapshot(library) {
  try {
    const ownerId = await server.getOwnerId();
    await putRecord(STORE_NAMES.snapshots, {
      ownerId,
      savedAt: new Date().toISOString(),
      library,
    });
  } catch (error) {
    // Кэш — удобство, а не хранилище: браузер мог отказать в записи, и это
    // не повод рушить уже загруженную библиотеку.
    console.warn("Снимок библиотеки не сохранён:", error);
  }
}
