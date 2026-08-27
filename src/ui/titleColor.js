// Цвет по названию.
//
// Фильм без обложки получает не серый прямоугольник, а свой оттенок: тот же
// самый и в каталоге, и в колесе. Название — единственное, что есть у любого
// фильма, поэтому оттенок берётся из него и не меняется от запуска к запуску.

export function titleHue(value) {
  const text = String(value ?? "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 360;
  }
  return hash;
}
