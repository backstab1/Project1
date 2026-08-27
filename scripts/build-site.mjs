// Сборка статики для хостинга.
//
// Запуск: npm run build:site
// Результат: каталог dist/ — ровно то, что должно оказаться в интернете.
//
// Сборщика в проекте нет и не появляется: приложение состоит из нативных
// ES-модулей. Этот скрипт не собирает, а отбирает — копирует то, что нужно
// браузеру, и оставляет за бортом всё остальное: тесты, документы, миграции,
// сам этот скрипт и прототип в legacy/. Публиковать репозиторий целиком было
// бы неопрятно и однажды опасно.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist");

// Всё, что запрашивает браузер: разметка, модули, стили, шрифты и картинки.
const ITEMS = ["index.html", "src", "assets", "vendor/supabase.esm.js"];

// Заголовки Cloudflare Pages. Статика приложения меняется вместе с выкладкой,
// поэтому её можно кэшировать надолго только по хэшу в имени — у нас имён с
// хэшем нет, значит модули кэшируются коротко, а картинки долго.
const HEADERS = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/vendor/*
  Cache-Control: public, max-age=31536000, immutable

/src/*
  Cache-Control: public, max-age=300, must-revalidate

/index.html
  Cache-Control: no-cache
`;

async function main() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  for (const item of ITEMS) {
    await cp(path.join(root, item), path.join(out, item), { recursive: true });
  }

  await writeFile(path.join(out, "_headers"), HEADERS, "utf8");

  // Версия рядом с файлами: по ней видно, что именно выложено, без гадания.
  const config = await readFile(path.join(root, "src", "config.js"), "utf8");
  const version = config.match(/APP_VERSION = "([^"]*)"/)?.[1] ?? "неизвестно";
  await writeFile(
    path.join(out, "version.json"),
    JSON.stringify({ version, builtAt: new Date().toISOString() }, null, 2),
    "utf8",
  );

  console.log(`Собрано в ${out}`);
  console.log(`Версия: ${version}`);
  console.log(`Состав: ${ITEMS.join(", ")}, _headers, version.json`);
}

main().catch((error) => {
  console.error(`Сборка не удалась: ${error.message}`);
  process.exit(1);
});
