// Проверка политик доступа на живом проекте Supabase.
//
// Запуск: npm run check:rls
// Требуются переменные окружения из .env.local (см. .env.example).
// Скрипт создаёт двух временных пользователей, проверяет границы доступа и
// удаляет их за собой — запускать только на dev-проекте.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !serviceKey || !anonKey) {
  console.error(
    "Не заданы SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY и SUPABASE_ANON_KEY.",
  );
  process.exit(2);
}

if (/cinevault-prod/i.test(url)) {
  console.error("Скрипт не запускается на боевом проекте.");
  process.exit(2);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const results = [];
let failures = 0;

function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  const mark = passed ? "  ok  " : " FAIL ";
  console.log(`${mark} ${name}${detail && !passed ? ` — ${detail}` : ""}`);
}

function stamp() {
  return Math.random().toString(36).slice(2, 8);
}

async function createUser(handle) {
  const email = `rls-${handle}-${stamp()}@cinevault.test`;
  const password = `pwd-${stamp()}-${stamp()}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`Не удалось создать пользователя: ${error.message}`);

  const code = `T${stamp().toUpperCase().padEnd(7, "X").slice(0, 7)}`;
  const invite = await admin.from("invites").insert({ code }).select().single();
  if (invite.error) throw new Error(`Приглашение: ${invite.error.message}`);

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`Вход: ${signIn.error.message}`);

  const profile = await client.rpc("redeem_invite", {
    p_code: code,
    p_handle: handle,
    p_display_name: handle,
  });
  if (profile.error) throw new Error(`redeem_invite: ${profile.error.message}`);

  return { id: data.user.id, email, client, handle };
}

async function main() {
  const suffix = stamp();
  const alice = await createUser(`alice_${suffix}`);
  const bob = await createUser(`bob_${suffix}`);

  try {
    // Библиотека Алисы.
    const category = await alice.client
      .from("categories")
      .insert({
        owner_id: alice.id,
        name: "Вечер пятницы",
        normalized_name: "вечер пятницы",
        roll_quota: 3,
      })
      .select()
      .single();
    check("владелец создаёт список", !category.error, category.error?.message);

    const movie = await alice.client
      .from("movies")
      .insert({
        owner_id: alice.id,
        category_id: category.data?.id ?? null,
        title: "Дюна",
        normalized_title: "дюна",
      })
      .select()
      .single();
    check("владелец создаёт фильм", !movie.error, movie.error?.message);

    const movieId = movie.data?.id;

    // Границы до дружбы.
    const strangerRead = await bob.client
      .from("movies")
      .select("id")
      .eq("id", movieId);
    check(
      "чужая библиотека невидима без дружбы",
      !strangerRead.error && strangerRead.data.length === 0,
      `вернулось строк: ${strangerRead.data?.length}`,
    );

    const forgedInsert = await bob.client
      .from("movies")
      .insert({ owner_id: alice.id, title: "Подделка", normalized_title: "подделка" });
    check(
      "нельзя записать фильм в чужую библиотеку",
      Boolean(forgedInsert.error),
      "вставка прошла",
    );

    const strangerProfile = await bob.client
      .from("profiles")
      .select("id")
      .eq("id", alice.id);
    check(
      "чужой профиль не виден без заявки",
      !strangerProfile.error && strangerProfile.data.length === 0,
      `вернулось строк: ${strangerProfile.data?.length}`,
    );

    const found = await bob.client.rpc("find_profile_by_handle", {
      p_handle: alice.handle,
    });
    check(
      "поиск по точному имени находит человека",
      !found.error && found.data?.length === 1,
      found.error?.message,
    );

    // Заявка и дружба.
    const request = await bob.client
      .from("friendships")
      .insert({ requester_id: bob.id, addressee_id: alice.id })
      .select()
      .single();
    check("заявка в друзья отправляется", !request.error, request.error?.message);

    const selfAccept = await bob.client
      .from("friendships")
      .update({ status: "accepted" })
      .eq("id", request.data?.id);
    check(
      "заявитель не принимает свою же заявку",
      Boolean(selfAccept.error),
      "приняли сами себя",
    );

    const accept = await alice.client
      .from("friendships")
      .update({ status: "accepted" })
      .eq("id", request.data?.id);
    check("адресат принимает заявку", !accept.error, accept.error?.message);

    const friendReadClosed = await bob.client
      .from("movies")
      .select("id")
      .eq("id", movieId);
    check(
      "дружба сама по себе не открывает библиотеку",
      !friendReadClosed.error && friendReadClosed.data.length === 0,
      `вернулось строк: ${friendReadClosed.data?.length}`,
    );

    // Видимость включена вручную.
    const open = await alice.client
      .from("profiles")
      .update({ library_visibility: "friends" })
      .eq("id", alice.id);
    check("владелец открывает библиотеку друзьям", !open.error, open.error?.message);

    const friendRead = await bob.client.from("movies").select("id").eq("id", movieId);
    check(
      "друг видит открытую библиотеку",
      !friendRead.error && friendRead.data.length === 1,
      `вернулось строк: ${friendRead.data?.length}`,
    );

    const friendWrite = await bob.client
      .from("movies")
      .update({ title: "Переписано" })
      .eq("id", movieId)
      .select();
    check(
      "друг не правит чужой фильм",
      !friendWrite.error && friendWrite.data.length === 0,
      "правка прошла",
    );

    // Оценки.
    const friendRating = await bob.client
      .from("ratings")
      .insert({
        movie_id: movieId,
        owner_id: alice.id,
        rater_user_id: bob.id,
        rater_name: bob.handle,
        normalized_rater_name: bob.handle,
        value: 8.5,
      })
      .select()
      .single();
    check("друг оценивает фильм", !friendRating.error, friendRating.error?.message);

    const doubleRating = await bob.client.from("ratings").insert({
      movie_id: movieId,
      owner_id: alice.id,
      rater_user_id: bob.id,
      rater_name: bob.handle,
      normalized_rater_name: bob.handle,
      value: 4,
    });
    check(
      "вторая оценка того же зрителя не создаётся",
      Boolean(doubleRating.error),
      "создались две оценки",
    );

    const forgedRating = await bob.client.from("ratings").insert({
      movie_id: movieId,
      owner_id: alice.id,
      rater_user_id: alice.id,
      rater_name: "чужим именем",
      normalized_rater_name: "чужим именем",
      value: 1,
    });
    check(
      "нельзя поставить оценку от чужого имени",
      Boolean(forgedRating.error),
      "подделка прошла",
    );

    // Журнал колеса.
    const session = await alice.client
      .from("roll_sessions")
      .insert({ host_id: alice.id })
      .select()
      .single();
    check("ведущий создаёт сессию", !session.error, session.error?.message);

    const forgedEvent = await alice.client.from("roll_events").insert({
      session_id: session.data?.id,
      actor_id: alice.id,
      type: "spin-result",
      payload: { index: 0 },
    });
    check(
      "браузер не пишет в журнал колеса",
      Boolean(forgedEvent.error),
      "событие записано из клиента",
    );

    // Приглашения.
    const invite = await alice.client.rpc("create_invite");
    check("пользователь создаёт приглашение", !invite.error, invite.error?.message);

    const foreignInvites = await bob.client.from("invites").select("code");
    const seesAlicesCode =
      !foreignInvites.error &&
      foreignInvites.data.some((row) => row.code === invite.data?.code);
    check("чужие приглашения не видны", !seesAlicesCode, "код виден постороннему");
    // Удаление аккаунта — часть продукта, а не только уборка за тестом.
    // Раньше оно падало: обнуление invites.used_by ломало ограничение, и
    // человек не мог удалить свой аккаунт.
    const removal = await admin.auth.admin.deleteUser(bob.id);
    check("аккаунт удаляется вместе со всеми данными", !removal.error, removal.error?.message);

    const usedInvite = await admin
      .from("invites")
      .select("code, used_at")
      .not("used_at", "is", null)
      .limit(1);
    check(
      "погашенное приглашение не возвращается в оборот после удаления",
      !usedInvite.error && usedInvite.data.length > 0,
      "код снова числится свободным",
    );

    const orphan = await admin.from("profiles").select("id").eq("id", bob.id);
    check(
      "данные удалённого аккаунта не остаются в базе",
      !orphan.error && orphan.data.length === 0,
      `осталось строк: ${orphan.data?.length}`,
    );
  } finally {
    await admin.auth.admin.deleteUser(alice.id);
    await admin.auth.admin.deleteUser(bob.id);
  }

  console.log(
    `\nПроверок: ${results.length}, провалено: ${failures}.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nПроверка прервана: ${error.message}`);
  process.exit(2);
});
