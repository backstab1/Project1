const COLORS = [
  ["#e5b74f", "#17130a"],
  ["#202735", "#f3f1ea"],
];

export function drawWheel(canvas, pool, rotation = 0) {
  if (!canvas || !Array.isArray(pool) || pool.length === 0) {
    return;
  }

  const context = canvas.getContext("2d");
  const size = canvas.width;
  const center = size / 2;
  const radius = center - 8;
  const arc = (Math.PI * 2) / pool.length;
  context.clearRect(0, 0, size, size);

  pool.forEach((item, index) => {
    const start = index * arc + rotation;
    const end = start + arc;
    const [background, foreground] = COLORS[index % COLORS.length];

    context.beginPath();
    context.moveTo(center, center);
    context.arc(center, center, radius, start, end);
    context.closePath();
    context.fillStyle = background;
    context.fill();
    context.strokeStyle = "rgba(255,255,255,0.13)";
    context.lineWidth = 1;
    context.stroke();

    context.save();
    context.translate(center, center);
    context.rotate(start + arc / 2);
    context.fillStyle = foreground;
    context.font = `700 ${getFontSize(pool.length)}px system-ui`;
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(shorten(item.title, pool.length), radius - 20, 0);
    context.restore();
  });

  context.beginPath();
  context.arc(center, center, 34, 0, Math.PI * 2);
  context.fillStyle = "#0a0b0f";
  context.fill();
  context.strokeStyle = "#f6d882";
  context.lineWidth = 4;
  context.stroke();
}

export function animateWheel(canvas, pool, selectedIndex, duration = 3200) {
  if (!canvas || pool.length < 2) {
    return Promise.resolve();
  }

  const arc = (Math.PI * 2) / pool.length;
  const selectedCenter = selectedIndex * arc + arc / 2;
  const targetBase = normalizeAngle(-selectedCenter);
  const totalRotation = Math.PI * 2 * 8 + targetBase;
  const startedAt = performance.now();

  return new Promise((resolve) => {
    const frame = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      drawWheel(canvas, pool, totalRotation * eased);
      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}

function normalizeAngle(value) {
  const full = Math.PI * 2;
  return ((value % full) + full) % full;
}

function getFontSize(count) {
  if (count > 30) return 9;
  if (count > 20) return 10;
  if (count > 12) return 12;
  return 14;
}

function shorten(value, count) {
  const limit = count > 20 ? 14 : count > 12 ? 18 : 24;
  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

