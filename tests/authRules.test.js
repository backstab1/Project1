import test from "node:test";
import assert from "node:assert/strict";

import {
  describeAuthError,
  normalizeHandle,
  normalizeInviteCode,
  validateHandle,
  validateInviteCode,
  validatePassword,
  validateSignIn,
  validateSignUp,
} from "../src/domain/authRules.js";

test("имя пользователя приводится к виду, который принимает база", () => {
  assert.equal(normalizeHandle("  @Ilya_K  "), "ilya_k");
  assert.equal(validateHandle("@Ilya_K"), null);
});

test("имя пользователя с кириллицей отклоняется до отправки формы", () => {
  // Латинская «a» и кириллическая «а» неразличимы на глаз: два таких имени
  // позволили бы выдать себя за другого человека.
  assert.equal(
    validateHandle("иван"),
    "Только латиница, цифры и подчёркивание.",
  );
});

test("имя пользователя не начинается и не заканчивается подчёркиванием", () => {
  assert.equal(
    validateHandle("_ilya"),
    "Имя не может начинаться или заканчиваться подчёркиванием.",
  );
  assert.equal(
    validateHandle("ilya_"),
    "Имя не может начинаться или заканчиваться подчёркиванием.",
  );
  assert.equal(validateHandle("il"), "Имя короче трёх символов.");
});

test("код приглашения переживает пробелы и дефисы", () => {
  assert.equal(normalizeInviteCode("cine-vlt1"), "CINEVLT1");
  assert.equal(validateInviteCode(" cine vlt1 "), null);
  assert.equal(
    validateInviteCode("CINE"),
    "Код состоит из восьми латинских букв и цифр.",
  );
});

test("пароль короче восьми символов не проходит", () => {
  assert.equal(validatePassword("1234567"), "Пароль короче 8 символов.");
  assert.equal(validatePassword("        "), "Пароль не может состоять из пробелов.");
  assert.equal(validatePassword("достаточно длинный"), null);
});

test("регистрация собирает все ошибки сразу, а не по одной", () => {
  const result = validateSignUp({
    email: "не почта",
    password: "123",
    passwordRepeat: "456",
    handle: "_",
    displayName: "",
    inviteCode: "",
  });

  assert.equal(result.valid, false);
  assert.deepEqual(Object.keys(result.errors).sort(), [
    "displayName",
    "email",
    "handle",
    "inviteCode",
    "password",
  ]);
});

test("несовпадение паролей ловится отдельно от их длины", () => {
  const result = validateSignUp({
    email: "ilya@example.com",
    password: "достаточно длинный",
    passwordRepeat: "другой пароль",
    handle: "ilya",
    displayName: "Илья",
    inviteCode: "CINEVLT1",
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, { passwordRepeat: "Пароли не совпадают." });
});

test("верная регистрация возвращает нормализованные значения", () => {
  const result = validateSignUp({
    email: "  Ilya@Example.COM ",
    password: "достаточно длинный",
    passwordRepeat: "достаточно длинный",
    handle: "@Ilya_K",
    displayName: "  Илья   К  ",
    inviteCode: "cine-vlt1",
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.values, {
    email: "ilya@example.com",
    password: "достаточно длинный",
    handle: "ilya_k",
    displayName: "Илья К",
    inviteCode: "CINEVLT1",
  });
});

test("вход требует только заполненности, а не сложности пароля", () => {
  // Старый пароль мог быть заведён до ужесточения правил — на входе его
  // нельзя отвергать, иначе человек не попадёт в свой аккаунт.
  const result = validateSignIn({ email: "ilya@example.com", password: "123" });
  assert.equal(result.valid, true);
});

test("ошибки сервера переводятся, а неизвестные показываются как есть", () => {
  assert.equal(
    describeAuthError(new Error("Invalid login credentials")),
    "Неверная почта или пароль.",
  );
  assert.equal(
    describeAuthError(new Error("Email not confirmed")),
    "Почта не подтверждена — проверьте письмо.",
  );
  assert.equal(
    describeAuthError({ message: 'duplicate key value violates unique constraint "profiles_handle_key"' }),
    "Такое имя пользователя уже занято.",
  );
  assert.equal(describeAuthError(new Error("Странная ошибка")), "Странная ошибка");
});
