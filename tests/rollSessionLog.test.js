import test from "node:test";
import assert from "node:assert/strict";

import { applySpin, createRollSession, spinSession } from "../src/domain/rollEngine.js";
import { buildSessionFromLog } from "../src/domain/rollSessionLog.js";

const POOL = [
  { type: "movie", id: "m1", title: "Дюна" },
  { type: "movie", id: "m2", title: "Сталкер" },
  { type: "movie", id: "m3", title: "Солярис" },
];
const PARTICIPANTS = [
  { id: "p1", name: "Илья", saves: 1 },
  { id: "p2", name: "Аня", saves: 1 },
];

const at = (minute) => `2026-08-24T20:0${minute}:00.000Z`;

function fullJournal() {
  return [
    {
      seq: 1,
      type: "session-started",
      at: at(0),
      payload: {
        sessionId: "s1",
        pool: POOL,
        participants: PARTICIPANTS,
        savesEnabledAboveRemaining: 2,
      },
    },
    { seq: 2, type: "spin", at: at(1), payload: { index: 2 } },
    { seq: 3, type: "reroll", at: at(2), payload: {} },
    { seq: 4, type: "spin", at: at(3), payload: { index: 0 } },
    { seq: 5, type: "save-used", at: at(4), payload: { participantId: "p1" } },
    { seq: 6, type: "spin", at: at(5), payload: { index: 1 } },
    { seq: 7, type: "eliminate", at: at(6), payload: {} },
    { seq: 8, type: "spin", at: at(7), payload: { index: 1 } },
    { seq: 9, type: "eliminate", at: at(8), payload: {} },
  ];
}

test("одинаковый журнал даёт одинаковое состояние независимо от порядка доставки", () => {
  // Это и есть весь механизм совместной сессии: события могут прийти к двум
  // клиентам вразнобой, но состояние обязано совпасть до последнего поля.
  const journal = fullJournal();
  const inOrder = buildSessionFromLog(journal);
  const jumbled = buildSessionFromLog([
    journal[4], journal[0], journal[8], journal[2], journal[6],
    journal[1], journal[7], journal[3], journal[5],
  ]);

  assert.deepEqual(inOrder, jumbled);
});

test("журнал доигрывается до одного победителя", () => {
  const session = buildSessionFromLog(fullJournal());

  assert.equal(session.status, "completed");
  assert.equal(session.winner.title, "Дюна");
  assert.equal(session.pool.length, 1);
  assert.equal(session.id, "s1");
  assert.equal(session.events.at(-1).type, "winner-declared");
});

test("выбывшие идут от свежего к старому, каждый со своим временем сервера", () => {
  const session = buildSessionFromLog(fullJournal());

  assert.deepEqual(
    session.eliminated.map((item) => [item.title, item.eliminatedAt]),
    [["Солярис", at(8)], ["Сталкер", at(6)]],
  );
  assert.equal(session.completedAt, at(8));
});

test("сейв списывается у того, кто его потратил", () => {
  const session = buildSessionFromLog(fullJournal());

  assert.equal(session.participants.find((item) => item.id === "p1").savesRemaining, 0);
  assert.equal(session.participants.find((item) => item.id === "p2").savesRemaining, 1);
});

test("идентификаторы и время событий берутся из журнала, а не с часов клиента", () => {
  const session = buildSessionFromLog(fullJournal());

  assert.deepEqual(
    session.events.slice(0, 3).map((event) => [event.id, event.type, event.createdAt]),
    [
      ["1-0", "session-started", at(0)],
      ["2-0", "spin-result", at(1)],
      ["3-0", "reroll", at(2)],
    ],
  );
});

test("журнал без начала сессии не собирается", () => {
  assert.throws(
    () => buildSessionFromLog([{ seq: 2, type: "spin", at: at(1), payload: { index: 0 } }]),
    /Журнал начинается не с начала сессии/,
  );
});

test("событие без времени сервера отвергается", () => {
  assert.throws(
    () => buildSessionFromLog([{ seq: 1, type: "session-started", payload: {} }]),
    /время сервера/,
  );
});

test("одиночное колесо продолжает работать по-старому", () => {
  // Часы и индекс стали параметрами, но значения по умолчанию прежние.
  const session = createRollSession({
    pool: POOL,
    participants: PARTICIPANTS,
    savesEnabledAboveRemaining: 2,
  });

  assert.equal(session.status, "active");
  assert.equal(typeof session.createdAt, "string");
  assert.equal(spinSession(session, () => 0.99).pendingIndex, 2);
  assert.throws(() => applySpin(session, 99), RangeError);
});
