/**
 * Отрисовка колеса кинорулетки.
 *
 * Колесо — главный экран вечера, и выглядеть оно должно соответственно. Два
 * тона темы, которыми оно рисовалось раньше, читались как таблица, свёрнутая
 * в круг: ни одного повода смотреть. Теперь каждый сектор берёт собственный
 * оттенок по названию фильма — ровно тот же, каким каталог рисует карточку без
 * обложки. Колесо стало цветным, но не чужим: оттенки те же, что уже есть на
 * экране рядом.
 *
 * Объём даёт не тень под кругом, а три слоя: обод с металлическим переходом,
 * блик по верхней половине и затемнение к втулке. Победитель после остановки
 * подсвечивается, остальные гаснут.
 *
 * Цвета берутся из токенов CSS, поэтому обе темы получаются сами собой и не
 * расходятся с карточками рядом.
 */

import { titleHue } from "./titleColor.js";

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

// Те же значения, которыми styles.css рисует заглушку карточки без обложки.
// Держим их здесь одним местом: разойдутся — колесо и каталог станут разными
// приложениями.
const SECTOR = Object.freeze({
  // Насыщеннее, чем заглушка карточки: та лежит под текстом и обязана быть
  // тихой, а колесо смотрят целиком и в упор.
  dark: {
    outer: [54, 44], inner: [48, 26],
    divider: "rgba(255, 255, 255, 0.24)",
    text: "#ffffff", shadow: "rgba(0, 0, 0, 0.45)",
  },
  light: {
    outer: [58, 66], inner: [54, 52],
    divider: "rgba(24, 20, 48, 0.16)",
    text: "#16142e", shadow: "rgba(255, 255, 255, 0.5)",
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
  const palette = SECTOR[theme] ?? SECTOR.dark;
  const highlight = Number.isInteger(options.highlightIndex)
    ? options.highlightIndex
    : -1;

  const context = canvas.getContext("2d");
  const size = prepareCanvas(canvas, context);
  const center = size / 2;
  const rim = center - size * 0.02;
  const outer = rim - size * 0.026;
  const inner = outer * 0.3;
  const arc = (Math.PI * 2) / pool.length;

  context.clearRect(0, 0, size, size);

  drawRim(context, center, rim, outer, tokens, theme);

  pool.forEach((item, index) => {
    // Секторы смыкаются вплотную: чёрные клинья между ними читались как
    // трещины в круге. Границу держит светлый волосок по краю сектора.
    const start = index * arc + rotation - Math.PI / 2;
    const end = start + arc;
    const hue = titleHue(item.title);
    const dimmed = highlight >= 0 && highlight !== index;

    context.save();
    context.beginPath();
    context.arc(center, center, outer, start, end);
    context.arc(center, center, inner, end, start, true);
    context.closePath();

    // Переход идёт от обода к втулке: светлее у края, глубже к центру —
    // так кольцо выглядит выпуклым, а подписи не спорят с фоном.
    const gradient = context.createRadialGradient(
      center, center, inner,
      center, center, outer,
    );
    gradient.addColorStop(0, hsl(hue + 18, palette.inner[0], palette.inner[1]));
    gradient.addColorStop(1, hsl(hue, palette.outer[0], palette.outer[1]));
    context.fillStyle = gradient;
    context.globalAlpha = dimmed ? 0.22 : 1;
    context.fill();

    if (highlight === index) {
      context.globalAlpha = 1;
      context.strokeStyle = tokens.accent;
      context.lineWidth = Math.max(2, size * 0.007);
      context.stroke();
    }
    context.restore();

    const middle = start + (end - start) / 2;
    const flipped = Math.cos(middle) < 0;
    context.save();
    context.translate(center, center);
    context.rotate(flipped ? middle + Math.PI : middle);
    context.globalAlpha = dimmed ? 0.3 : 1;
    context.fillStyle = palette.text;
    // Тень под подписью: оттенки секторов разной светлоты, и без неё текст
    // то тонет, то режет глаз.
    context.shadowColor = palette.shadow;
    context.shadowBlur = size * 0.012;
    context.font = `600 ${getFontSize(pool.length, size)}px "Segoe UI", system-ui, sans-serif`;
    context.textAlign = flipped ? "left" : "right";
    context.textBaseline = "middle";
    // Подпись живёт в кольце между втулкой и ободом. Ширину считаем по факту,
    // а не по числу символов: иначе длинное название заезжало на втулку.
    const padding = size * 0.042;
    const band = outer - inner - padding * 2;
    const label = fitText(context, item.title, band);
    context.fillText(label, flipped ? -(outer - padding) : outer - padding, 0);
    context.restore();
  });

  // Разделители — отдельным проходом поверх всех заливок. Внутри цикла
  // граница сектора закрашивалась следующим соседом, и волосок оставался
  // виден только у последнего.
  context.save();
  context.strokeStyle = palette.divider;
  context.lineWidth = Math.max(1, size * 0.0022);
  for (let index = 0; index < pool.length; index += 1) {
    const angle = index * arc + rotation - Math.PI / 2;
    context.beginPath();
    context.moveTo(
      center + Math.cos(angle) * inner,
      center + Math.sin(angle) * inner,
    );
    context.lineTo(
      center + Math.cos(angle) * outer,
      center + Math.sin(angle) * outer,
    );
    context.stroke();
  }
  context.restore();

  drawGloss(context, center, outer, inner, theme);
  drawHub(context, center, inner, size, tokens, theme);
}

// Обод: узкое кольцо с переходом сверху вниз. Он же прячет края секторов,
// поэтому зазоры не выглядят обрывами.
function drawRim(context, center, rim, outer, tokens, theme) {
  const gradient = context.createLinearGradient(
    center - rim, center - rim, center + rim, center + rim,
  );
  if (theme === "light") {
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.45, "#e8e5f3");
    gradient.addColorStop(1, "#b9b4cc");
  } else {
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.42)");
    gradient.addColorStop(0.45, "rgba(255, 255, 255, 0.14)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0.06)");
  }

  context.save();
  // Круг лежит не на плоскости, а над ней: мягкая тень отделяет его от фона.
  context.shadowColor = theme === "light"
    ? "rgba(28, 20, 62, 0.22)"
    : "rgba(0, 0, 0, 0.55)";
  context.shadowBlur = (rim - outer) * 2.6;
  context.shadowOffsetY = (rim - outer) * 0.5;
  context.beginPath();
  context.arc(center, center, rim, 0, Math.PI * 2);
  context.arc(center, center, outer, Math.PI * 2, 0, true);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();
  context.restore();

  // Два волоска: снаружи очерчивает оправу, внутри отделяет её от секторов.
  context.save();
  context.strokeStyle = tokens.border;
  context.lineWidth = 1;
  context.beginPath();
  context.arc(center, center, rim, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(center, center, outer, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

// Блик по верхней половине: одна дуга низкой прозрачности. Без него кольцо
// плоское, с ним — стеклянное.
function drawGloss(context, center, outer, inner, theme) {
  const gradient = context.createLinearGradient(
    center - outer, center - outer, center + outer * 0.2, center + outer * 0.6,
  );
  gradient.addColorStop(0, theme === "light"
    ? "rgba(255, 255, 255, 0.62)"
    : "rgba(255, 255, 255, 0.22)");
  gradient.addColorStop(0.55, "rgba(255, 255, 255, 0.04)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  context.save();
  context.beginPath();
  context.arc(center, center, outer, 0, Math.PI * 2);
  context.arc(center, center, inner, Math.PI * 2, 0, true);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();
  context.restore();
}

// Втулка: поверхность карточки, тонкое кольцо и монограмма. Монограмма
// появляется только когда колесо достаточно велико, чтобы её было видно.
function drawHub(context, center, inner, size, tokens, theme) {
  context.save();
  context.beginPath();
  context.arc(center, center, inner, 0, Math.PI * 2);
  const gradient = context.createRadialGradient(
    center, center - inner * 0.4, inner * 0.1,
    center, center, inner,
  );
  gradient.addColorStop(0, theme === "light" ? "#ffffff" : tokens.surfaceAlt);
  gradient.addColorStop(1, tokens.surface);
  context.fillStyle = gradient;
  context.fill();
  context.strokeStyle = tokens.border;
  context.lineWidth = 1;
  context.stroke();

  context.beginPath();
  context.arc(center, center, inner * 0.78, 0, Math.PI * 2);
  context.strokeStyle = tokens.accentSoft;
  context.lineWidth = Math.max(1, size * 0.003);
  context.stroke();

  if (inner > size * 0.09) {
    context.fillStyle = tokens.textMuted;
    context.font = `700 ${Math.round(inner * 0.44)}px "Segoe UI", system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.globalAlpha = 0.75;
    context.fillText("CV", center, center + inner * 0.02);
  }
  context.restore();
}

/**
 * Вращение с торможением.
 *
 * Интрига живёт в последних секундах: колесо должно доползать до сектора, а не
 * подъезжать к нему. Поэтому торможение не одно на весь путь — сначала короткий
 * разгон, потом длинный выбег пятой степени, и последние градусы проходят почти
 * ползком.
 *
 * `startAt` и `turns` приходят снаружи, из события журнала: в совместной сессии
 * все браузеры обязаны крутить одинаково и начинать одновременно. Локальная
 * игра просто не передаёт их.
 */
export function animateWheel(canvas, pool, selectedIndex, options = {}) {
  const {
    duration = 7200,
    turns = 6,
    startAt = null,
    soundEnabled = true,
    reducedMotion: forcedReducedMotion = false,
    onTick = null,
  } = options;

  if (!canvas || pool.length < 2) {
    return Promise.resolve();
  }

  const arc = (Math.PI * 2) / pool.length;
  const selectedCenter = selectedIndex * arc + arc / 2;
  const targetBase = normalizeAngle(-selectedCenter);
  const totalRotation = Math.PI * 2 * turns + targetBase;
  const audio = soundEnabled ? createAudioFeedback() : SILENT_AUDIO;
  // Настройка приложения имеет приоритет над системной, но не отменяет её.
  const reducedMotion = forcedReducedMotion || globalThis.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  let previousSegment = -1;

  if (reducedMotion) {
    drawWheel(canvas, pool, targetBase, { highlightIndex: selectedIndex });
    audio.finish();
    return Promise.resolve();
  }

  // Общее время старта: у всех участников сессии колесо трогается в один и тот
  // же момент по часам, а не «когда доставили событие».
  const begins = startAt ? new Date(startAt).getTime() : Date.now();

  return new Promise((resolve) => {
    const frame = () => {
      const elapsed = Date.now() - begins;
      if (elapsed < 0) {
        drawWheel(canvas, pool, 0);
        requestAnimationFrame(frame);
        return;
      }

      const progress = Math.min(1, elapsed / duration);
      const rotation = totalRotation * spinEasing(progress);
      drawWheel(canvas, pool, rotation);

      const segment = Math.floor(rotation / arc);
      if (segment !== previousSegment) {
        previousSegment = segment;
        audio.tick();
        onTick?.();
      }

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        drawWheel(canvas, pool, targetBase, { highlightIndex: selectedIndex });
        audio.finish();
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}

// Разгон и выбег одной кривой, без склейки кусков: в начале вес у плавного
// входа в скорость, к концу — у выбега пятой степени. Последняя секунда
// проходит доли сектора, и по щелчкам слышно, как колесо решает.
function spinEasing(progress) {
  const t = Math.min(1, Math.max(0, progress));
  const soft = t * t * (3 - 2 * t);
  const tail = 1 - Math.pow(1 - t, 5);
  return soft * (1 - t) + tail * t;
}

function hsl(hue, saturation, lightness) {
  return `hsl(${((hue % 360) + 360) % 360} ${saturation}% ${lightness}%)`;
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
