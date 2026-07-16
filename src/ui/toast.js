export function showToast(message, type = "success", duration = 3200) {
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
  toast.textContent = String(message);
  container.append(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));

  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

