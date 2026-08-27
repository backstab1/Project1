// Адреса постеров.
//
// Изображения отдаёт CDN самого TMDB: у себя мы храним только `posterPath` —
// путь вида `/abc123.jpg`. Кэшировать картинки на своей стороне больше нечем и
// незачем: пятьсот постеров на сотню пользователей не помещаются в бесплатное
// хранилище, а работать без интернета приложение всё равно перестало.
//
// Своя обложка — отдельное поле `coverUrl`: она указывает на файл, которого в
// TMDB нет, и потому всегда важнее.

const TMDB_IMAGE_ROOT = "https://image.tmdb.org/t/p";

// Размеры TMDB: w185 для строки списка, w342 для плитки, w500 для карточки.
export const POSTER_SIZES = Object.freeze({
  row: "w185",
  tile: "w342",
  card: "w500",
});

// Путь приходит из ответа TMDB, но попадает в атрибут src, поэтому проверяется
// на форму, а не подставляется как есть.
export function tmdbPosterUrl(posterPath, size = POSTER_SIZES.tile) {
  if (!posterPath || !/^\/[A-Za-z0-9._-]+$/.test(posterPath)) return "";
  return `${TMDB_IMAGE_ROOT}/${size}${posterPath}`;
}

export function moviePosterUrl(movie, size = POSTER_SIZES.tile) {
  const own = String(movie?.coverUrl ?? "").trim();
  if (own) return own;
  return tmdbPosterUrl(movie?.posterPath, size);
}
