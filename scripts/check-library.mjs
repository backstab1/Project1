// Проверка серверного хранилища библиотеки на живом проекте (этап 16).
//
// Запуск: npm run check:library
// Требуются переменные окружения из .env.local (см. .env.example).
// Скрипт создаёт временных пользователей и удаляет их за собой — запускать
// только на dev-проекте.
//
// Проверяется то, на чём держится библиотека в аккаунте: пакет изменений
// применяется одной транзакцией, запись возвращается из базы такой же, какой
// ушла, пакет с устаревшей ревизией отвергается целиком, а чужие строки не
// видны и не удаляются.

import { createClient } from "@supabase/supabase-js";

import { STORE_NAMES } from "../src/config.js";
import {
  categoryFromRow,
  commandToPayload,
  franchiseFromRow,
  movieFromRow,
  participantFromRow,
} from "../src/data/rowMapping.js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !serviceKey || !anonKey) {
  console.error("Не заданы SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY и SUPABASE_ANON_KEY.");
  process.exit(2);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
let failures = 0;
let total = 0;

function check(name, passed, detail = "") {
  total += 1;
  if (!passed) failures += 1;
  console.log(`${passed ? "  ok  " : " FAIL "} ${name}${detail && !passed ? ` — ${detail}` : ""}`);
}

function stamp() {
  return Math.random().toString(36).slice(2, 8);
}

async function createUser(handle) {
  const email = `lib-${handle}-${stamp()}@cinevault.test`;
  const password = `pwd-${stamp()}-${stamp()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`создание пользователя: ${error.message}`);

  const code = `L${stamp().toUpperCase().padEnd(7, "X").slice(0, 7)}`;
  const invite = await admin.from("invites").insert({ code }).select().single();
  if (invite.error) throw new Error(`приглашение: ${invite.error.message}`);

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`вход: ${signIn.error.message}`);

  const profile = await client.rpc("redeem_invite", {
    p_code: code,
    p_handle: handle,
    p_display_name: handle,
  });
  if (profile.error) throw new Error(`redeem_invite: ${profile.error.message}`);

  return { id: data.user.id, client, handle };
}

// Библиотека в форме приложения: именно её собирает domain/entities.js, и
// именно так её увидит браузер после чтения из базы.
function referenceLibrary() {
  const now = new Date().toISOString();
  const id = () => crypto.randomUUID();
  const root = id();
  const child = id();
  const dune = id();
  const duneTwo = id();

  return {
    categories: [
      {
        id: root,
        name: "Фантастика",
        normalizedName: "фантастика",
        parentId: null,
        position: 0,
        rollQuota: 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: child,
        name: "Космос",
        normalizedName: "космос",
        parentId: root,
        position: 1,
        rollQuota: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
    movies: [
      {
        id: dune,
        title: "Дюна",
        normalizedTitle: "дюна",
        originalTitle: "Dune",
        categoryId: child,
        categoryPosition: 0,
        status: "watched",
        watchedAt: now,
        tmdbId: 438631,
        genres: ["Фантастика"],
        tags: ["вечер"],
        notes: "Пересмотреть перед второй частью.",
        isFavorite: true,
        releaseYear: 2021,
        durationMinutes: 155,
        country: "США",
        overview: "",
        coverUrl: "",
        ratings: [
          {
            id: id(),
            participantName: "Илья",
            normalizedParticipantName: "илья",
            value: 9,
            createdAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: duneTwo,
        title: "Дюна: Часть вторая",
        normalizedTitle: "дюна: часть вторая",
        originalTitle: "Dune: Part Two",
        categoryId: child,
        categoryPosition: 1,
        status: "queued",
        watchedAt: null,
        tmdbId: 693134,
        genres: ["Фантастика"],
        tags: [],
        notes: "",
        isFavorite: false,
        releaseYear: 2024,
        durationMinutes: 166,
        country: "США",
        overview: "",
        coverUrl: "",
        ratings: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: id(),
        title: "Солярис",
        normalizedTitle: "солярис",
        originalTitle: "",
        categoryId: root,
        categoryPosition: 0,
        status: "queued",
        watchedAt: null,
        tmdbId: null,
        genres: [],
        tags: [],
        notes: "",
        isFavorite: false,
        releaseYear: 1972,
        durationMinutes: 167,
        country: "СССР",
        overview: "",
        coverUrl: "",
        ratings: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    franchises: [
      {
        id: id(),
        name: "Дюна",
        normalizedName: "дюна",
        categoryId: child,
        categoryPosition: 2,
        // Порядок внутри франшизы значим: вторая часть идёт после первой.
        movieIds: [dune, duneTwo],
        createdAt: now,
        updatedAt: now,
      },
    ],
    participants: [
      {
        id: id(),
        name: "Илья",
        normalizedName: "илья",
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

// Пакет команд в том же виде, в каком его строит domain/libraryRules.js.
function librarySeedCommands(library, ownerId) {
  const put = (storeName, value) =>
    commandToPayload({ type: "put", storeName, value }, ownerId);

  return [
    ...library.categories.map((category) => put(STORE_NAMES.categories, category)),
    ...library.movies.map((movie) => put(STORE_NAMES.movies, movie)),
    ...library.franchises.map((franchise) => put(STORE_NAMES.franchises, franchise)),
    ...library.participants.map((participant) =>
      put(STORE_NAMES.participants, participant),
    ),
    put(STORE_NAMES.settings, { key: "savesEnabledAboveRemaining", value: 4 }),
  ];
}

// Обратная сборка библиотеки из строк — теми же переводчиками, что и в
// браузере. Если перекладка полей несимметрична, сверка это покажет.
async function readLibrary(client, ownerId) {
  const read = async (table, columns = "*") => {
    const { data, error } = await client.from(table).select(columns);
    if (error) throw new Error(`${table}: ${error.message}`);
    return data ?? [];
  };

  const [movies, categories, franchises, links, ratings, participants, settings] =
    await Promise.all([
      read("movies"),
      read("categories"),
      read("franchises"),
      read("franchise_movies", "movie_id, franchise_id, sort_order"),
      read("ratings"),
      read("participants"),
      client.from("user_settings").select("data, revision").maybeSingle(),
    ]);

  const ratingsByMovie = new Map();
  for (const rating of ratings.filter((row) => row.owner_id === ownerId)) {
    ratingsByMovie.set(rating.movie_id, [
      ...(ratingsByMovie.get(rating.movie_id) ?? []),
      rating,
    ]);
  }

  const moviesByFranchise = new Map();
  for (const link of [...links].sort((a, b) => a.sort_order - b.sort_order)) {
    moviesByFranchise.set(link.franchise_id, [
      ...(moviesByFranchise.get(link.franchise_id) ?? []),
      link.movie_id,
    ]);
  }

  return {
    movies: movies.map((row) => movieFromRow(row, ratingsByMovie.get(row.id) ?? [])),
    categories: categories.map(categoryFromRow),
    franchises: franchises.map((row) =>
      franchiseFromRow(row, moviesByFranchise.get(row.id) ?? []),
    ),
    participants: participants.map(participantFromRow),
    settings: settings.data?.data ?? {},
    revision: Number(settings.data?.revision ?? 0),
  };
}

function byTitle(movies, title) {
  return movies.find((movie) => movie.title === title);
}

async function main() {
  const suffix = stamp();
  const owner = await createUser(`owner${suffix}`);
  const stranger = await createUser(`other${suffix}`);

  try {
    const source = referenceLibrary();

    const seeded = await owner.client.rpc("apply_library_changes", {
      commands: librarySeedCommands(source, owner.id),
      expected_revision: null,
    });
    check("библиотека наполняется одним пакетом", !seeded.error, seeded.error?.message);
    check(
      "первый пакет поднял ревизию с нуля",
      Number(seeded.data) === 1,
      `ревизия: ${seeded.data}`,
    );

    const restored = await readLibrary(owner.client, owner.id);

    check(
      "фильмы вернулись полным составом",
      restored.movies.length === 3 && Boolean(byTitle(restored.movies, "Солярис")),
      `фильмов: ${restored.movies.length}`,
    );

    const dune = byTitle(restored.movies, "Дюна");
    check(
      "карточка фильма вернулась целиком",
      dune?.originalTitle === "Dune" &&
        dune?.tmdbId === 438631 &&
        dune?.status === "watched" &&
        dune?.isFavorite === true &&
        dune?.durationMinutes === 155 &&
        dune?.country === "США" &&
        dune?.tags?.[0] === "вечер" &&
        dune?.genres?.[0] === "Фантастика",
      JSON.stringify(dune),
    );

    check(
      "оценка зрителя на месте",
      dune?.ratings?.length === 1 &&
        dune.ratings[0].value === 9 &&
        dune.ratings[0].participantName === "Илья",
      JSON.stringify(dune?.ratings),
    );

    const child = restored.categories.find((item) => item.name === "Космос");
    const root = restored.categories.find((item) => item.name === "Фантастика");
    check(
      "вложенность списков сохранилась",
      child?.parentId === root?.id && root?.parentId === null,
      `родитель «Космоса»: ${child?.parentId}`,
    );
    check(
      "квота списка на месте",
      root?.rollQuota === 2 && child?.rollQuota === 1,
      `квоты: ${root?.rollQuota} и ${child?.rollQuota}`,
    );
    check(
      "фильм остался в своём списке",
      dune?.categoryId === child?.id,
      `список фильма: ${dune?.categoryId}`,
    );

    const franchise = restored.franchises[0];
    check(
      "порядок фильмов во франшизе сохранился",
      franchise?.movieIds?.length === 2 &&
        franchise.movieIds[0] === dune?.id &&
        franchise.movieIds[1] === byTitle(restored.movies, "Дюна: Часть вторая")?.id,
      JSON.stringify(franchise?.movieIds),
    );

    check(
      "настройка сохранилась вместе с записями",
      restored.settings.savesEnabledAboveRemaining === 4,
      JSON.stringify(restored.settings),
    );

    // Пакет изменений ---------------------------------------------------

    const revision = restored.revision;
    const solaris = byTitle(restored.movies, "Солярис");
    const batch = [
      commandToPayload(
        {
          type: "put",
          storeName: STORE_NAMES.movies,
          value: { ...solaris, title: "Солярис (1972)", normalizedTitle: "солярис (1972)" },
        },
        owner.id,
      ),
      commandToPayload(
        {
          type: "delete",
          storeName: STORE_NAMES.movies,
          key: byTitle(restored.movies, "Дюна: Часть вторая").id,
        },
        owner.id,
      ),
      commandToPayload(
        {
          type: "put",
          storeName: STORE_NAMES.settings,
          value: { key: "soundEnabled", value: false },
        },
        owner.id,
      ),
    ];

    const applied = await owner.client.rpc("apply_library_changes", {
      commands: batch,
      expected_revision: revision,
    });
    check("пакет изменений применяется", !applied.error, applied.error?.message);
    check(
      "ревизия выросла на единицу",
      Number(applied.data) === revision + 1,
      `было ${revision}, стало ${applied.data}`,
    );

    const afterBatch = await readLibrary(owner.client, owner.id);
    check(
      "переименование, удаление и настройка применились вместе",
      Boolean(byTitle(afterBatch.movies, "Солярис (1972)")) &&
        afterBatch.movies.length === 2 &&
        afterBatch.settings.soundEnabled === false,
      `фильмов: ${afterBatch.movies.length}, звук: ${afterBatch.settings.soundEnabled}`,
    );
    check(
      "удаление фильма забрало его связь с франшизой",
      afterBatch.franchises[0]?.movieIds?.length === 1,
      JSON.stringify(afterBatch.franchises[0]?.movieIds),
    );

    // Устаревшая ревизия ------------------------------------------------

    const stale = await owner.client.rpc("apply_library_changes", {
      commands: [
        commandToPayload(
          {
            type: "put",
            storeName: STORE_NAMES.movies,
            value: {
              ...solaris,
              id: crypto.randomUUID(),
              title: "Сталкер",
              normalizedTitle: "сталкер",
            },
          },
          owner.id,
        ),
      ],
      expected_revision: revision,
    });
    check(
      "пакет с устаревшей ревизией отвергается",
      stale.error?.code === "40001",
      `ответ: ${stale.error?.code ?? "без ошибки"}`,
    );

    const afterStale = await readLibrary(owner.client, owner.id);
    check(
      "отвергнутый пакет ничего не записал",
      !byTitle(afterStale.movies, "Сталкер"),
      "фильм всё-таки появился",
    );

    // Атомарность -------------------------------------------------------

    const broken = await owner.client.rpc("apply_library_changes", {
      commands: [
        commandToPayload(
          {
            type: "put",
            storeName: STORE_NAMES.movies,
            value: {
              ...solaris,
              id: crypto.randomUUID(),
              title: "Зеркало",
              normalizedTitle: "зеркало",
            },
          },
          owner.id,
        ),
        { table: "movies", op: "невозможная операция" },
      ],
      expected_revision: afterStale.revision,
    });
    check("сбойный пакет отвергается целиком", Boolean(broken.error), "пакет прошёл");

    const afterBroken = await readLibrary(owner.client, owner.id);
    check(
      "первая команда сбойного пакета откатилась",
      !byTitle(afterBroken.movies, "Зеркало") &&
        afterBroken.revision === afterStale.revision,
      `ревизия: ${afterBroken.revision}`,
    );

    // Чужая библиотека --------------------------------------------------

    const strangerView = await readLibrary(stranger.client, stranger.id);
    check(
      "чужая библиотека не видна постороннему",
      strangerView.movies.length === 0 && strangerView.categories.length === 0,
      `видно фильмов: ${strangerView.movies.length}`,
    );

    const strangerWrite = await stranger.client.rpc("apply_library_changes", {
      commands: [
        commandToPayload(
          { type: "delete", storeName: STORE_NAMES.movies, key: dune.id },
          stranger.id,
        ),
      ],
      expected_revision: null,
    });
    // Ошибки здесь может и не быть: политика просто не отдаёт чужую строку,
    // и удалять оказывается нечего. Значение имеет только то, что фильм цел.
    const survived = await readLibrary(owner.client, owner.id);
    check(
      "посторонний не удалит чужой фильм",
      Boolean(byTitle(survived.movies, "Дюна")),
      `ответ на чужое удаление: ${strangerWrite.error?.message ?? "без ошибки"}`,
    );
  } finally {
    await admin.auth.admin.deleteUser(owner.id).catch(() => {});
    await admin.auth.admin.deleteUser(stranger.id).catch(() => {});
  }

  console.log(`\nПроверок: ${total}, провалено: ${failures}.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nПроверка прервана: ${error.message}`);
  process.exit(2);
});
