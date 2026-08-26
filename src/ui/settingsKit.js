// Общие кирпичики технических экранов: настройки и друзья собраны из одних и
// тех же групп и строк «название — контрол», поэтому описания живут здесь, а
// не дублируются в двух модулях.

export function settingsGroup({ title, status = "", rows = [], note = "" }) {
  return `
    <section class="set-group">
      <header class="set-group__head">
        <h3>${escapeHtml(title)}</h3>
        ${status}
      </header>
      ${rows.filter(Boolean).join("")}
      ${note ? `<p class="set-group__note">${note}</p>` : ""}
    </section>`;
}

export function settingsRow({ title, hint = "", control = "" }) {
  return `
    <div class="set-row">
      <div class="set-row__text">
        <strong>${escapeHtml(title)}</strong>
        ${hint ? `<small>${hint}</small>` : ""}
      </div>
      <div class="set-row__control">${control}</div>
    </div>`;
}

export function smallButton(action, label, {
  disabled = false,
  danger = false,
  primary = false,
  dataset = {},
} = {}) {
  const modifier = danger ? "btn--danger-ghost" : primary ? "btn--primary" : "btn--ghost";
  // Имена в data-атрибутах пишутся через дефис: браузер приводит атрибут к
  // нижнему регистру, и data-userId прочитался бы как dataset.userid.
  const attributes = Object.entries(dataset)
    .map(([name, value]) =>
      `data-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${escapeAttribute(value)}"`)
    .join(" ");
  return `
    <button class="btn btn--sm ${modifier}"
      type="button" data-action="${action}" ${attributes} ${disabled ? "disabled" : ""}
    >${escapeHtml(label)}</button>`;
}

export function toggleControl(control, checked) {
  return `
    <label class="toggle">
      <input type="checkbox" data-control="${control}" ${checked ? "checked" : ""}>
      <span class="toggle__track"><span class="toggle__knob"></span></span>
    </label>`;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
