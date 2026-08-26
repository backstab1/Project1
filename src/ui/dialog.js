import { lockScroll, unlockScroll } from "./scrollLock.js";

let activeSubmitHandler = null;
let activeSuccessHandler = null;

export function openDialog({
  title,
  body,
  submitLabel = "Сохранить",
  variant = "",
  onSubmit,
  onSuccess = null,
}) {
  const dialog = document.querySelector("#entity-dialog");
  const form = dialog.querySelector("form");
  dialog.dataset.variant = variant;
  dialog.querySelector("#dialog-title").textContent = title;
  dialog.querySelector("#dialog-body").innerHTML = body;
  dialog.querySelector("[data-dialog-submit]").textContent = submitLabel;
  setError(dialog, "");
  activeSubmitHandler = onSubmit;
  activeSuccessHandler = onSuccess;

  form.onsubmit = handleSubmit;
  dialog.showModal();
  lockScroll("dialog");
  focusFirstControl(dialog);
}

export function closeDialog() {
  const dialog = document.querySelector("#entity-dialog");
  activeSubmitHandler = null;
  activeSuccessHandler = null;
  unlockScroll("dialog");
  dialog?.close();
}

export function setupDialog() {
  const dialog = document.querySelector("#entity-dialog");
  if (!dialog) {
    return;
  }

  dialog.querySelectorAll("[data-dialog-close]").forEach((button) => {
    button.addEventListener("click", closeDialog);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      closeDialog();
    }
  });
  dialog.addEventListener("close", () => {
    unlockScroll("dialog");
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const dialog = form.closest("dialog");
  const submitButton = form.querySelector("[data-dialog-submit]");
  submitButton.disabled = true;
  submitButton.classList.add("is-busy");
  setError(dialog, "");

  try {
    await activeSubmitHandler?.(new FormData(form));
    const onSuccess = activeSuccessHandler;
    closeDialog();
    onSuccess?.();
  } catch (error) {
    setError(
      dialog,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    submitButton.disabled = false;
    submitButton.classList.remove("is-busy");
  }
}

function setError(dialog, message) {
  const errorNode = dialog?.querySelector("[data-dialog-error]");
  if (!errorNode) return;
  errorNode.textContent = message;
  errorNode.classList.toggle("is-visible", Boolean(message));
}

function focusFirstControl(dialog) {
  requestAnimationFrame(() => {
    const body = dialog.querySelector("#dialog-body");
    const control = body?.querySelector(
      "input:not([type=hidden]), select, textarea, button",
    );
    (control ?? dialog.querySelector("[data-dialog-submit]"))?.focus();
  });
}
