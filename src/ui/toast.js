import { icon } from "./icons.js";

const ICON_BY_TYPE = Object.freeze({
  success: "check",
  error: "warning",
  info: "info",
});

export function showToast(message, type = "success", duration = 3600) {
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
    <span class="toast__bar" style="--duration:${duration}ms"></span>
  `;
  toast.querySelector(".toast__text").textContent = String(message);
  container.append(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));

  const dismiss = () => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 260);
  };
  toast.addEventListener("click", dismiss);
  setTimeout(dismiss, duration);
}
