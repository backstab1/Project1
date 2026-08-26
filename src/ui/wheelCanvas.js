/**
 * Отрисовка колеса кинорулетки.
 *
 * Колесо — не игрушечная рулетка из четырёх цветов, а часть той же системы,
 * что и остальной интерфейс: кольцо сегментов в двух тонах темы, тонкие
 * зазоры между ними и пустая середина, где стоит втулка. Цвета берутся из
 * токенов CSS, поэтому обе темы получаются сами собой и не расходятся с
 * карточками рядом.
 */

const FALLBACK_TOKENS = Object.freeze({
  dark: {
    surface: "#100c28",
    surfaceAlt: "#181236",
    accent: "#5046e4",
    accentSoft: "#2a2166",
    border: "rgba(163, 158, 186, 0.18)",
    text: "#f4f0ff",
    textMuted: "#a8a6b7",
    canvas: "#05031a",
  },
  light: {
    surface: "#ffffff",
    surfaceAlt: "#f7f5fd",
    accent: "#5046e4",
    accentSoft: "#e6e1fb",
    border: "rgba(28, 20, 62, 0.16)",
    text: "#1c143e",
    textMuted: "#58527a",
    canvas: "#f4f2fb",
  },
});

// Токены читаются с корня документа: тема уже проставлена там атрибутом, и
// второй список цветов в JS разошёлся бы с CSS при первой же правке палитры.
function readTokens(theme) {
  const fallback = FALLBACK_TOKENS[theme] ?? FALLBACK_TOKENS.dark;
  const root = globalThis.document?.documentElement;
  if (!root || !globalThis.getComputedStyle) return fallback;

  const styles = globalThis.getComputedStyle(root);
  const read = (name, value) => styles.getPropertyValue(name).trim() || value;

  return {
    surface: read("--surface", fallback.surface),
    surfaceAlt: read("--surface-3", fallback.surfaceAlt),
    accent: read("--accent-fill", fallback.accent),
    accentSoft: read("--accent-soft", fallback.accentSoft),
    border: read("--border-strong", fallback.border),
    text: read("--text", fallback.text),
    textMuted: read("--text-muted", fallback.textMuted),
    canvas: read("--bg", fallback.canvas),
  };
}

export function drawWheel(canvas, pool, rotation = 0, options = {}) {
  if (!canvas || !Array.isArray(pool) || pool.length === 0) return;

  const theme = options.theme
    ?? canvas.dataset.theme
    ?? globalThis.document?.documentElement?.dataset?.theme
    ?? "dark";
  canvas.dataset.theme = theme;
  const tokens = readTokens(theme);

  const context = canvas.getContext("2d");
  const size = prepareCanvas(canvas, context);
  const center = size / 2;
  const outer = center - size * 0.02;
  const inner = outer * 0.3;
  const arc = (Math.PI * 2) / pool.length;
  // Зазор считается в пикселях и переводится в радианы по внешнему радиусу:
  // на многолюдном колесе постоянный угол съедал бы сами сектора. Щель между
  // секторами важнее чередования цветов: при нечётном числе участников два
  // одинаковых сектора всё равно читаются как разные.
  const gap = Math.min(arc * 0.14, (size * 0.014) / outer);

  context.clearRect(0, 0, size, size);

  pool.forEach((item, index) => {
    const start = index * arc + rotation - Math.PI / 2 + gap / 2;
    const end = start + arc - gap;
    const accented = index % 2 === 0;

    context.beginPath();
    context.arc(center, center, outer, start, end);
    context.arc(center, center, inner, end, start, true);
    context.closePath();
    context.fillStyle = accented ? tokens.accent : tokens.surfaceAlt;
    context.fill();

    const middle = start + (end - start) / 2;
    const flipped = Math.cos(middle) < 0;
    context.save();
    context.translate(center, center);
    context.rotate(flipped ? middle + Math.PI : middle);
    context.fillStyle = accented ? "#ffffff" : tokens.text;
    context.font = `500 ${getFontSize(pool.length, size)}px "Segoe UI", system-ui, sans-serif`;
    context.textAlign = flipped ? "left" : "right";
    context.textBaseline = "middle";
    // Подпись живёт в кольце между втулкой и ободом. Ширину считаем по факту,
    // а не по числу символов: иначе длинное название заезжало на втулку.
    const padding = size * 0.022;
    const band = outer - inner - padding * 2;
    const label = fitText(context, item.title, band);
    context.fillText(label, flipped ? -(outer - padding) : outer - padding, 0);
    context.restore();
  });

  // Тонкие обводки: внешняя очерчивает круг, внутренняя отделяет втулку.
  context.strokeStyle = tokens.border;
  context.lineWidth = 1;
  context.beginPath();
  context.arc(center, center, outer, 0, Math.PI * 2);
  context.stroke();

  // Втулка: та же поверхность, что у карточек, с волоском по краю.
  context.beginPath();
  context.arc(center, center, inner, 0, Math.PI * 2);
  context.fillStyle = tokens.surface;
  context.fill();
  context.strokeStyle = tokens.border;
  context.lineWidth = 1;
  context.stroke();

  context.beginPath();
  context.arc(center, center, size * 0.018, 0, Math.PI * 2);
  context.fillStyle = tokens.accent;
  context.fill();
}

export function animateWheel(canvas, pool, selectedIndex, options = {}) {
  const {
    duration = 3400,
    soundEnabled = true,
    reducedMotion: forcedReducedMotion = false,
  } = options;

  if (!canvas || pool.length < 2) {
    return Promise.resolve();
  }

  const arc = (Math.PI * 2) / pool.length;
  const selectedCenter = selectedIndex * arc + arc / 2;
  const targetBase = normalizeAngle(-selectedCenter);
  const totalRotation = Math.PI * 2 * 8 + targetBase;
  const startedAt = performance.now();
  const audio = soundEnabled ? createAudioFeedback() : SILENT_AUDIO;
  // Настройка приложения имеет приоритет над системной, но не отменяет её.
  const reducedMotion = forcedReducedMotion || globalThis.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  let previousSegment = -1;

  if (reducedMotion) {
    drawWheel(canvas, pool, targetBase);
    audio.finish();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const frame = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      const rotation = totalRotation * eased;
      drawWheel(canvas, pool, rotation);
      const segment = Math.floor(rotation / arc);
      if (segment !== previousSegment) {
        previousSegment = segment;
        audio.tick();
      }
      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        audio.finish();
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}

function prepareCanvas(canvas, context) {
  const ratio = globalThis.devicePixelRatio || 1;
  const logicalSize = Number(canvas.dataset.logicalSize)
    || canvas.getBoundingClientRect().width
    || canvas.width;
  canvas.dataset.logicalSize = String(logicalSize);

  const backingSize = Math.round(logicalSize * ratio);
  if (canvas.width !== backingSize || canvas.height !== backingSize) {
    canvas.width = backingSize;
    canvas.height = backingSize;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return logicalSize;
}

const SILENT_AUDIO = Object.freeze({ tick() {}, finish() {} });

function createAudioFeedback() {
  const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContext) {
    return { tick() {}, finish() {} };
  }

  let context;
  try {
    context = new AudioContext();
  } catch {
    return { tick() {}, finish() {} };
  }

  const tone = (frequency, duration, volume, type = "sine") => {
    if (context.state === "suspended") {
      context.resume().catch(() => {});
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  };

  return {
    tick() {
      tone(760, 0.025, 0.025, "triangle");
    },
    finish() {
      tone(523.25, 0.2, 0.06);
      setTimeout(() => tone(659.25, 0.2, 0.05), 90);
      setTimeout(() => tone(783.99, 0.3, 0.045), 180);
      setTimeout(() => context.close().catch(() => {}), 900);
    },
  };
}

function normalizeAngle(value) {
  const full = Math.PI * 2;
  return ((value % full) + full) % full;
}

function getFontSize(count, size) {
  const base = size / 620;
  if (count > 30) return Math.max(8, 10 * base);
  if (count > 20) return Math.max(9, 11 * base);
  if (count > 12) return Math.max(10, 13 * base);
  return Math.max(11, 15 * base);
}

// Обрезка по фактической ширине: у кириллицы и латиницы разная плотность,
// и лимит в символах давал то дыру, то наезд на втулку.
function fitText(context, value, maxWidth) {
  const text = String(value ?? "");
  if (maxWidth <= 0) return "";
  if (context.measureText(text).width <= maxWidth) return text;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${text.slice(0, middle).trimEnd()}…`;
    if (context.measureText(candidate).width <= maxWidth) low = middle;
    else high = middle - 1;
  }

  return low > 0 ? `${text.slice(0, low).trimEnd()}…` : "";
}
