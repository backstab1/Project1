// Временный аккаунт для проверок на живом проекте.
//
// Заготовка была скопирована в четыре скрипта, и копии начали расходиться —
// та же история, что с заголовками CORS. Теперь она одна.
//
// Здесь же повтор запроса. Проект на бесплатном тарифе поднимается по
// требованию, и первые секунды после пробуждения он рвёт соединения:
// `fetch failed`, `terminated`, `Bad Gateway`. Это не поломка проверяемого
// кода, а состояние среды — но проверка из-за него не доходит до первого
// утверждения. Повторяем только подготовку: сами проверки повторять нельзя,
// иначе они начнут прятать настоящие сбои.

const RETRIABLE = [
  "fetch failed",
  "terminated",
  "Bad Gateway",
  "socket hang up",
  "ECONNRESET",
  "ETIMEDOUT",
];

function isRetriable(error) {
  const text = `${error?.message ?? ""} ${error?.cause?.code ?? ""}`;
  return RETRIABLE.some((mark) => text.includes(mark));
}

export async function withRetry(action, { attempts = 4, pause = 2500 } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      last = error;
      if (!isRetriable(error) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, pause * attempt));
    }
  }
  throw last;
}

// Ответ supabase-js кладёт ошибку в поле, а не бросает её: чтобы повтор
// сработал, такую ошибку нужно сначала превратить в исключение.
async function call(action, what) {
  return withRetry(async () => {
    const result = await action();
    if (result?.error) {
      const error = new Error(`${what}: ${result.error.message}`);
      error.cause = result.error;
      throw error;
    }
    return result;
  });
}

function stamp() {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Заводит временного пользователя с профилем: аккаунт, вход, профиль.
 * Возвращает клиента, вошедшего под ним.
 *
 * Удалять пользователя обязан вызывающий — обычно в finally.
 */
export async function createProbeUser({ admin, url, anonKey, createClient, prefix, handle }) {
  const suffix = stamp();
  const email = `${prefix}-${handle}-${suffix}@cinevault.test`;
  const password = `pwd-${suffix}-${stamp()}`;

  const created = await call(
    () => admin.auth.admin.createUser({ email, password, email_confirm: true }),
    "создание пользователя",
  );

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const signIn = await call(
    () => client.auth.signInWithPassword({ email, password }),
    "вход",
  );

  await call(
    () => client.rpc("create_profile", {
      p_handle: handle,
      p_display_name: handle,
    }),
    "create_profile",
  );

  return {
    id: created.data.user.id,
    email,
    handle,
    client,
    token: signIn.data.session.access_token,
  };
}
