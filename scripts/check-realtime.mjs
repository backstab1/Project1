// Проверка синхронности совместной сессии колеса (этап 20).
//
// Запуск: npm run check:realtime
// Требуются переменные окружения из .env.local (см. .env.example).
// Скрипт создаёт временных пользователей и удаляет их за собой — запускать
// только на dev-проекте.
//
// Проверяется главное обещание совместного колеса: гость видит тот же спин,
// что и ведущий, узнаёт о нём сам и вовремя. Поэтому здесь два настоящих
// клиента: один ходит, другой только слушает Realtime.

import { createClient } from "@supabase/supabase-js";

import { buildSessionFromLog } from "../src/domain/rollSessionLog.js";

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
  const email = `rt-${handle}-${stamp()}@cinevault.test`;
  const password = `pwd-${stamp()}-${stamp()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) throw new Error(`создание пользователя: ${error.message}`);

  const code = `R${stamp().toUpperCase().padEnd(7, "X").slice(0, 7)}`;
  const invite = await admin.from("invites").insert({ code }).select().single();
  if (invite.error) throw new Error(`приглашение: ${invite.error.message}`);

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`вход: ${signIn.error.message}`);

  const profile = await client.rpc("redeem_invite", {
    p_code: code, p_handle: handle, p_display_name: handle,
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

// Ожидание события из Realtime с честным пределом: тишина дольше предела —
// это провал проверки, а не повод ждать дальше.
function waitFor(predicate, box, limitMs) {
  const started = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const found = box.find(predicate);
      if (found) {
        clearInterval(timer);
        resolve({ event: found, waited: Date.now() - started });
      } else if (Date.now() - started > limitMs) {
        clearInterval(timer);
        resolve({ event: null, waited: Date.now() - started });
      }
    }, 20);
  });
}

async function main() {
  const suffix = stamp();
  const host = await createUser(`host${suffix}`);
  const guest = await createUser(`guest${suffix}`);
  let channel = null;

  try {
    const session = await host.client
      .from("roll_sessions")
      .insert({ host_id: host.id, save_threshold: 2 })
      .select("id")
      .single();
    check("ведущий создаёт сессию", !session.error, session.error?.message);
    const sessionId = session.data?.id;

    await host.client
      .from("roll_session_members")
      .insert({ session_id: sessionId, user_id: guest.id, saves_left: 1 });

    // Гость только слушает: ходов он не делает, всё узнаёт из журнала.
    const received = [];
    let subscribed = false;
    channel = guest.client
      .channel(`roll-session:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "roll_events",
          filter: `session_id=eq.${sessionId}`,
        },
        (message) => received.push({ ...message.new, at: Date.now() }),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") subscribed = true;
      });

    const ready = await waitFor(() => subscribed, [true], 10_000);
    check("гость подписался на журнал сессии", subscribed, `ждали ${ready.waited} мс`);

    const act = (who, action, payload = {}) =>
      who.client.functions.invoke("roll-action", {
        body: { sessionId, action, payload },
      });

    const started = await act(host, "session-started", {
      pool: poolOf("Дюна", "Сталкер", "Солярис", "Прибытие"),
      participants: [
        { id: "p1", name: "Ведущий", saves: 1 },
        { id: "p2", name: "Гость", saves: 1 },
      ],
      savesEnabledAboveRemaining: 2,
    });
    check("ведущий начинает сессию", !started.error, started.error?.message);

    // Между подтверждением подписки и началом доставки есть окно: событие,
    // записанное в этот момент, до клиента не доходит. Поэтому клиент обязан
    // дочитать журнал после подключения — это и делает watchSession.
    const startEvent = await waitFor((e) => e.type === "session-started", received, 3000);
    if (!startEvent.event) {
      const log = await guest.client
        .from("roll_events")
        .select("seq, type, payload, actor_id, created_at")
        .eq("session_id", sessionId)
        .order("seq", { ascending: true });
      for (const row of log.data ?? []) {
        if (!received.some((event) => Number(event.seq) === Number(row.seq))) {
          received.push({ ...row, at: Date.now() });
        }
      }
    }
    check(
      "начало сессии у гостя есть: из Realtime или из дочитанного журнала",
      received.some((event) => event.type === "session-started"),
      "события старта нет ни там, ни там",
    );

    const spinSentAt = Date.now();
    const spin = await act(host, "spin");
    check("ведущий крутит колесо", !spin.error, spin.error?.message);

    const spinEvent = await waitFor((e) => e.type === "spin", received, 8000);
    check(
      "гость получил спин по Realtime",
      Boolean(spinEvent.event),
      `тишина ${spinEvent.waited} мс`,
    );

    const payload = spinEvent.event?.payload ?? {};
    check(
      "в спине пришли результат, обороты и общий старт",
      Number.isInteger(payload.index) &&
        Number.isInteger(payload.turns) &&
        Number.isInteger(payload.duration) &&
        Number.isFinite(Date.parse(payload.startAt ?? "")),
      JSON.stringify(payload),
    );

    // Главное число проверки: успевает ли событие дойти до общего старта.
    // Если нет — гость начнёт вращение с середины, и синхронность потеряется.
    const startAt = Date.parse(payload.startAt ?? "");
    const arrived = spinEvent.event?.at ?? Date.now();
    check(
      "событие дошло раньше общего момента старта",
      arrived <= startAt,
      `дошло за ${arrived - spinSentAt} мс, старт через ${startAt - arrived} мс после доставки`,
    );
    console.log(
      `         доставка ${arrived - spinSentAt} мс, запас до старта ${startAt - arrived} мс`,
    );

    // Гость складывает журнал тем же редьюсером, что и сервер: состояние
    // обязано совпасть без единого запроса «а как там у ведущего».
    const ordered = [...received].sort((a, b) => Number(a.seq) - Number(b.seq));
    const guestState = buildSessionFromLog(
      ordered.map((event) => ({
        seq: Number(event.seq),
        type: event.type,
        payload: event.payload,
        actorId: event.actor_id,
        at: event.created_at,
      })),
    );
    const serverSnapshot = await host.client
      .from("roll_sessions")
      .select("state")
      .eq("id", sessionId)
      .single();

    check(
      "состояние у гостя совпало с серверным снимком",
      guestState?.pendingIndex === serverSnapshot.data?.state?.pendingIndex &&
        guestState?.pool?.length === serverSnapshot.data?.state?.pool?.length,
      `у гостя ${guestState?.pendingIndex}/${guestState?.pool?.length}, ` +
        `на сервере ${serverSnapshot.data?.state?.pendingIndex}/` +
        `${serverSnapshot.data?.state?.pool?.length}`,
    );

    // Гость тратит свой сейв — ход не ведущего тоже обязан разойтись по всем.
    const save = await act(guest, "save-used", { participantId: "p2" });
    check("гость тратит сейв", !save.error, save.error?.message);
    const saveEvent = await waitFor((e) => e.type === "save-used", received, 8000);
    check(
      "ход гостя вернулся к нему же через журнал",
      Boolean(saveEvent.event),
      `тишина ${saveEvent.waited} мс`,
    );

    // Посторонний не должен получать чужие события.
    const stranger = await createUser(`other${suffix}`);
    const strangerEvents = [];
    const strangerChannel = stranger.client
      .channel(`roll-session-probe:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "roll_events",
          filter: `session_id=eq.${sessionId}`,
        },
        (message) => strangerEvents.push(message.new),
      )
      .subscribe();

    await new Promise((resolve) => setTimeout(resolve, 1500));
    await act(host, "spin");
    await new Promise((resolve) => setTimeout(resolve, 2500));
    check(
      "посторонний не слышит чужую сессию",
      strangerEvents.length === 0,
      `получено событий: ${strangerEvents.length}`,
    );

    await stranger.client.removeChannel(strangerChannel);
    await admin.auth.admin.deleteUser(stranger.id).catch(() => {});
  } finally {
    if (channel) await guest.client.removeChannel(channel).catch(() => {});
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
