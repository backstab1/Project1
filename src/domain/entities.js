const SCORE_STEP = 0.5;

export function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `cv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ru-RU");
}

export function requireText(value, fieldName) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new TypeError(`Поле «${fieldName}» обязательно.`);
  }
  return normalized;
}

export function normalizeScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 1 || score > 10) {
    throw new RangeError("Оценка должна быть числом от 1 до 10.");
  }

  return Math.round(score / SCORE_STEP) * SCORE_STEP;
}

export function createCategory(input = {}) {
  const now = new Date().toISOString();
  const name = requireText(input.name, "Название категории");

  return {
    id: input.id ?? createId(),
    name,
    normalizedName: normalizeText(name),
    parentId: input.parentId ?? null,
    position: Number.isInteger(input.position) ? input.position : 0,
    rollQuota: Number.isInteger(input.rollQuota) && input.rollQuota >= 0
      ? input.rollQuota
      : 0,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

export function createMovie(input = {}) {
  const now = new Date().toISOString();
  const title = requireText(input.title, "Название фильма");

  return {
    id: input.id ?? createId(),
    title,
    normalizedTitle: normalizeText(title),
    originalTitle: String(input.originalTitle ?? "").trim(),
    categoryId: input.categoryId ?? null,
    categoryPosition: Number.isInteger(input.categoryPosition)
      ? input.categoryPosition
      : 0,
    coverUrl: String(input.coverUrl ?? "").trim(),
    releaseYear: normalizeOptionalInteger(input.releaseYear, 1888, 2200),
    durationMinutes: normalizeOptionalInteger(input.durationMinutes, 1, 2000),
    country: String(input.country ?? "").trim(),
    watchedAt: normalizeOptionalDate(input.watchedAt),
    ratings: normalizeRatings(input.ratings),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

export function createFranchise(input = {}) {
  const now = new Date().toISOString();
  const name = requireText(input.name, "Название франшизы");

  return {
    id: input.id ?? createId(),
    name,
    normalizedName: normalizeText(name),
    categoryId: input.categoryId ?? null,
    categoryPosition: Number.isInteger(input.categoryPosition)
      ? input.categoryPosition
      : 0,
    movieIds: uniqueStrings(input.movieIds),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

export function createParticipant(input = {}) {
  const now = new Date().toISOString();
  const name = requireText(input.name, "Имя участника");

  return {
    id: input.id ?? createId(),
    name,
    normalizedName: normalizeText(name),
    lastUsedAt: input.lastUsedAt ?? now,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

export function upsertRating(ratings, input) {
  const participantName = requireText(input.participantName, "Имя зрителя");
  const normalizedParticipantName = normalizeText(participantName);
  const value = normalizeScore(input.value);
  const nextRatings = normalizeRatings(ratings).filter(
    (rating) => rating.normalizedParticipantName !== normalizedParticipantName,
  );

  nextRatings.push({
    id: input.id ?? createId(),
    participantName,
    normalizedParticipantName,
    value,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });

  return nextRatings;
}

export function calculateAverageRating(ratings) {
  const validRatings = normalizeRatings(ratings);
  if (validRatings.length === 0) {
    return null;
  }

  const total = validRatings.reduce((sum, rating) => sum + rating.value, 0);
  return Math.round((total / validRatings.length) * 10) / 10;
}

export function calculateFranchiseRating(franchise, movieById) {
  const movieRatings = uniqueStrings(franchise?.movieIds)
    .map((movieId) => movieById.get(movieId))
    .filter(Boolean)
    .map((movie) => calculateAverageRating(movie.ratings))
    .filter((rating) => rating !== null);

  if (movieRatings.length === 0) {
    return null;
  }

  const total = movieRatings.reduce((sum, rating) => sum + rating, 0);
  return Math.round((total / movieRatings.length) * 10) / 10;
}

function normalizeRatings(ratings) {
  if (!Array.isArray(ratings)) {
    return [];
  }

  const byParticipant = new Map();
  for (const rating of ratings) {
    try {
      const participantName = requireText(
        rating.participantName ?? rating.u,
        "Имя зрителя",
      );
      const normalizedParticipantName = normalizeText(participantName);
      byParticipant.set(normalizedParticipantName, {
        id: rating.id ?? createId(),
        participantName,
        normalizedParticipantName,
        value: normalizeScore(rating.value),
        createdAt: rating.createdAt ?? rating.date ?? new Date().toISOString(),
      });
    } catch {
      // Повреждённая оценка не должна ломать загрузку всего фильма.
    }
  }

  return [...byParticipant.values()];
}

function normalizeOptionalInteger(value, min, max) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= min && number <= max
    ? number
    : null;
}

function normalizeOptionalDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
}

