/**
 * Отрисовка колеса кинорулетки.
 * Учитывает плотность пикселей экрана, текущую тему и рисует сегменты
 * градиентами, чтобы колесо выглядело одинаково хорошо в обеих темах.
 */

const PALETTES = Object.freeze({
  dark: {
    segments: [
      ["#8b5cf6", "#6d3bf0"],
      ["#1f2233", "#171a29"],
      ["#f0a93b", "#d9832b"],
      ["#242840", "#1b1e30"],
    ],
    segmentText: ["#ffffff", "#e7e5f4", "#231604", "#e7e5f4"],
    rim: "rgba(255, 255, 255, 0.14)",
    divider: "rgba(255, 255, 255, 0.12)",
    hub: "#12131f",
    hubRing: "#f0a93b",
    hubText: "#f6f4ff",
    glow: "rgba(139, 92, 246, 0.45)",
  },
  light: {
    segments: [
      ["#7c5cff", "#5f3fe0"],
      ["#ffffff", "#eceaf7"],
      ["#f5a524", "#e08a12"],
      ["#f3f1fb", "#e2ddf3"],
    ],
    segmentText: ["#ffffff", "#3b3552", "#2a1a02", "#3b3552"],
    rim: "rgba(38, 30, 66, 0.14)",
    divider: "rgba(38, 30, 66, 0.12)",
    hub: "#ffffff",
    hubRing: "#7c5cff",
    hubText: "#2b2545",
    glow: "rgba(124, 92, 255, 0.35)",
  },
});

export function drawWheel(canvas, pool, rotation = 0, options = {}) {
  if (!canvas || !Array.isArray(pool) || pool.length === 0) return;

  const theme = options.theme
    ?? canvas.dataset.theme
    ?? globalThis.document?.documentElement?.dataset?.theme
    ?? "dark";
  canvas.dataset.theme = theme;
  const palette = PALETTES[theme] ?? PALETTES.dark;

  const context = canvas.getContext("2d");
  const size = prepareCanvas(canvas, context);
  const center = size / 2;
  const radius = center - size * 0.035;
  const arc = (Math.PI * 2) / pool.length;

  context.clearRect(0, 0, size, size);

  // Внешнее свечение колеса.
  context.save();
  context.shadowColor = palette.glow;
  context.shadowBlur = size * 0.06;
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fillStyle = palette.hub;
  context.fill();
  context.restore();

  pool.forEach((item, index) => {
    const start = index * arc + rotation - Math.PI / 2;
    const end = start + arc;
    const paletteIndex = pool.length === 2
      ? index * 2
      : index % palette.segments.length;
    const [from, to] = palette.segments[paletteIndex % palette.segments.length];

    const gradient = context.createRadialGradient(
      center, center, radius * 0.16, center, center, radius,
    );
    gradient.addColorStop(0, to);
    gradient.addColorStop(1, from);

    context.beginPath();
    context.moveTo(center, center);
    context.arc(center, center, radius, start, end);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();
    context.strokeStyle = palette.divider;
    context.lineWidth = Math.max(1, size * 0.002);
    context.stroke();

    const middle = start + arc / 2;
    const flipped = Math.cos(middle) < 0;
    context.save();
    context.translate(center, center);
    context.rotate(flipped ? middle + Math.PI : middle);
    context.fillStyle = palette.segmentText[
      paletteIndex % palette.segmentText.length
    ];
    const fontSize = getFontSize(pool.length, size);
    context.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
    context.textAlign = flipped ? "left" : "right";
    context.textBaseline = "middle";
    context.fillText(
      shorten(item.title, pool.length),
      flipped ? -(radius - size * 0.045) : radius - size * 0.045,
      0,
    );
    context.restore();
  });

  // Ободок.
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.strokeStyle = palette.rim;
  context.lineWidth = Math.max(2, size * 0.012);
  context.stroke();

  // Насечки по ободу.
  context.save();
  context.translate(center, center);
  context.fillStyle = palette.rim;
  for (let index = 0; index < pool.length; index += 1) {
    context.save();
    context.rotate(index * arc + rotation - Math.PI / 2);
    context.beginPath();
    context.arc(radius - size * 0.012, 0, Math.max(1.5, size * 0.005), 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
  context.restore();

  // Центральная втулка.
  const hubRadius = size * 0.085;
  context.beginPath();
  context.arc(center, center, hubRadius, 0, Math.PI * 2);
  context.fillStyle = palette.hub;
  context.fill();
  context.lineWidth = Math.max(2, size * 0.008);
  context.strokeStyle = palette.hubRing;
  context.stroke();

  context.fillStyle = palette.hubText;
  context.font = `800 ${Math.round(size * 0.045)}px "Segoe UI", system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("CV", center, center + size * 0.002);
}

export function animateWheel(canvas, pool, selectedIndex, duration = 3400) {
  if (!canvas || pool.length < 2) {
    return Promise.resolve();
  }

  const arc = (Math.PI * 2) / pool.length;
  const selectedCenter = selectedIndex * arc + arc / 2;
  const targetBase = normalizeAngle(-selectedCenter);
  const totalRotation = Math.PI * 2 * 8 + targetBase;
  const startedAt = performance.now();
  const audio = createAudioFeedback();
  const reducedMotion = globalThis.matchMedia?.(
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
  if (count > 20) return Math.max(9, 12 * base);
  if (count > 12) return Math.max(10, 14 * base);
  return Math.max(12, 17 * base);
}

function shorten(value, count) {
  const limit = count > 20 ? 14 : count > 12 ? 18 : 24;
  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
