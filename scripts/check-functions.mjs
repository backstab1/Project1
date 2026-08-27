// Проверка Edge Functions на живом проекте.
//
// Запуск: npm run check:functions
// Требуются переменные окружения из .env.local (см. .env.example).
// Скрипт создаёт временных пользователей и удаляет их за собой — запускать
// только на dev-проекте.

import { createClient } from "@supabase/supabase-js";

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
  const email = `fn-${handle}-${stamp()}@cinevault.test`;
  const password = `pwd-${stamp()}-${stamp()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`создание пользователя: ${error.message}`);

  const code = `F${stamp().toUpperCase().padEnd(7, "X").slice(0, 7)}`;
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

function poolOf(...titles) {
  return titles.map((title, index) => ({
    type: "movie",
    id: `m${index + 1}`,
    title,
    categoryId: "c1",
  }));
}

async function main() {
  const suffix = stamp();
  const host = await createUser(`host${suffix}`);
  const guest = await createUser(`guest${suffix}`);

  try {
    const session = await host.client
      .from("roll_sessions")
      .insert({ host_id: host.id, save_threshold: 2 })
      .select()
      .single();
    check("ведущий создаёт сессию", !session.error, session.error?.message);
    const sessionId = session.data?.id;

    await host.client
      .from("roll_session_members")
      .insert({ session_id: sessionId, user_id: guest.id, saves_left: 1 });

    const act = (who, action, payload = {}) =>
      who.client.functions.invoke("roll-action", {
        body: { sessionId, action, payload },
      });

    const started = await act(host, "session-started", {
      pool: poolOf("Дюна", "Сталкер", "Солярис"),
      participants: [
        { id: "p1", name: "Ведущий", saves: 1 },
        { id: "p2", name: "Гость", saves: 1 },
      ],
      savesEnabledAboveRemaining: 2,
    });
    check("сессия стартует через функцию", !started.error, started.error?.message);

    const twice = await act(host, "session-started", {
      pool: poolOf("Другой", "Состав"),
      participants: [{ id: "p1", name: "Ведущий", saves: 0 }],
      savesEnabledAboveRemaining: 1,
    });
    check("повторный старт отвергается", Boolean(twice.error), "состав переписали");

    const guestSpin = await act(guest, "spin");
    check("гость не крутит колесо", Boolean(guestSpin.error), "спин прошёл от гостя");

    const spin = await act(host, "spin");
    check("ведущий крутит колесо", !spin.error, spin.error?.message);

    const events = await host.client
      .from("roll_events")
      .select("seq, type, payload")
      .eq("session_id", sessionId)
      .order("seq");
    check("журнал читается участником", !events.error, events.error?.message);

    const spinEvent = events.data?.find((event) => event.type === "spin");
    const index = spinEvent?.payload?.index;
    check(
      "индекс выбирает сервер, а не клиент",
      Number.isInteger(index) && index >= 0 && index < 3,
      `в журнале: ${JSON.stringify(spinEvent?.payload)}`,
    );

    // Совместная сессия обязана крутиться одинаково у всех: и результат, и
    // число оборотов, и момент старта задаёт сервер.
    const startAt = Date.parse(spinEvent?.payload?.startAt ?? "");
    check(
      "сервер назначает общий момент старта",
      Number.isFinite(startAt) && Math.abs(startAt - Date.now()) < 60_000,
      `startAt: ${spinEvent?.payload?.startAt}`,
    );
    check(
      "сервер задаёт число оборотов и длительность",
      Number.isInteger(spinEvent?.payload?.turns) &&
        spinEvent.payload.turns >= 5 &&
        Number.isInteger(spinEvent?.payload?.duration),
      `оборотов: ${spinEvent?.payload?.turns}, длительность: ${spinEvent?.payload?.duration}`,
    );

    const guestSave = await act(guest, "save-used", { participantId: "p2" });
    check("гость тратит свой сейв", !guestSave.error, guestSave.error?.message);

    const earlyEliminate = await act(host, "eliminate");
    check(
      "выбывание без результата спина отвергается",
      Boolean(earlyEliminate.error),
      "выбывание прошло на пустом месте",
    );

    // Догоняем сессию до победителя: два выбывания из трёх участников.
    for (let round = 0; round < 2; round += 1) {
      const s = await act(host, "spin");
      if (s.error) break;
      await act(host, "eliminate");
    }

    const finished = await host.client
      .from("roll_sessions")
      .select("status, state")
      .eq("id", sessionId)
      .single();
    check(
      "сессия дошла до победителя",
      finished.data?.status === "completed" && Boolean(finished.data?.state?.winner),
      `статус: ${finished.data?.status}`,
    );
    check(
      "снимок состояния хранит одного победителя",
      finished.data?.state?.pool?.length === 1,
      `в колесе осталось: ${finished.data?.state?.pool?.length}`,
    );

    const guestDelete = await guest.client.functions.invoke("delete-account", { body: {} });
    check("аккаунт удаляется своей же функцией", !guestDelete.error, guestDelete.error?.message);

    const gone = await admin.auth.admin.getUserById(guest.id);
    check(
      "удалённого аккаунта больше нет",
      Boolean(gone.error) || !gone.data?.user,
      "пользователь остался",
    );
  } finally {
    await admin.auth.admin.deleteUser(host.id).catch(() => {});
    await admin.auth.admin.deleteUser(guest.id).catch(() => {});
  }

  console.log(`\nПроверок: ${total}, провалено: ${failures}.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nПроверка прервана: ${error.message}`);
  process.exit(2);
});
