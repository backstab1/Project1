// Резервная копия базы CineVault.
//
// Запуск: npm run backup
// Требуются переменные окружения из .env.local (см. .env.example).
//
// Почему не `supabase db dump`: он поднимает pg_dump в Docker, а Docker и
// клиент Postgres на машине заказчика не установлены. Поэтому копия снимается
// через служебный ключ по тому же API, которым пользуется приложение.
//
// Что копия покрывает: все таблицы приложения целиком, включая чужие строки
// (служебный ключ ходит в обход политик), плюс список аккаунтов — почта и
// идентификатор.
//
// Чего копия НЕ покрывает и о чём нужно помнить:
//   * пароли пользователей — их не отдаёт никакое API, при восстановлении
//     каждому придётся задать пароль заново по ссылке из письма;
//   * схему базы — она лежит в supabase/migrations и восстанавливается
//     накатом миграций, а не отсюда;
//   * секреты Edge Functions и настройки проекта.
//
// Иначе говоря, это страховка содержимого, а не снимок проекта целиком.
// Библиотека после аварии восстановима, но проект придётся собрать заново:
// миграции, функции, секреты, потом эта копия.

import { createClient } from "@supabase/supabase-js";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Не заданы SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

// Порядок важен: при восстановлении строки вставляются сверху вниз, поэтому
// таблица идёт после той, на которую ссылается.
const TABLES = [
  "profiles",
  "invites",
  "user_settings",
  "categories",
  "movies",
  "franchises",
  "franchise_movies",
  "participants",
  "ratings",
  "friendships",
  "shared_lists",
  "shared_list_members",
  "shared_list_items",
  "roll_sessions",
  "roll_session_members",
  "roll_events",
];

// tmdb_usage намеренно не копируется: это счётчик за сутки, он обнуляется сам
// и после восстановления не значит ничего.

const PAGE = 1000;
const KEEP = Number(process.env.BACKUP_KEEP ?? "14");
const directory = process.env.BACKUP_DIR
  ?? path.join(process.env.LOCALAPPDATA ?? homedir(), "CineVault", "db-backups");

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function dumpTable(table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// Пароли не выгружаются нигде и никогда: их нет даже у нас. Из аккаунта берём
// то, по чему человека можно узнать и завести заново.
async function dumpAccounts() {
  const accounts = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`аккаунты: ${error.message}`);
    const users = data?.users ?? [];
    accounts.push(...users.map((user) => ({
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
      email_confirmed_at: user.email_confirmed_at,
    })));
    if (users.length < 200) break;
  }
  return accounts;
}

async function prune() {
  const files = (await readdir(directory))
    .filter((name) => /^cinevault-db-.*\.json$/.test(name))
    .sort();
  const extra = files.slice(0, Math.max(0, files.length - KEEP));
  for (const name of extra) {
    await unlink(path.join(directory, name));
  }
  return extra.length;
}

async function main() {
  const started = Date.now();
  const dump = {
    format: "cinevault-db-backup",
    version: 1,
    project: url,
    createdAt: new Date().toISOString(),
    accounts: await dumpAccounts(),
    tables: {},
  };

  for (const table of TABLES) {
    dump.tables[table] = await dumpTable(table);
  }

  await mkdir(directory, { recursive: true });
  const stamp = dump.createdAt.slice(0, 16).replace("T", "_").replace(":", "-");
  const file = path.join(directory, `cinevault-db-${stamp}.json`);
  const body = JSON.stringify(dump);
  await writeFile(file, body, "utf8");
  const removed = await prune();

  console.log(`Копия: ${file}`);
  console.log(`Размер: ${Math.max(1, Math.round(body.length / 1024))} КБ, ` +
    `за ${((Date.now() - started) / 1000).toFixed(1)} с`);
  console.log(`Аккаунтов: ${dump.accounts.length}`);
  for (const table of TABLES) {
    const count = dump.tables[table].length;
    if (count) console.log(`  ${table}: ${count}`);
  }
  if (removed) console.log(`Удалено старых копий: ${removed} (храним ${KEEP}).`);
}

main().catch((error) => {
  console.error(`Копия не снята: ${error.message}`);
  process.exit(1);
});
