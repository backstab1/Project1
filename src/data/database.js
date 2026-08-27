// Локальная база браузера. После перехода на сервер в ней не остаётся записей
// библиотеки: только отметка о версии схемы и снимок последней загрузки,
// который показывается на старте и при обрыве связи.
//
// Хранилища прежней локальной версии здесь больше не создаются, но и не
// удаляются: у того, кто открывал старую сборку, они остаются в браузере со
// своими данными. Стирать их приложение не вправе — это данные человека,
// пусть и не нужные ему больше.

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_NAMES,
} from "../config.js";

let databasePromise;

export function openDatabase() {
  if (!("indexedDB" in globalThis)) {
    return Promise.reject(
      new Error("Этот браузер не поддерживает IndexedDB."),
    );
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        applySchema(request.result, request.transaction);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        reject(new Error("Обновление базы заблокировано другой вкладкой."));
      };
    });
  }

  return databasePromise;
}

export async function initializeDatabase() {
  const database = await openDatabase();
  await putRecord(STORE_NAMES.meta, {
    key: "schemaVersion",
    value: DATABASE_VERSION,
  });
  return database;
}

export async function getRecord(storeName, key) {
  const database = await openDatabase();
  return requestToPromise(
    database.transaction(storeName, "readonly").objectStore(storeName).get(key),
  );
}

export async function putRecord(storeName, value) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(value);
  await transactionToPromise(transaction);
  return value;
}

export async function deleteRecord(storeName, key) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).delete(key);
  await transactionToPromise(transaction);
}

function applySchema(database, transaction) {
  createStore(database, transaction, STORE_NAMES.meta, { keyPath: "key" });
  // Снимок серверной библиотеки одной записью на аккаунт: читается один раз
  // при старте, поэтому индексы ему не нужны.
  createStore(database, transaction, STORE_NAMES.snapshots, {
    keyPath: "ownerId",
  });
}

function createStore(database, transaction, name, options) {
  return database.objectStoreNames.contains(name)
    ? transaction.objectStore(name)
    : database.createObjectStore(name, options);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
