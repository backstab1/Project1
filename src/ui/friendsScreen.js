// Раздел «Друзья»: приватность библиотеки, поиск по имени пользователя,
// входящие и исходящие заявки, сам список друзей и блокировки.
//
// Экран технический, как настройки: узкая колонка, группы со строками и
// мелкое управление справа. Имена людей приходят из профилей — руками здесь
// не вводится ничего, кроме имени пользователя при поиске.

import { initials } from "./accountMenu.js";
import { groupFriendships } from "../domain/friends.js";
import {
  escapeAttribute,
  escapeHtml,
  settingsGroup,
  settingsRow,
  smallButton,
} from "./settingsKit.js";

export function renderFriends(container, state) {
  const account = state.account;
  const friends = state.friends ?? {};
  const groups = groupFriendships(friends.rows ?? [], account?.id);
  const search = friends.search ?? {};

  container.innerHTML = `
    <div class="settings">
      ${renderPrivacy(state)}
      ${renderSearch(account, search, friends)}
      ${renderRequests(groups, friends)}
      ${renderFriendList(groups, friends)}
      ${renderBlocked(groups, friends)}
    </div>
  `;
}

function renderPrivacy(state) {
  const visibility = state.account?.library_visibility ?? "private";
  const open = visibility === "friends";
  const friends = state.friends ?? {};

  return settingsGroup({
    title: "Моя библиотека",
    status: `<span class="status-pill ${open ? "status-pill--ok" : ""}">
      <i></i>${open ? "видна друзьям" : "скрыта"}
    </span>`,
    rows: [
      settingsRow({
        title: "Кто видит библиотеку",
        hint: open
          ? "Друзья видят фильмы, статусы и оценки. Менять их можете только вы."
          : "Библиотеку не видит никто. Заявки в друзья это не отменяет.",
        control: `
          <div class="segmented" role="group" aria-label="Видимость библиотеки">
            ${[["private", "Скрыта"], ["friends", "Друзьям"]].map(([value, label]) => `
              <button type="button" class="${visibility === value ? "is-active" : ""}"
                data-action="privacy-set" data-value="${value}"
                ${friends.busy ? "disabled" : ""}
                aria-pressed="${visibility === value}">${escapeHtml(label)}</button>
            `).join("")}
          </div>`,
      }),
      friends.error
        ? `<p class="set-alert" role="alert">${escapeHtml(friends.error)}</p>`
        : "",
    ],
    note: "Видимость проверяет сервер: закрытую библиотеку не отдаст даже прямой запрос к API.",
  });
}

function renderSearch(account, search, friends) {
  const query = search.query ?? "";
  const found = search.profile;

  return settingsGroup({
    title: "Добавить друга",
    rows: [
      settingsRow({
        title: "Имя пользователя",
        hint: `Список аккаунтов закрыт: человека находят по точному имени.
          Ваше — <code>@${escapeHtml(account?.handle ?? "")}</code>.`,
        control: `
          <span class="handle-field">
            <i>@</i>
            <input type="text" data-control="friend-search"
              data-submit-action="friend-find" value="${escapeAttribute(query)}"
              maxlength="20" autocomplete="off" spellcheck="false"
              placeholder="ilya_k" aria-label="Имя пользователя">
          </span>
          ${smallButton("friend-find", search.busy ? "Ищем…" : "Найти", {
            disabled: Boolean(search.busy) || !query.trim(),
          })}`,
      }),
      search.error
        ? `<p class="set-alert" role="alert">${escapeHtml(search.error)}</p>`
        : "",
      search.notice
        ? `<p class="set-note" role="status">${escapeHtml(search.notice)}</p>`
        : "",
      found
        ? personRow(found, {
            note: "Найден по имени пользователя",
            actions: smallButton("friend-request", "Отправить заявку", {
              primary: true,
              disabled: Boolean(friends.busy),
              dataset: { userId: found.id },
            }),
          })
        : "",
    ],
  });
}

function renderRequests(groups, friends) {
  const { incoming, outgoing } = groups;
  if (incoming.length === 0 && outgoing.length === 0) return "";

  return settingsGroup({
    title: "Заявки",
    status: incoming.length
      ? `<span class="status-pill status-pill--ok"><i></i>${incoming.length}
          ${pluralize(incoming.length, ["входящая", "входящие", "входящих"])}</span>`
      : `<span class="set-value">${outgoing.length}
          ${pluralize(outgoing.length, ["исходящая", "исходящие", "исходящих"])}</span>`,
    rows: [
      ...incoming.map((item) =>
        personRow(item.profile, {
          note: "Хочет добавить вас в друзья",
          actions: `
            ${smallButton("friend-accept", "Принять", {
              primary: true,
              disabled: Boolean(friends.busy),
              dataset: { id: item.id },
            })}
            ${smallButton("friend-decline", "Отклонить", {
              disabled: Boolean(friends.busy),
              dataset: { id: item.id },
            })}
            ${smallButton("friend-block", "Заблокировать", {
              disabled: Boolean(friends.busy),
              dataset: { id: item.id },
            })}`,
        }),
      ),
      ...outgoing.map((item) =>
        personRow(item.profile, {
          note: "Заявка отправлена, ждём ответа",
          actions: smallButton("friend-cancel", "Отменить", {
            disabled: Boolean(friends.busy),
            dataset: { id: item.id },
          }),
        }),
      ),
    ],
  });
}

function renderFriendList(groups, friends) {
  const items = groups.friends;

  return settingsGroup({
    title: "Друзья",
    status: `<span class="set-value">${items.length}</span>`,
    rows: items.length
      ? items.map((item) =>
          personRow(item.profile, {
            note: "Зритель: ставит оценки и играет в колесе",
            actions: `
              ${smallButton("friend-remove", "Удалить", {
                disabled: Boolean(friends.busy),
                dataset: { id: item.id },
              })}
              ${smallButton("friend-block", "Заблокировать", {
                disabled: Boolean(friends.busy),
                dataset: { id: item.id },
              })}`,
          }),
        )
      : [friends.loading
          ? `<p class="set-empty">Читаем список…</p>`
          : `<p class="set-empty">Пока никого. Друзья становятся зрителями:
              их имена подставляются в оценки и в состав колеса.</p>`],
  });
}

function renderBlocked(groups, friends) {
  const items = groups.blocked;
  if (items.length === 0) return "";

  return settingsGroup({
    title: "Заблокированные",
    status: `<span class="set-value">${items.length}</span>`,
    rows: items.map((item) =>
      personRow(item.profile, {
        note: item.ownBlock
          ? "Не найдёт вас поиском и не подаст заявку"
          : "Заблокировал вас",
        actions: item.ownBlock
          ? smallButton("friend-unblock", "Разблокировать", {
              disabled: Boolean(friends.busy),
              dataset: { id: item.id },
            })
          : "",
      }),
    ),
  });
}

function pluralize(number, forms) {
  const mod100 = number % 100;
  const mod10 = number % 10;
  if (mod100 >= 11 && mod100 <= 19) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

// Строка человека: аватар с инициалами, имя, @handle и действия справа.
// Профиль может не приехать, если политика его не отдала, — тогда заявка
// показывается без имени, но с кнопками: отвечать на неё всё равно нужно.
function personRow(profile, { note = "", actions = "" } = {}) {
  const name = String(profile?.display_name ?? "").trim() || "Без имени";
  const handle = String(profile?.handle ?? "").trim();

  return `
    <div class="set-row person-row">
      <div class="person-row__who">
        <span class="person-row__avatar">${escapeHtml(initials(name))}</span>
        <div class="set-row__text">
          <strong>${escapeHtml(name)}</strong>
          <small>${handle ? `@${escapeHtml(handle)}` : "профиль недоступен"}${
            note ? ` · ${escapeHtml(note)}` : ""
          }</small>
        </div>
      </div>
      <div class="set-row__control">${actions}</div>
    </div>`;
}
