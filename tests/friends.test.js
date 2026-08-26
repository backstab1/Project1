import test from "node:test";
import assert from "node:assert/strict";

import {
  buildViewers,
  countIncoming,
  describeFriendError,
  describeFriendship,
  findViewer,
  groupFriendships,
  validateFriendHandle,
} from "../src/domain/friends.js";

const ME = "user-me";

function row(overrides = {}) {
  return {
    id: overrides.id ?? "f1",
    requester_id: overrides.requesterId ?? ME,
    addressee_id: overrides.addresseeId ?? "user-other",
    status: overrides.status ?? "pending",
    created_at: overrides.createdAt ?? "2026-08-01T10:00:00.000Z",
    profile: overrides.profile ?? {
      id: overrides.addresseeId ?? "user-other",
      handle: "other",
      display_name: "Другой",
    },
  };
}

test("одна и та же строка выглядит исходящей у отправителя и входящей у адресата", () => {
  const pending = row();

  assert.equal(describeFriendship(pending, ME).outgoing, true);
  assert.equal(describeFriendship(pending, "user-other").outgoing, false);
  assert.equal(describeFriendship(pending, "user-other").otherId, ME);
});

test("чужая заявка не разбирается: строка не про этого человека", () => {
  const foreign = row({ requesterId: "user-a", addresseeId: "user-b" });
  assert.equal(describeFriendship(foreign, ME), null);
});

test("заявки раскладываются по группам, а счётчик считает только входящие", () => {
  const rows = [
    row({ id: "accepted", status: "accepted", addresseeId: "user-1" }),
    row({ id: "incoming", requesterId: "user-2", addresseeId: ME }),
    row({ id: "outgoing", addresseeId: "user-3" }),
    row({ id: "blocked", status: "blocked", addresseeId: "user-4" }),
  ];

  const groups = groupFriendships(rows, ME);
  assert.deepEqual(groups.friends.map((item) => item.id), ["accepted"]);
  assert.deepEqual(groups.incoming.map((item) => item.id), ["incoming"]);
  assert.deepEqual(groups.outgoing.map((item) => item.id), ["outgoing"]);
  assert.deepEqual(groups.blocked.map((item) => item.id), ["blocked"]);
  assert.equal(countIncoming(rows, ME), 1);
});

test("блокировку снимает только тот, кто её поставил", () => {
  const mine = row({ id: "mine", status: "blocked" });
  const theirs = row({
    id: "theirs",
    status: "blocked",
    requesterId: "user-other",
    addresseeId: ME,
  });

  assert.equal(groupFriendships([mine], ME).blocked[0].ownBlock, true);
  assert.equal(groupFriendships([theirs], ME).blocked[0].ownBlock, false);
});

test("зрители — это владелец и принятые друзья, а не имена из заявок", () => {
  const account = { id: ME, handle: "ilya_k", display_name: "Илья" };
  const rows = [
    row({
      id: "accepted",
      status: "accepted",
      addresseeId: "user-1",
      profile: { id: "user-1", handle: "anton", display_name: "Антон" },
    }),
    // Ожидающая заявка зрителем не делает: колесо и оценки — только для друзей.
    row({
      id: "pending",
      addresseeId: "user-2",
      profile: { id: "user-2", handle: "vera", display_name: "Вера" },
    }),
  ];

  const viewers = buildViewers(account, rows);
  assert.deepEqual(viewers.map((viewer) => viewer.name), ["Илья", "Антон"]);
  assert.equal(viewers[0].isSelf, true);
  assert.equal(findViewer(viewers, "user-1").handle, "anton");
  assert.equal(findViewer(viewers, "user-2"), null);
});

test("без аккаунта зрителей нет: имя больше неоткуда взять", () => {
  assert.deepEqual(buildViewers(null, []), []);
});

test("профиль без имени показывается по имени пользователя", () => {
  const viewers = buildViewers({ id: ME, handle: "ilya_k", display_name: "  " });
  assert.equal(viewers[0].name, "@ilya_k");
});

test("имя пользователя для заявки проверяется до отправки", () => {
  assert.equal(validateFriendHandle("  @Anton "), null);
  assert.equal(validateFriendHandle(""), "Введите имя пользователя.");
  assert.equal(
    validateFriendHandle("антон"),
    "Только латиница, цифры и подчёркивание.",
  );
  assert.equal(
    validateFriendHandle("@ilya_k", "ilya_k"),
    "Это ваше имя пользователя.",
  );
});

test("ошибки сервера переводятся, а незнакомая не прячется", () => {
  assert.equal(
    describeFriendError(new Error('duplicate key value violates unique constraint "friendships_pair_key"')),
    "Заявка этому человеку уже есть.",
  );
  assert.equal(
    describeFriendError(new Error("Слишком много заявок за сутки. Попробуйте завтра.")),
    "Слишком много заявок за сутки. Попробуйте завтра.",
  );
  assert.equal(describeFriendError(new Error("boom")), "boom");
});
