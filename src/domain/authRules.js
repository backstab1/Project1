// Правила входа и регистрации.
//
// Модуль намеренно чистый: он не знает ни про Supabase, ни про DOM. То же
// самое проверяет база (см. supabase/migrations), но пользователь должен
// получать понятный русский ответ до отправки формы, а не код ошибки после.

// Тот же шаблон, что в схеме: только строчная латиница, цифры и подчёркивание.
// Кириллическая «а» и латинская «a» не должны давать двух неразличимых имён.
const HANDLE_PATTERN = /^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$/;
const INVITE_PATTERN = /^[A-Z0-9]{8}$/;

export const PASSWORD_MIN_LENGTH = 8;
export const DISPLAY_NAME_MAX_LENGTH = 60;

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeHandle(value) {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

// Код диктуют голосом и переписывают руками, поэтому пробелы и дефисы внутри
// не считаются ошибкой.
export function normalizeInviteCode(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[\s-]+/g, "");
}

export function normalizeDisplayName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return "Укажите почту.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return "Похоже, в адресе опечатка.";
  }
  return null;
}

export function validatePassword(value) {
  const password = String(value ?? "");
  if (!password) return "Придумайте пароль.";
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Пароль короче ${PASSWORD_MIN_LENGTH} символов.`;
  }
  if (!password.trim()) return "Пароль не может состоять из пробелов.";
  return null;
}

export function validateHandle(value) {
  const handle = normalizeHandle(value);
  if (!handle) return "Придумайте имя пользователя.";
  if (handle.length < 3) return "Имя короче трёх символов.";
  if (handle.length > 20) return "Имя длиннее двадцати символов.";
  if (/[^a-z0-9_]/.test(handle)) {
    return "Только латиница, цифры и подчёркивание.";
  }
  if (!HANDLE_PATTERN.test(handle)) {
    return "Имя не может начинаться или заканчиваться подчёркиванием.";
  }
  return null;
}

export function validateDisplayName(value) {
  const name = normalizeDisplayName(value);
  if (!name) return "Укажите, как вас показывать друзьям.";
  if (name.length > DISPLAY_NAME_MAX_LENGTH) {
    return `Не длиннее ${DISPLAY_NAME_MAX_LENGTH} символов.`;
  }
  return null;
}

export function validateInviteCode(value) {
  const code = normalizeInviteCode(value);
  if (!code) return "Нужен код приглашения.";
  if (!INVITE_PATTERN.test(code)) {
    return "Код состоит из восьми латинских букв и цифр.";
  }
  return null;
}

export function validateSignIn(input = {}) {
  const errors = {};
  const email = validateEmail(input.email);
  if (email) errors.email = email;
  if (!String(input.password ?? "")) errors.password = "Введите пароль.";

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values: { email: normalizeEmail(input.email), password: String(input.password ?? "") },
  };
}

export function validateSignUp(input = {}) {
  const errors = {};
  const checks = {
    email: validateEmail(input.email),
    password: validatePassword(input.password),
    handle: validateHandle(input.handle),
    displayName: validateDisplayName(input.displayName),
    inviteCode: validateInviteCode(input.inviteCode),
  };
  for (const [field, message] of Object.entries(checks)) {
    if (message) errors[field] = message;
  }
  if (!errors.password && String(input.password) !== String(input.passwordRepeat ?? "")) {
    errors.passwordRepeat = "Пароли не совпадают.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values: {
      email: normalizeEmail(input.email),
      password: String(input.password ?? ""),
      handle: normalizeHandle(input.handle),
      displayName: normalizeDisplayName(input.displayName),
      inviteCode: normalizeInviteCode(input.inviteCode),
    },
  };
}

export function validatePasswordReset(input = {}) {
  const errors = {};
  const email = validateEmail(input.email);
  if (email) errors.email = email;
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values: { email: normalizeEmail(input.email) },
  };
}

// Supabase отвечает по-английски, а интерфейс у нас русский. Неизвестную
// ошибку не прячем: показываем исходный текст, иначе диагностировать нечем.
const KNOWN_ERRORS = [
  [/invalid login credentials/i, "Неверная почта или пароль."],
  [/email not confirmed/i, "Почта не подтверждена — проверьте письмо."],
  [/user already registered/i, "Аккаунт с такой почтой уже есть."],
  [/password should be at least/i, `Пароль короче ${PASSWORD_MIN_LENGTH} символов.`],
  [/rate limit|too many requests/i, "Слишком много попыток. Подождите минуту."],
  [/код приглашения не найден/i, "Код приглашения не найден."],
  [/код приглашения уже использован/i, "Этот код уже использован."],
  [/срок действия кода истёк/i, "Срок действия кода истёк."],
  [/profiles_handle_key|duplicate key.*handle/i, "Такое имя пользователя уже занято."],
  [/profiles_handle_check/i, "Имя пользователя не подходит по формату."],
  [/failed to fetch|networkerror/i, "Сервер недоступен. Проверьте связь."],
];

export function describeAuthError(error) {
  const message = typeof error === "string" ? error : error?.message ?? "";
  if (!message) return "Не удалось выполнить действие.";
  for (const [pattern, text] of KNOWN_ERRORS) {
    if (pattern.test(message)) return text;
  }
  return message;
}
