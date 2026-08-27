// Восстановление базы CineVault из копии, снятой scripts/backup-db.mjs.
//
// Запуск: npm run restore -- <файл копии> [--force]
// Требуются переменные окружения из .env.local (см. .env.example).
//
// Копия, которую ни разу не восстанавливали, копией не считается — поэтому
// восстановление написано сразу, а не «когда понадобится».
//
// Порядок восстановления проекта с нуля:
//   1. создать проект Supabase и накатить миграции (supabase db push);
//   2. выложить Edge Functions и задать секреты;
//   3. запустить этот скрипт с последней копией.
//
// Про аккаунты. Паролей в копии нет и быть не может: их не отдаёт никакое API.
// Скрипт заводит аккаунты заново по почте и, если API это позволяет, с прежним
// идентификатором. Если прежний идентификатор занять не удалось, все ссылки на
// пользователя переписываются на новый — поэтому библиотека остаётся связной в
// любом случае. Пароль каждый задаёт заново по ссылке «забыли пароль».

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Не заданы SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

const args = process.argv.slice(2);
const file = args.find((value) => !value.startsWith("--"));
const force = args.includes("--force");

if (!file) {
  console.error("Укажите файл копии: npm run restore -- <файл> [--force]");
  process.exit(2);
}

// Столбцы, ведущие в auth.users: их значения переписываются по карте аккаунтов.
const USER_COLUMNS = new Set([
  "id", // только в profiles — там это и есть идентификатор пользователя
  "user_id",
  "owner_id",
  "host_id",
  "actor_id",
  "added_by",
  "created_by",
  "used_by",
  "rater_user_id",
  "requester_id",
  "addressee_id",
]);

// В profiles идентификатор пользователя лежит в `id`; в остальных таблицах
// `id` — свой ключ строки, переписывать его нельзя.
const ID_IS_USER = new Set(["profiles"]);

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

function password() {
  return `restored-${crypto.randomUUID()}`;
}

async function existingUsers() {
  const byEmail = new Map();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`список аккаунтов: ${error.message}`);
    const users = data?.users ?? [];
    for (const user of users) {
      if (user.email) byEmail.set(user.email.toLowerCase(), user.id);
    }
    if (users.length < 200) break;
  }
  return byEmail;
}

async function restoreAccounts(accounts) {
  const known = await existingUsers();
  const map = new Map();
  let created = 0;
  let reused = 0;

  for (const account of accounts) {
    const email = String(account.email ?? "").toLowerCase();
    if (!email) continue;

    const already = known.get(email);
    if (already) {
      map.set(account.id, already);
      reused += 1;
      continue;
    }

    // Сначала пробуем сохранить прежний идентификатор: тогда переписывать
    // ссылки не придётся вовсе. Не все версии API это позволяют.
    let { data, error } = await admin.auth.admin.createUser({
      id: account.id,
      email,
      password: password(),
      email_confirm: Boolean(account.email_confirmed_at),
    });
    if (error) {
      ({ data, error } = await admin.auth.admin.createUser({
        email,
        password: password(),
        email_confirm: Boolean(account.email_confirmed_at),
      }));
    }
    if (error) throw new Error(`аккаунт ${email}: ${error.message}`);

    map.set(account.id, data.user.id);
    created += 1;
  }

  return { map, created, reused };
}

function remap(table, rows, map) {
  return rows.map((row) => {
    const copy = { ...row };
    for (const [column, value] of Object.entries(copy)) {
      if (typeof value !== "string") continue;
      if (column === "id" && !ID_IS_USER.has(table)) continue;
      if (!USER_COLUMNS.has(column)) continue;
      if (map.has(value)) copy[column] = map.get(value);
    }
    return copy;
  });
}

// Столбцы, которые база выдаёт сама и не принимает снаружи. Порядок событий
// сессии при этом сохраняется: строки вставляются в том же порядке, в каком
// лежат в копии, и новые номера идут по возрастанию.
const GENERATED = { roll_events: ["seq"] };

async function insertRows(table, rows) {
  const drop = GENERATED[table] ?? [];
  const prepared = drop.length
    ? rows.map((row) => {
        const copy = { ...row };
        for (const column of drop) delete copy[column];
        return copy;
      })
    : rows;

  const CHUNK = 200;
  for (let from = 0; from < prepared.length; from += CHUNK) {
    const chunk = prepared.slice(from, from + CHUNK);
    // Обычная вставка, а не upsert: восстановление идёт в пустую базу, и
    // столкновение с существующей строкой — повод остановиться и разобраться,
    // а не молча слить две версии данных.
    const { error } = await admin.from(table).insert(chunk);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function main() {
  const dump = JSON.parse(await readFile(file, "utf8"));
  if (dump.format !== "cinevault-db-backup") {
    throw new Error("Файл не является копией базы CineVault.");
  }

  console.log(`Копия от ${dump.createdAt}, проект ${dump.project}`);
  if (dump.project !== url) {
    console.log(`Внимание: копия снята с другого проекта, восстанавливаем в ${url}.`);
  }

  const { count, error: countError } = await admin
    .from("movies")
    .select("id", { count: "exact", head: true });
  if (countError) throw new Error(`проверка целевой базы: ${countError.message}`);
  if (count && !force) {
    throw new Error(
      `В целевой базе уже есть фильмы (${count}). Восстановление поверх живых ` +
        "данных делает не сверку, а месиво. Повторите с --force, если это осознанно.",
    );
  }

  const accounts = await restoreAccounts(dump.accounts ?? []);
  console.log(`Аккаунты: создано ${accounts.created}, уже были ${accounts.reused}`);

  for (const [table, rows] of Object.entries(dump.tables ?? {})) {
    if (!rows.length) continue;
    await insertRows(table, remap(table, rows, accounts.map));
    console.log(`  ${table}: ${rows.length}`);
  }

  console.log("\nГотово. Пароли не восстанавливаются: каждый задаёт свой заново");
  console.log("по ссылке «Забыли пароль» — в копии паролей нет и быть не может.");
}

main().catch((error) => {
  console.error(`Восстановление прервано: ${error.message}`);
  process.exit(1);
});
