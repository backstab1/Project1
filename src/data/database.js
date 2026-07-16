import {
  DATABASE_NAME,
  DATABASE_VERSION,
  DEFAULT_SETTINGS,
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
  await Promise.all([
    putRecord(STORE_NAMES.meta, {
      key: "schemaVersion",
      value: DATABASE_VERSION,
    }),
    ...Object.entries(DEFAULT_SETTINGS).map(([key, value]) =>
      ensureRecord(STORE_NAMES.settings, { key, value }),
    ),
  ]);
  return database;
}

export async function getRecord(storeName, key) {
  const database = await openDatabase();
  return requestToPromise(
    database.transaction(storeName, "readonly").objectStore(storeName).get(key),
  );
}

export async function getAllRecords(storeName) {
  const database = await openDatabase();
  return requestToPromise(
    database.transaction(storeName, "readonly").objectStore(storeName).getAll(),
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

export async function countRecords(storeName) {
  const database = await openDatabase();
  return requestToPromise(
    database.transaction(storeName, "readonly").objectStore(storeName).count(),
  );
}

async function ensureRecord(storeName, value) {
  const current = await getRecord(storeName, value.key);
  if (!current) {
    await putRecord(storeName, value);
  }
}

function applySchema(database) {
  createStore(database, STORE_NAMES.meta, { keyPath: "key" });
  createStore(database, STORE_NAMES.settings, { keyPath: "key" });

  const categories = createStore(database, STORE_NAMES.categories, {
    keyPath: "id",
  });
  createIndex(categories, "parentId", "parentId");
  createIndex(categories, "position", "position");
  createIndex(categories, "normalizedName", "normalizedName", { unique: true });

  const movies = createStore(database, STORE_NAMES.movies, { keyPath: "id" });
  createIndex(movies, "categoryId", "categoryId");
  createIndex(movies, "categoryPosition", "categoryPosition");
  createIndex(movies, "normalizedTitle", "normalizedTitle");
  createIndex(movies, "watchedAt", "watchedAt");

  const franchises = createStore(database, STORE_NAMES.franchises, {
    keyPath: "id",
  });
  createIndex(franchises, "categoryId", "categoryId");
  createIndex(franchises, "normalizedName", "normalizedName", { unique: true });

  const participants = createStore(database, STORE_NAMES.participants, {
    keyPath: "id",
  });
  createIndex(participants, "normalizedName", "normalizedName", {
    unique: true,
  });
  createIndex(participants, "lastUsedAt", "lastUsedAt");

  const sessions = createStore(database, STORE_NAMES.rollSessions, {
    keyPath: "id",
  });
  createIndex(sessions, "createdAt", "createdAt");
  createIndex(sessions, "status", "status");
}

function createStore(database, name, options) {
  return database.objectStoreNames.contains(name)
    ? null
    : database.createObjectStore(name, options);
}

function createIndex(store, name, keyPath, options) {
  if (store && !store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
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

