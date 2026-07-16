import { STORE_NAMES } from "../src/config.js";
import { initializeDatabase, openDatabase } from "../src/data/database.js";
import {
  createCategory,
  createFranchise,
  createMovie,
  createParticipant,
} from "../src/domain/entities.js";

const watchedAt = "2026-07-12T19:30:00.000Z";
const categories = [
  createCategory({ id: "qa-world", name: "Мировое кино", position: 0, rollQuota: 5 }),
  createCategory({ id: "qa-europe", name: "Европейское кино", parentId: "qa-world", position: 0, rollQuota: 3 }),
  createCategory({ id: "qa-scandinavia", name: "Скандинавские драмы и триллеры", parentId: "qa-europe", position: 0, rollQuota: 2 }),
  createCategory({ id: "qa-fantasy", name: "Фантастика и фэнтези", position: 1, rollQuota: 4 }),
  createCategory({ id: "qa-classics", name: "Классика XX века", position: 2, rollQuota: 2 }),
];

const movies = [
  createMovie({ id: "qa-lotr-1", title: "Властелин колец: Братство Кольца", originalTitle: "The Fellowship of the Ring", categoryId: "qa-fantasy", categoryPosition: 0, releaseYear: 2001, durationMinutes: 178, country: "Новая Зеландия" }),
  createMovie({ id: "qa-lotr-2", title: "Властелин колец: Две крепости", categoryId: "qa-fantasy", categoryPosition: 1, releaseYear: 2002, durationMinutes: 179, country: "Новая Зеландия" }),
  createMovie({ id: "qa-lotr-3", title: "Властелин колец: Возвращение короля", categoryId: "qa-fantasy", categoryPosition: 2, releaseYear: 2003, durationMinutes: 201, country: "Новая Зеландия" }),
  createMovie({ id: "qa-long", title: "Невероятная история о человеке, который отправился смотреть кино и случайно изменил весь мир", categoryId: "qa-world", categoryPosition: 0, releaseYear: 2024, durationMinutes: 147, country: "Россия", coverUrl: "https://invalid.example.test/poster.jpg" }),
  createMovie({ id: "qa-hunt", title: "Охота", originalTitle: "Jagten", categoryId: "qa-scandinavia", categoryPosition: 0, releaseYear: 2012, durationMinutes: 115, country: "Дания", watchedAt, ratings: [{ participantName: "Антон", value: 9.5 }, { participantName: "Мария", value: 9 }] }),
  createMovie({ id: "qa-another-round", title: "Ещё по одной", categoryId: "qa-scandinavia", categoryPosition: 1, releaseYear: 2020, durationMinutes: 117, country: "Дания", watchedAt, ratings: [{ participantName: "Антон", value: 8.5 }, { participantName: "Мария", value: 8 }] }),
  createMovie({ id: "qa-seventh-seal", title: "Седьмая печать", categoryId: "qa-classics", categoryPosition: 0, releaseYear: 1957, durationMinutes: 96, country: "Швеция", watchedAt, ratings: [{ participantName: "Антон", value: 8 }, { participantName: "Мария", value: 7.5 }] }),
  createMovie({ id: "qa-stalker", title: "Сталкер", categoryId: "qa-classics", categoryPosition: 1, releaseYear: 1979, durationMinutes: 163, country: "СССР" }),
  createMovie({ id: "qa-arrival", title: "Прибытие", categoryId: "qa-fantasy", categoryPosition: 3, releaseYear: 2016, durationMinutes: 116, country: "США" }),
  createMovie({ id: "qa-spirited", title: "Унесённые призраками", categoryId: "qa-world", categoryPosition: 1, releaseYear: 2001, durationMinutes: 125, country: "Япония" }),
];

const franchises = [
  createFranchise({
    id: "qa-lotr",
    name: "Средиземье — полная кинотрилогия",
    categoryId: "qa-fantasy",
    categoryPosition: 0,
    movieIds: ["qa-lotr-1", "qa-lotr-2", "qa-lotr-3"],
  }),
];

const participants = [
  createParticipant({ id: "qa-anton", name: "Антон" }),
  createParticipant({ id: "qa-maria", name: "Мария" }),
];

await initializeDatabase();
const database = await openDatabase();
const stores = [
  STORE_NAMES.categories,
  STORE_NAMES.movies,
  STORE_NAMES.franchises,
  STORE_NAMES.participants,
  STORE_NAMES.rollSessions,
];
const transaction = database.transaction(stores, "readwrite");
for (const storeName of stores) transaction.objectStore(storeName).clear();
for (const category of categories) transaction.objectStore(STORE_NAMES.categories).put(category);
for (const movie of movies) transaction.objectStore(STORE_NAMES.movies).put(movie);
for (const franchise of franchises) transaction.objectStore(STORE_NAMES.franchises).put(franchise);
for (const participant of participants) transaction.objectStore(STORE_NAMES.participants).put(participant);

await new Promise((resolve, reject) => {
  transaction.oncomplete = resolve;
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error);
});

document.querySelector("#status").textContent = "Готово. Открываем CineVault…";
location.replace("/#dashboard");
