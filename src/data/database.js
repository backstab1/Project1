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

export async function applyBatch(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return;
  }

  const database = await openDatabase();
  const storeNames = [...new Set(commands.map((command) => command.storeName))];
  const transaction = database.transaction(storeNames, "readwrite");

  for (const command of commands) {
    const store = transaction.objectStore(command.storeName);
    if (command.type === "put") {
      store.put(command.value);
    } else if (command.type === "delete") {
      store.delete(command.key);
    } else {
      transaction.abort();
      throw new TypeError(`Неизвестная пакетная операция: ${command.type}`);
    }
  }

  await transactionToPromise(transaction);
}

async function ensureRecord(storeName, value) {
  const current = await getRecord(storeName, value.key);
  if (!current) {
    await putRecord(storeName, value);
  }
}

function applySchema(database, transaction) {
  createStore(database, transaction, STORE_NAMES.meta, { keyPath: "key" });
  createStore(database, transaction, STORE_NAMES.settings, { keyPath: "key" });

  const categories = createStore(database, transaction, STORE_NAMES.categories, {
    keyPath: "id",
  });
  createIndex(categories, "parentId", "parentId");
  createIndex(categories, "position", "position");
  createIndex(categories, "normalizedName", "normalizedName");

  const movies = createStore(database, transaction, STORE_NAMES.movies, {
    keyPath: "id",
  });
  createIndex(movies, "categoryId", "categoryId");
  createIndex(movies, "categoryPosition", "categoryPosition");
  createIndex(movies, "normalizedTitle", "normalizedTitle");
  createIndex(movies, "tmdbId", "tmdbId");
  createIndex(movies, "watchedAt", "watchedAt");

  const franchises = createStore(database, transaction, STORE_NAMES.franchises, {
    keyPath: "id",
  });
  createIndex(franchises, "categoryId", "categoryId");
  createIndex(franchises, "normalizedName", "normalizedName", { unique: true });

  const participants = createStore(database, transaction, STORE_NAMES.participants, {
    keyPath: "id",
  });
  createIndex(participants, "normalizedName", "normalizedName", {
    unique: true,
  });
  createIndex(participants, "lastUsedAt", "lastUsedAt");

  const sessions = createStore(database, transaction, STORE_NAMES.rollSessions, {
    keyPath: "id",
  });
  createIndex(sessions, "createdAt", "createdAt");
  createIndex(sessions, "status", "status");
}

function createStore(database, transaction, name, options) {
  return database.objectStoreNames.contains(name)
    ? transaction.objectStore(name)
    : database.createObjectStore(name, options);
}

function createIndex(store, name, keyPath, options) {
  if (!store) {
    return;
  }

  if (store.indexNames.contains(name)) {
    const existing = store.index(name);
    const requestedUnique = Boolean(options?.unique);
    if (
      String(existing.keyPath) === String(keyPath) &&
      existing.unique === requestedUnique
    ) {
      return;
    }
    store.deleteIndex(name);
  }

  store.createIndex(name, keyPath, options);
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
