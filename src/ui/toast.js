import { icon } from "./icons.js";

const ICON_BY_TYPE = Object.freeze({
  success: "check",
  error: "warning",
  info: "info",
});

// Второй аргумент исторически был типом; объект нужен там, где у тоста есть
// действие — например «Вернуть» после удаления.
export function showToast(message, options = {}) {
  const {
    type = "success",
    duration = typeof options.actionLabel === "string" ? 8000 : 3600,
    actionLabel = null,
    onAction = null,
  } = typeof options === "string" ? { type: options } : options;

  let container = document.querySelector("#toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    container.setAttribute("aria-live", "polite");
    document.body.append(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <span class="toast__icon">${icon(ICON_BY_TYPE[type] ?? "info")}</span>
    <span class="toast__text"></span>
    ${actionLabel ? '<button class="toast__action" type="button"></button>' : ""}
    <span class="toast__bar" style="--duration:${duration}ms"></span>
  `;
  toast.querySelector(".toast__text").textContent = String(message);
  container.append(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));

  const dismiss = () => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 260);
  };

  const actionButton = toast.querySelector(".toast__action");
  if (actionButton) {
    actionButton.textContent = actionLabel;
    actionButton.addEventListener("click", (event) => {
      // Клик по действию не должен считаться закрытием тоста.
      event.stopPropagation();
      dismiss();
      onAction?.();
    });
  }

  toast.addEventListener("click", dismiss);
  setTimeout(dismiss, duration);
}
