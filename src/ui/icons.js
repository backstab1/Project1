/**
 * Единый набор контурных иконок CineVault.
 * Все иконки нарисованы в сетке 24×24, используют currentColor и одинаковую
 * толщину линии, поэтому одинаково читаются в светлой и тёмной темах.
 */

const STROKE_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

const PATHS = Object.freeze({
  home: '<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15V15H9v5.5H5.5A1.5 1.5 0 0 1 4 19z"/>',
  film: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M8 4.5v15M16 4.5v15M3 9.5h5m8 0h5M3 14.5h5m8 0h5"/>',
  collection: '<path d="M7 6.5h10M5.5 3.5h13"/><rect x="3" y="9.5" width="18" height="11" rx="2.5"/><path d="m10.5 12.8 4 2.2-4 2.2z"/>',
  layers: '<path d="m12 3 8.5 4.6L12 12.2 3.5 7.6z"/><path d="m3.5 12 8.5 4.6 8.5-4.6M3.5 16.4 12 21l8.5-4.6"/>',
  eye: '<path d="M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.8"/>',
  wheel: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3.5v6.3M12 14.2v6.3M3.5 12h6.3M14.2 12h6.3"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.2"/><path d="M3.5 3.6v4.6h4.6"/><path d="M12 7.8V12l3 1.8"/>',
  settings: '<circle cx="12" cy="12" r="3.05"/><path d="M10.00 2.97A9.25 9.25 0 0 1 14.00 2.97L14.04 4.89A7.4 7.4 0 0 1 15.59 5.53L16.97 4.20A9.25 9.25 0 0 1 19.80 7.03L18.47 8.41A7.4 7.4 0 0 1 19.11 9.96L21.03 10.00A9.25 9.25 0 0 1 21.03 14.00L19.11 14.04A7.4 7.4 0 0 1 18.47 15.59L19.80 16.97A9.25 9.25 0 0 1 16.97 19.80L15.59 18.47A7.4 7.4 0 0 1 14.04 19.11L14.00 21.03A9.25 9.25 0 0 1 10.00 21.03L9.96 19.11A7.4 7.4 0 0 1 8.41 18.47L7.03 19.80A9.25 9.25 0 0 1 4.20 16.97L5.53 15.59A7.4 7.4 0 0 1 4.89 14.04L2.97 14.00A9.25 9.25 0 0 1 2.97 10.00L4.89 9.96A7.4 7.4 0 0 1 5.53 8.41L4.20 7.03A9.25 9.25 0 0 1 7.03 4.20L8.41 5.53A7.4 7.4 0 0 1 9.96 4.89Z"/>',
  star: '<path d="m12 3.8 2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 17.2l-5.25 2.75 1-5.85L3.5 9.95l5.9-.85z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 1.9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.6v2.2M12 19.2v2.2M4.35 4.35l1.55 1.55M18.1 18.1l1.55 1.55M2.6 12h2.2M19.2 12h2.2M4.35 19.65 5.9 18.1M18.1 5.9l1.55-1.55"/>',
  moon: '<path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20h4.2L19 9.2a2.1 2.1 0 0 0-3-3L5.2 17z"/><path d="M14.5 5.5 18.5 9.5"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5"/><path d="M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5"/><path d="M10.5 10.5v6M13.5 10.5v6"/>',
  arrowRight: '<path d="M5 12h13M13 6.5 18.5 12 13 17.5"/>',
  arrowUp: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
  arrowDown: '<path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/>',
  chevronDown: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  chevronRight: '<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>',
  chevronLeft: '<path d="M14.5 6.5 9 12l5.5 5.5"/>',
  sidebar: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M9.5 4.5v15"/>',
  download: '<path d="M12 3.8v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 17v1.7A1.8 1.8 0 0 0 6.3 20.5h11.4a1.8 1.8 0 0 0 1.8-1.8V17"/>',
  upload: '<path d="M12 20.2V9M7.5 13.5 12 9l4.5 4.5"/><path d="M4.5 7V5.3a1.8 1.8 0 0 1 1.8-1.8h11.4A1.8 1.8 0 0 1 19.5 5.3V7"/>',
  sparkles: '<path d="m12 3.5 1.7 4.3 4.3 1.7-4.3 1.7L12 15.5l-1.7-4.3L6 9.5l4.3-1.7z"/><path d="m18.5 15.5.85 2.15 2.15.85-2.15.85-.85 2.15-.85-2.15-2.15-.85 2.15-.85z"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  gridDense: '<rect x="3.5" y="3.5" width="5" height="5" rx="1.4"/><rect x="9.5" y="3.5" width="5" height="5" rx="1.4"/><rect x="15.5" y="3.5" width="5" height="5" rx="1.4"/><rect x="3.5" y="9.5" width="5" height="5" rx="1.4"/><rect x="9.5" y="9.5" width="5" height="5" rx="1.4"/><rect x="15.5" y="9.5" width="5" height="5" rx="1.4"/><rect x="3.5" y="15.5" width="5" height="5" rx="1.4"/><rect x="9.5" y="15.5" width="5" height="5" rx="1.4"/><rect x="15.5" y="15.5" width="5" height="5" rx="1.4"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 12.8h.01M9.5 12.8h.01M13 12.8h.01M16.5 12.8h.01M8 15.8h8"/>',
  dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01"/>',
  arrowUpLine: '<path d="M12 20V6M6 12l6-6 6 6"/>',
  list: '<path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12"/><circle cx="4.2" cy="6.5" r="1.1"/><circle cx="4.2" cy="12" r="1.1"/><circle cx="4.2" cy="17.5" r="1.1"/>',
  shield: '<path d="M12 3.2 19 6v5.6c0 4.2-2.8 7.6-7 9.2-4.2-1.6-7-5-7-9.2V6z"/><path d="m9 12 2.2 2.2L15.2 10"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6"/><path d="M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3"/>',
  users: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3.5 20c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2"/><path d="M16 5.6a3.3 3.3 0 0 1 0 6.4M17.2 14.9c2 .6 3.3 2.4 3.3 5.1"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M9.5 9.5v10M15 9.5v10"/>',
  play: '<circle cx="12" cy="12" r="8.5"/><path d="m10.2 8.8 5.3 3.2-5.3 3.2z"/>',
  ticket: '<path d="M3.5 8.5V6.8a1.3 1.3 0 0 1 1.3-1.3h14.4a1.3 1.3 0 0 1 1.3 1.3v1.7a2.5 2.5 0 0 0 0 7v1.7a1.3 1.3 0 0 1-1.3 1.3H4.8a1.3 1.3 0 0 1-1.3-1.3v-1.7a2.5 2.5 0 0 0 0-7z"/><path d="M14.5 5.5v13"/>',
  bookmark: '<path d="M6.5 4.5h11a1 1 0 0 1 1 1v15l-6.5-4-6.5 4v-15a1 1 0 0 1 1-1z"/>',
  refresh: '<path d="M20 11.5a8 8 0 1 0-.6 4.5"/><path d="M20.5 5.5v6h-6"/>',
  shuffle: '<path d="M3.5 6.5h3.2c1.3 0 2.5.7 3.2 1.8l4.2 7c.7 1.1 1.9 1.8 3.2 1.8h3.2"/><path d="M3.5 17.5h3.2c1.3 0 2.5-.7 3.2-1.8l.9-1.5M14 9.2l.3-.5c.7-1.1 1.9-1.7 3.2-1.7h3"/><path d="m17.5 4 3 3-3 3M17.5 14.5l3 3-3 3"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.9v.2"/>',
  warning: '<path d="M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.2M12 17.1v.2"/>',
  calendar: '<rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M3.5 10.5h17M8.5 3.5v4M15.5 3.5v4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.4 3.4 5.4 3.4 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.4-5.4-3.4-8.5S9.8 5.9 12 3.5z"/>',
  command: '<path d="M9 6.5a2.5 2.5 0 1 0-2.5 2.5H9zm0 0h6m-6 0v6m6-6a2.5 2.5 0 1 1 2.5 2.5H15zm0 0v6m0 0h2.5A2.5 2.5 0 1 1 15 17.5zm0 0H9m0 0v-6m0 6H6.5A2.5 2.5 0 1 0 9 17.5z"/>',
  bolt: '<path d="M13.2 2.8 4.8 13.4h6L10.8 21.2l8.4-10.6h-6z"/>',
  trophy: '<path d="M7.5 4.5h9v4.2a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H5.2a1 1 0 0 0-1 1.2 4 4 0 0 0 3.6 3.2M16.5 6h2.3a1 1 0 0 1 1 1.2 4 4 0 0 1-3.6 3.2"/><path d="M12 13.2v3.3M8.8 20.2h6.4a3.2 3.2 0 0 0-3.2-3.7 3.2 3.2 0 0 0-3.2 3.7z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1"/>',
  folder: '<path d="M3.5 7.2a2 2 0 0 1 2-2h3.3l2 2.4h7.7a2 2 0 0 1 2 2v8.2a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="8.8" cy="9.5" r="1.6"/><path d="m4 17 4.8-4.5 3.4 3.2 3-2.6 4.8 4.4"/>',
  tag: '<path d="M3.8 11.2V4.8a1 1 0 0 1 1-1h6.4a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-6.4 6.4a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7z"/><circle cx="7.9" cy="7.9" r="1.3"/>',
  user: '<circle cx="12" cy="8.2" r="3.6"/><path d="M4.8 20.2c0-3.6 3.2-6.2 7.2-6.2s7.2 2.6 7.2 6.2"/>',
  logout: '<path d="M14.5 4.5H6.8A2.3 2.3 0 0 0 4.5 6.8v10.4a2.3 2.3 0 0 0 2.3 2.3h7.7"/><path d="M11 12h9.5M17 8.5 20.5 12 17 15.5"/>',
  key: '<circle cx="8" cy="12" r="4.2"/><path d="M12.2 12h8.3M18 12v3.2M15.4 12v2.4"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7.5 6.6 4.8a1.5 1.5 0 0 0 1.8 0l6.6-4.8"/>',
  note: '<path d="M5 4.5h14v10.2L14.2 19.5H5z"/><path d="M19 14.7h-4.8v4.8M8.2 8.6h7.6M8.2 12.1h5.4"/>',
});

// Заливка нужна только там, где иконка обозначает включённое состояние.
const FILLED_PATHS = Object.freeze({
  starFilled: PATHS.star,
});

export function icon(name, className = "") {
  const filled = FILLED_PATHS[name];
  const path = filled ?? PATHS[name];
  if (!path) return "";
  const classAttribute = className ? ` class="${className}"` : "";
  const attributes = filled
    ? STROKE_ATTRS.replace('fill="none"', 'fill="currentColor"')
    : STROKE_ATTRS;
  return `<svg${classAttribute} ${attributes}>${path}</svg>`;
}

export const ICON_NAMES = Object.freeze([
  ...Object.keys(PATHS),
  ...Object.keys(FILLED_PATHS),
]);
