const SCORE_STEP = 0.5;

// Статус и дата просмотра — одна и та же величина с двух сторон, поэтому
// согласуются в единственном месте: в createMovie. Остальной код по-прежнему
// может просто выставить watchedAt, и статус подтянется сам.
export const MOVIE_STATUS = Object.freeze({
  queued: "queued",
  watching: "watching",
  watched: "watched",
  dropped: "dropped",
});

export const MOVIE_STATUS_LABELS = Object.freeze({
  queued: "В очереди",
  watching: "Смотрю",
  watched: "Просмотрен",
  dropped: "Брошен",
});

const NOTES_MAX_LENGTH = 2000;
const TAG_MAX_LENGTH = 40;
const TAGS_MAX_COUNT = 12;

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
  const name = requireText(input.name, "Название списка");

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
    tmdbId: normalizeOptionalInteger(input.tmdbId, 1, Number.MAX_SAFE_INTEGER),
    overview: String(input.overview ?? "").trim(),
    genres: uniqueStrings(
      Array.isArray(input.genres)
        ? input.genres.filter((genre) => typeof genre === "string")
          .map((genre) => genre.trim())
        : [],
    ),
    tmdbUpdatedAt: normalizeOptionalDate(input.tmdbUpdatedAt),
    categoryId: input.categoryId ?? null,
    categoryPosition: Number.isInteger(input.categoryPosition)
      ? input.categoryPosition
      : 0,
    coverUrl: String(input.coverUrl ?? "").trim(),
    // Путь постера в TMDB: картинку отдаёт их CDN, у себя храним только путь.
    posterPath: normalizePosterPath(input.posterPath),
    releaseYear: normalizeOptionalInteger(input.releaseYear, 1888, 2200),
    durationMinutes: normalizeOptionalInteger(input.durationMinutes, 1, 2000),
    country: String(input.country ?? "").trim(),
    tags: normalizeTags(input.tags),
    notes: String(input.notes ?? "").trim().slice(0, NOTES_MAX_LENGTH),
    isFavorite: Boolean(input.isFavorite),
    ...resolveWatchState(input),
    ratings: normalizeRatings(input.ratings),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

// Путь вида «/abc123.jpg» приходит из ответа TMDB и попадает в адрес картинки,
// поэтому проверяется по форме, а не переносится как есть.
function normalizePosterPath(value) {
  const path = String(value ?? "").trim();
  return /^\/[A-Za-z0-9._-]+$/.test(path) ? path : "";
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

// Зритель — это аккаунт: participantUserId приходит из профиля, имя рядом
// хранится снимком, чтобы старые сессии читались и без сети. Оценки без
// participantUserId остались от версии с ручным вводом имён.
export function upsertRating(ratings, input) {
  const participantUserId = normalizeUserId(input.participantUserId);
  const participantName = requireText(input.participantName, "Имя зрителя");
  const normalizedParticipantName = normalizeText(participantName);
  const value = normalizeScore(input.value);

  const nextRatings = normalizeRatings(ratings).filter((rating) => {
    if (participantUserId) {
      // Оценка аккаунта заменяет и свою прежнюю, и безымянную оценку с тем же
      // именем: иначе один человек считался бы в среднем дважды.
      if (rating.participantUserId) {
        return rating.participantUserId !== participantUserId;
      }
      return rating.normalizedParticipantName !== normalizedParticipantName;
    }
    return (
      Boolean(rating.participantUserId) ||
      rating.normalizedParticipantName !== normalizedParticipantName
    );
  });

  nextRatings.push({
    id: input.id ?? createId(),
    participantUserId,
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

function resolveWatchState(input) {
  const watchedAt = normalizeOptionalDate(input.watchedAt);
  const requested = input.status;

  // Дата просмотра — сильнее статуса: её выставляет колесо и ручная отметка.
  if (watchedAt) {
    return { status: MOVIE_STATUS.watched, watchedAt };
  }
  if (requested === MOVIE_STATUS.watched) {
    return { status: MOVIE_STATUS.watched, watchedAt: new Date().toISOString() };
  }
  if (requested === MOVIE_STATUS.watching || requested === MOVIE_STATUS.dropped) {
    return { status: requested, watchedAt: null };
  }
  return { status: MOVIE_STATUS.queued, watchedAt: null };
}

// Теги пишет человек, поэтому регистр и лишние пробелы не должны плодить
// дубликаты: «Новый год» и «новый  год» — одна метка.
export function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  const byNormalized = new Map();
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const label = tag.trim().replace(/\s+/g, " ").slice(0, TAG_MAX_LENGTH);
    if (!label) continue;
    const key = normalizeText(label);
    if (!byNormalized.has(key)) {
      byNormalized.set(key, label);
    }
  }

  return [...byNormalized.values()].slice(0, TAGS_MAX_COUNT);
}

export function parseTagInput(value) {
  return normalizeTags(String(value ?? "").split(","));
}

export function collectLibraryTags(movies) {
  const byNormalized = new Map();
  for (const movie of movies ?? []) {
    for (const tag of movie.tags ?? []) {
      const key = normalizeText(tag);
      byNormalized.set(key, (byNormalized.get(key) ?? { tag, count: 0 }));
      byNormalized.get(key).count += 1;
    }
  }

  return [...byNormalized.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ru-RU"));
}

function normalizeRatings(ratings) {
  if (!Array.isArray(ratings)) {
    return [];
  }

  const byParticipant = new Map();
  for (const rating of ratings) {
    try {
      const participantUserId = normalizeUserId(rating.participantUserId);
      const participantName = requireText(
        rating.participantName ?? rating.u,
        "Имя зрителя",
      );
      const normalizedParticipantName = normalizeText(participantName);
      // Ключ по аккаунту, а не по имени: у двух друзей может совпасть имя, и
      // одна оценка не должна затирать другую.
      const key = participantUserId
        ? `user:${participantUserId}`
        : `name:${normalizedParticipantName}`;
      byParticipant.set(key, {
        id: rating.id ?? createId(),
        participantUserId,
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

function normalizeUserId(value) {
  const id = String(value ?? "").trim();
  return id || null;
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

