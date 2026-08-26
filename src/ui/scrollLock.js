// Блокировка прокрутки фона под оверлеями.
//
// Оверлеев несколько — шторка фильма, модальная форма, палитра команд — и они
// накладываются друг на друга: из карточки фильма открывается диалог оценки.
// Если каждый снимает класс сам, закрытый диалог разблокирует страницу под
// всё ещё открытой шторкой, и фон начинает ездить. Поэтому замки считаются
// по ключам: класс снимается, когда отпущен последний.

const locks = new Set();

export function lockScroll(key) {
  locks.add(key);
  document.body.classList.add("has-overlay");
}

export function unlockScroll(key) {
  locks.delete(key);
  if (locks.size === 0) {
    document.body.classList.remove("has-overlay");
  }
}

export function setScrollLock(key, active) {
  if (active) {
    lockScroll(key);
  } else {
    unlockScroll(key);
  }
}
