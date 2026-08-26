// Вход в CineVault: витрина открыта всем, библиотека — только по аккаунту.
//
// Глухого экрана входа на старте больше нет. Гость попадает на витрину и сам
// решает, когда открыть кабинет внизу справа. Полноэкранный экран остаётся для
// двух случаев, где выбора действительно нет: смена пароля по ссылке из письма
// и обмен приглашения на профиль после подтверждения почты.

import { isServerConfigured } from "../config.js";
import {
  describeAuthError,
  normalizeDisplayName,
  normalizeHandle,
  normalizeInviteCode,
  validateDisplayName,
  validateHandle,
  validateInviteCode,
  validatePassword,
  validatePasswordReset,
  validateSignIn,
  validateSignUp,
} from "../domain/authRules.js";
import {
  ensureProfile,
  getSession,
  isRecoveryEntry,
  redeemInvite,
  requestPasswordReset,
  signIn,
  signOut,
  signUp,
  updatePassword,
} from "../services/authService.js";
import { renderAuthScreen } from "./authScreen.js";

// Режимы, в которых человека нельзя пустить дальше формы: без нового пароля
// сессия непригодна, без приглашения нет профиля, а значит и библиотеки.
const BLOCKING_MODES = new Set(["recovery", "profile"]);

export function isAuthPreview() {
  return new URLSearchParams(location.search).get("auth") === "preview";
}

// Тихо выясняет, кто пришёл. Ничего не рисует и никого не задерживает:
// решение — показывать витрину гостю или сразу библиотеку — принимает main.js.
export async function resolveAccountEntry() {
  if (!isServerConfigured()) {
    return entry({ configured: false, error: "Сервер не настроен." });
  }

  try {
    const point = await resolveEntryPoint();
    if (point.profile) return entry({ profile: point.profile });
    return entry({ mode: point.mode, notice: point.notice ?? "" });
  } catch (error) {
    return entry({ error: describeAuthError(error) });
  }
}

function entry(values = {}) {
  const mode = values.mode ?? "signin";
  return {
    profile: values.profile ?? null,
    mode,
    notice: values.notice ?? "",
    error: values.error ?? null,
    configured: values.configured ?? true,
    blocking: BLOCKING_MODES.has(mode),
  };
}

// Полноэкранная форма — следующая страница после витрины и единственный экран
// на обязательных шагах. Разрешается профилем, когда человек довёл дело до
// конца, или null, если он решил вернуться на витрину.
export function openAuthScreen(root, source = {}) {
  const configured = isServerConfigured();
  const screen = {
    mode: source.mode ?? "signin",
    values: {},
    errors: source.error ? { general: source.error } : {},
    notice: source.notice ?? "",
    busy: false,
    serverConfigured: configured,
    // Уйти можно только с того экрана, на который пришли добровольно.
    cancellable: Boolean(source.cancellable),
    // В предпросмотре форму можно отправлять и без сервера: проверки полей
    // срабатывают до сети, и их видно, а до запроса дело не доходит.
    canSubmit: configured || isAuthPreview(),
    onSubmit: () => {},
    onModeChange: () => {},
  };

  return new Promise((resolve) => {
    const paint = () => renderAuthScreen(root, screen);

    screen.onModeChange = (mode) => {
      if (mode === "cancel") {
        resolve(null);
        return;
      }
      if (mode === "signout") {
        signOut().catch(() => {});
        screen.mode = "signin";
      } else {
        screen.mode = mode;
      }
      screen.errors = {};
      screen.notice = "";
      screen.values = {};
      paint();
    };

    screen.onSubmit = (mode, values) => {
      screen.values = values;
      screen.errors = {};
      screen.notice = "";
      screen.busy = true;
      paint();

      submitAuthForm(mode, values)
        .then((result) => {
          screen.busy = false;
          if (result.profile) {
            resolve(result.profile);
            return;
          }
          if (result.mode) screen.mode = result.mode;
          screen.notice = result.notice ?? "";
          screen.errors = result.errors ?? {};
          if (result.clearValues) screen.values = {};
          paint();
        })
        .catch((error) => {
          screen.busy = false;
          screen.errors = { general: describeAuthError(error) };
          paint();
        });
    };

    paint();
  });
}

async function resolveEntryPoint() {
  if (isRecoveryEntry()) {
    return { mode: "recovery", notice: "Задайте новый пароль." };
  }

  const session = await getSession();
  if (!session) return { mode: "signin" };

  const profile = await ensureProfile();
  if (profile) return { profile };

  return {
    mode: "profile",
    notice: "Почта подтверждена. Остался код приглашения.",
  };
}

// Одна отправка формы — один результат. Форму рисует и полноэкранный экран,
// и кабинет внизу справа, поэтому правила живут здесь, а не в разметке.
export async function submitAuthForm(mode, values) {
  if (mode === "signin") return submitSignIn(values);
  if (mode === "signup") return submitSignUp(values);
  if (mode === "reset") return submitReset(values);
  if (mode === "recovery") return submitRecovery(values);
  if (mode === "profile") return submitProfile(values);
  return { mode: "signin" };
}

async function submitSignIn(values) {
  const check = validateSignIn(values);
  if (!check.valid) return { errors: check.errors };

  await signIn(check.values);
  const profile = await ensureProfile();
  if (profile) return { profile };

  return {
    mode: "profile",
    notice: "Вы вошли. Остался код приглашения.",
    clearValues: true,
  };
}

async function submitSignUp(values) {
  const check = validateSignUp(values);
  if (!check.valid) return { errors: check.errors };

  const { session } = await signUp(check.values);
  if (session) {
    const profile = await ensureProfile();
    if (profile) return { profile };
    return { mode: "profile", clearValues: true };
  }

  return {
    mode: "signin",
    notice: "Письмо отправлено. Подтвердите почту и возвращайтесь ко входу.",
    clearValues: true,
  };
}

async function submitReset(values) {
  const check = validatePasswordReset(values);
  if (!check.valid) return { errors: check.errors };

  await requestPasswordReset(check.values.email);
  return {
    mode: "signin",
    notice: "Если такая почта у нас есть, ссылка уже отправлена.",
    clearValues: true,
  };
}

async function submitRecovery(values) {
  const errors = {};
  const password = validatePassword(values.password);
  if (password) errors.password = password;
  if (!password && values.password !== values.passwordRepeat) {
    errors.passwordRepeat = "Пароли не совпадают.";
  }
  if (Object.keys(errors).length > 0) return { errors };

  await updatePassword(values.password);
  // Ссылка восстановления оставляет служебные параметры в адресе: убираем,
  // иначе обновление страницы снова покажет экран смены пароля.
  history.replaceState(null, "", location.pathname);

  const profile = await ensureProfile();
  if (profile) return { profile };
  return { mode: "profile", notice: "Пароль сохранён.", clearValues: true };
}

async function submitProfile(values) {
  const errors = {};
  const invite = validateInviteCode(values.inviteCode);
  const handle = validateHandle(values.handle);
  const displayName = validateDisplayName(values.displayName);
  if (invite) errors.inviteCode = invite;
  if (handle) errors.handle = handle;
  if (displayName) errors.displayName = displayName;
  if (Object.keys(errors).length > 0) return { errors };

  const profile = await redeemInvite({
    inviteCode: normalizeInviteCode(values.inviteCode),
    handle: normalizeHandle(values.handle),
    displayName: normalizeDisplayName(values.displayName),
  });
  return { profile };
}
