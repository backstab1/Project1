// Проверка резервного копирования: снять копию, потерять данные, вернуть.
//
// Запуск: npm run check:backup
// Требуются переменные окружения из .env.local (см. .env.example).
// Скрипт создаёт временного пользователя и удаляет его за собой — запускать
// только на dev-проекте.
//
// Проверяется не «файл создался», а то единственное, ради чего копия нужна:
// после потери данных они возвращаются со всеми связями. Чужие строки при
// этом не трогаются — копия для восстановления урезается до одного аккаунта.

import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

function run(script, args = [], env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--env-file=.env.local", script, ...args],
      { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { out += chunk; });
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${script} завершился с кодом ${code}:\n${out}`));
    });
  });
}

async function createUser(handle) {
  const email = `backup-${handle}-${stamp()}@cinevault.test`;
  const password = `pwd-${stamp()}-${stamp()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) throw new Error(`создание пользователя: ${error.message}`);

  const code = `B${stamp().toUpperCase().padEnd(7, "X").slice(0, 7)}`;
  const invite = await admin.from("invites").insert({ code }).select().single();
  if (invite.error) throw new Error(`приглашение: ${invite.error.message}`);

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`вход: ${signIn.error.message}`);

  const profile = await client.rpc("redeem_invite", {
    p_code: code, p_handle: handle, p_display_name: handle,
  });
  if (profile.error) throw new Error(`redeem_invite: ${profile.error.message}`);

  return { id: data.user.id, email, client };
}

// Копия снимается со всего проекта, но возвращать чужое мы не станем: для
// восстановления остаётся только то, что принадлежит временному аккаунту.
function narrowToUser(dump, userId) {
  const mine = (row) =>
    Object.entries(row).some(([column, value]) =>
      value === userId &&
      ["id", "user_id", "owner_id", "host_id", "actor_id", "added_by",
        "created_by", "used_by", "rater_user_id", "requester_id",
        "addressee_id"].includes(column));

  const tables = {};
  for (const [table, rows] of Object.entries(dump.tables ?? {})) {
    // Приглашение переживает удаление аккаунта: `used_by` обнуляется, а строка
    // остаётся у проекта. В библиотеку пользователя она не входит, и вставлять
    // её заново — гарантированное столкновение по ключу.
    if (table === "invites") continue;
    const kept = rows.filter(mine);
    if (kept.length) tables[table] = kept;
  }

  return {
    ...dump,
    accounts: (dump.accounts ?? []).filter((account) => account.id === userId),
    tables,
  };
}

async function main() {
  const user = await createUser(`probe${stamp()}`);
  const directory = await mkdtemp(path.join(tmpdir(), "cinevault-backup-"));
  let restoredId = null;

  try {
    const categoryId = crypto.randomUUID();
    const movieId = crypto.randomUUID();
    const now = new Date().toISOString();

    const seeded = await user.client.rpc("apply_library_changes", {
      commands: [
        {
          table: "categories", op: "put",
          row: {
            id: categoryId, owner_id: user.id, name: "Копия", normalized_name: "копия",
            sort_order: 0, roll_quota: 3, created_at: now, updated_at: now,
          },
        },
        {
          table: "movies", op: "put",
          row: {
            id: movieId, owner_id: user.id, category_id: categoryId,
            title: "Сталкер", normalized_title: "сталкер", status: "watched",
            watched_at: now, release_year: 1979, duration_minutes: 163,
            country: "СССР", created_at: now, updated_at: now,
          },
          ratings: [{
            id: crypto.randomUUID(), movie_id: movieId, owner_id: user.id,
            rater_user_id: user.id, rater_name: "Проверка",
            normalized_rater_name: "проверка", value: 9.5, created_at: now,
          }],
        },
      ],
      expected_revision: null,
    });
    check("данные для копии записаны", !seeded.error, seeded.error?.message);

    await run("scripts/backup-db.mjs", [], { BACKUP_DIR: directory });
    const files = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    check("копия снята в файл", files.length === 1, `файлов: ${files.length}`);

    const dump = JSON.parse(await readFile(path.join(directory, files.at(-1)), "utf8"));
    const mine = narrowToUser(dump, user.id);
    check(
      "в копии есть строки этого аккаунта",
      mine.tables.movies?.length === 1 &&
        mine.tables.categories?.length === 1 &&
        mine.tables.ratings?.length === 1 &&
        mine.accounts.length === 1,
      JSON.stringify(Object.fromEntries(
        Object.entries(mine.tables).map(([table, rows]) => [table, rows.length]),
      )),
    );

    const narrowed = path.join(directory, "narrowed.json");
    await writeFile(narrowed, JSON.stringify(mine), "utf8");

    // Потеря: удаление аккаунта уносит все его строки по каскаду.
    await admin.auth.admin.deleteUser(user.id);
    const gone = await admin.from("movies").select("id").eq("id", movieId).maybeSingle();
    check("данные потеряны вместе с аккаунтом", !gone.data, "строка уцелела");

    const output = await run("scripts/restore-db.mjs", [narrowed, "--force"]);
    check("восстановление отработало", output.includes("Готово"), output.slice(-200));

    const back = await admin
      .from("movies")
      .select("id, title, owner_id, category_id, status, watched_at, duration_minutes")
      .eq("id", movieId)
      .maybeSingle();
    check(
      "фильм вернулся целиком",
      back.data?.title === "Сталкер" &&
        back.data?.status === "watched" &&
        back.data?.duration_minutes === 163,
      JSON.stringify(back.data),
    );

    const owner = back.data?.owner_id;
    restoredId = owner;
    const account = owner ? await admin.auth.admin.getUserById(owner) : null;
    check(
      "владелец восстановлен и совпадает с прежней почтой",
      account?.data?.user?.email === user.email,
      `почта владельца: ${account?.data?.user?.email ?? "нет"}`,
    );

    const category = await admin
      .from("categories").select("id, name, roll_quota, owner_id")
      .eq("id", categoryId).maybeSingle();
    check(
      "список и его квота вернулись, фильм остался в нём",
      category.data?.name === "Копия" &&
        category.data?.roll_quota === 3 &&
        back.data?.category_id === categoryId &&
        category.data?.owner_id === owner,
      JSON.stringify(category.data),
    );

    const rating = await admin
      .from("ratings").select("value, rater_user_id, rater_name")
      .eq("movie_id", movieId).maybeSingle();
    check(
      "оценка вернулась и указывает на того же зрителя",
      Number(rating.data?.value) === 9.5 && rating.data?.rater_user_id === owner,
      JSON.stringify(rating.data),
    );
  } finally {
    if (restoredId) await admin.auth.admin.deleteUser(restoredId).catch(() => {});
    await admin.auth.admin.deleteUser(user.id).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }

  console.log(`\nПроверок: ${total}, провалено: ${failures}.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nПроверка прервана: ${error.message}`);
  process.exit(2);
});
