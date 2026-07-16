let activeSubmitHandler = null;

export function openDialog({
  title,
  body,
  submitLabel = "Сохранить",
  onSubmit,
}) {
  const dialog = document.querySelector("#entity-dialog");
  const form = dialog.querySelector("form");
  dialog.querySelector("#dialog-title").textContent = title;
  dialog.querySelector("#dialog-body").innerHTML = body;
  dialog.querySelector("[data-dialog-submit]").textContent = submitLabel;
  dialog.querySelector("[data-dialog-error]").textContent = "";
  activeSubmitHandler = onSubmit;

  form.onsubmit = handleSubmit;
  dialog.showModal();
  focusFirstControl(dialog);
}

export function closeDialog() {
  const dialog = document.querySelector("#entity-dialog");
  activeSubmitHandler = null;
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
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("[data-dialog-submit]");
  const errorNode = form.querySelector("[data-dialog-error]");
  submitButton.disabled = true;
  errorNode.textContent = "";

  try {
    await activeSubmitHandler?.(new FormData(form));
    closeDialog();
  } catch (error) {
    errorNode.textContent = error instanceof Error
      ? error.message
      : String(error);
  } finally {
    submitButton.disabled = false;
  }
}

function focusFirstControl(dialog) {
  requestAnimationFrame(() => {
    dialog.querySelector("input, select, button")?.focus();
  });
}

