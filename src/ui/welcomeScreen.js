import { APP_VERSION } from "../config.js";

// Витрина CineVault — первый экран сервиса и единственное, что видит гость.
// Это не отдельная страница, а обычный вид: кнопки ведут либо в библиотеку
// штатной навигацией, либо на следующую страницу — форму входа, а оформление
// собрано на тех же токенах, что и остальной интерфейс.

const FEATURES = [
  ["grid", "Каталог в двух режимах",
    "Плитка с постерами или плотный список. Чипы-фильтры по спискам и жанрам, выдвижная карточка с описанием и метаданными."],
  ["layers", "Списки и франшизы",
    "Вложенные пользовательские списки, франшизы одним объектом и ручная очередь просмотра внутри каждого списка."],
  ["wheel", "Колесо выбывания",
    "Не лотерея на один тык, а батл-рояль: участники вылетают круг за кругом, пока не останется один фильм."],
  ["shield", "Персональные сейвы",
    "У каждого участника вечера есть право спасти свой фильм от вылета. Ровно столько раз, сколько вы договорились."],
  ["star", "Просмотрено и оценки",
    "Шаг в половину звезды, дата просмотра и история завершённых сессий — чем закончился каждый вечер."],
  ["chart", "Статистика вкуса",
    "Жанры, страны, годы и часы у экрана. Картина того, что вы на самом деле смотрите, а не что собирались."],
  ["globe", "Данные из TMDB",
    "Один поиск заполняет название, год, длительность, страну, жанры, описание и постер — карточку не приходится набивать руками."],
  ["archive", "Импорт и резервные копии",
    "CSV, TSV и XLSX на входе, копия библиотеки одним файлом на выходе. Обратимое удаление — на случай неверного клика."],
];

const FAQ = [
  ["Нужен ли аккаунт?",
    "Да. CineVault — сервис с личным кабинетом: библиотека, списки, оценки и история роллов закреплены за вашим профилем. Вход — по почте и паролю."],
  ["Где взять код приглашения?",
    "Регистрация закрытая: код из восьми символов выдаёт тот, кто уже пользуется CineVault. Код вводится один раз, при создании аккаунта."],
  ["Кто видит мою библиотеку?",
    "Только вы. Права на каждую запись проверяет сервер, а не браузер: чужой аккаунт не может ни прочитать вашу библиотеку, ни изменить её."],
  ["Как перенести старую таблицу?",
    "Импортом CSV, TSV или XLSX. Минимально нужны название и год, остальное CineVault дозаполнит из TMDB."],
  ["Обязательно ли подключать TMDB?",
    "Нет, но с ним быстрее: один поиск заполняет год, длительность, страну, жанры, описание и постер. Токен подключается отдельно и в резервную копию не попадает."],
  ["Можно ли крутить колесо на несколько человек?",
    "Так и задумано. Для каждого списка задаётся квота участников, у каждого есть свои сейвы, а история сессий помнит итог вечера."],
  ["Это готовый релиз?",
    `Текущая версия — ${APP_VERSION}: основной цикл собран полностью, но статус пока бета, и попасть внутрь можно по приглашению.`],
];

const GLYPHS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 16.5l9 5 9-5"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21"/>',
  shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z"/><path d="M9.5 12l1.8 1.8L15 10"/>',
  star: '<path d="M12 4l2.4 5 5.6.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.6-.8z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 000 18 14 14 0 000-18z"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10a1 1 0 001 1h12a1 1 0 001-1V9"/><path d="M10 13h4"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  lock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  arrow: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  aperture: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="4"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6"/>',
};

function glyph(name, size = 24, width = 1.5) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="${width}" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${GLYPHS[name] ?? ""}</svg>`;
}

function badge(text, name = "spark") {
  return `<span class="wl-badge">${glyph(name, 13)}${text}</span>`;
}

function tick(text) {
  return `<li>${glyph("check", 15, 2)}<span>${text}</span></li>`;
}

// Пока библиотека закрыта аккаунтом, все призывы ведут на форму входа, а не в
// каталог: иначе кнопка обещала бы то, чего гость ещё не получит.
function ctaPrimary(locked) {
  return locked
    ? `<button class="btn btn--primary btn--lg" type="button"
        data-action="account-open" data-mode="signup">Создать аккаунт</button>`
    : `<button class="btn btn--primary btn--lg" type="button" data-view="catalog">
        Открыть хранилище
      </button>`;
}

export function renderWelcome(container, state) {
  const stats = state.statistics ?? {};
  const total = Number(stats.movieCount ?? 0);
  const watched = Number(stats.watchedMovieCount ?? 0);
  const lists = Number(stats.categoryCount ?? 0);
  const empty = total === 0;
  const locked = Boolean(state.libraryLocked);

  container.innerHTML = `
    <div class="wl">

      <section class="wl-hero">
        <div class="wl-hero__bg" aria-hidden="true">
          <img src="./assets/welcome/hero-night.jpg" width="1920" height="1081"
            alt="" fetchpriority="high" decoding="async">
        </div>
        <div class="wl-hero__inner">
          ${badge("Закрытая бета · вход по приглашению", "lock")}
          <h1>Хранилище фильмов, которое <span class="wl-grad">выбирает за вас</span></h1>
          <p class="wl-hero__sub">
            CineVault собирает вашу библиотеку, списки и франшизы в одном тёмном зале —
            и превращает вечный вопрос «что смотрим?» в один поворот колеса.
            Всё это ждёт за вашим личным кабинетом.
          </p>
          <div class="wl-cta">
            ${ctaPrimary(locked)}
            <button class="btn btn--ghost btn--lg" type="button" data-welcome-scroll="wheel">
              Как работает колесо
            </button>
          </div>
          <p class="wl-meta">
            <span><i class="wl-dot"></i>Аккаунт по коду приглашения</span>
            <span><i class="wl-dot"></i>Версия ${APP_VERSION}</span>
            <span><i class="wl-dot"></i>Интерфейс полностью на русском</span>
          </p>
        </div>
      </section>

      <section class="wl-sec wl-sec--tight">
        <div class="wl-metrics">
          ${empty ? `
            <article class="wl-metric"><b>8</b><span>символов в коде приглашения — ровно столько отделяет от библиотеки</span></article>
            <article class="wl-metric"><b>0,5</b><span>шаг оценки — половинки звёзд, без округлений в чужую пользу</span></article>
            <article class="wl-metric"><b>3</b><span>формата импорта — CSV, TSV и XLSX из вашей старой таблицы</span></article>
          ` : `
            <article class="wl-metric"><b>${total}</b><span>фильмов в вашей библиотеке прямо сейчас</span></article>
            <article class="wl-metric"><b>${watched}</b><span>уже просмотрено и оценено</span></article>
            <article class="wl-metric"><b>${lists}</b><span>списков и очередей собрано</span></article>
          `}
          <article class="wl-metric"><b>Ctrl K</b><span>палитра команд — переходы, действия и поиск</span></article>
        </div>
      </section>

      <section class="wl-sec" id="welcome-feats">
        <header class="wl-head">
          ${badge("Что внутри хранилища", "plus")}
          <h2>Каталог, который знает ваш вкус</h2>
          <p>Восемь инструментов вместо одной бесконечной таблицы. Всё сделано под один сценарий —
          вечер, когда надо выбрать фильм и не поссориться.</p>
        </header>
        <div class="wl-feats">
          ${FEATURES.map(([ic, title, text]) => `
            <article class="wl-feat">
              <span class="wl-feat__ic">${glyph(ic)}</span>
              <h3>${title}</h3>
              <p>${text}</p>
            </article>
          `).join("")}
        </div>
      </section>

      <div class="wl-aurora"></div>

      <section class="wl-sec" id="welcome-wheel">
        <div class="wl-block">
          <div class="wl-block__text">
            ${badge("Механика вечера", "aperture")}
            <h2>Вечер начинается с поворота</h2>
            <p>
              Обычный рандомайзер выдаёт ответ мгновенно — и его тут же хочется перекрутить.
              Колесо CineVault растягивает выбор в короткий ритуал: каждый круг убирает
              одного претендента, напряжение растёт, и финальный фильм ощущается решением,
              а не случайностью.
            </p>
            <ol class="wl-steps">
              <li><b>1</b><span>Соберите пул: списки, квоты участников, фильтры по жанрам и годам.</span></li>
              <li><b>2</b><span>Раздайте сейвы — каждый может один раз вытащить свой фильм из-под вылета.</span></li>
              <li><b>3</b><span>Жмите пробел. Круг за кругом, пока не останется единственный.</span></li>
            </ol>
            ${locked ? `
              <button class="wl-link" type="button" data-action="account-open" data-mode="signin">
                Войти и собрать пул ${glyph("arrow", 15, 1.8)}
              </button>
            ` : `
              <button class="wl-link" type="button" data-view="wheel">
                Перейти к колесу ${glyph("arrow", 15, 1.8)}
              </button>
            `}
          </div>
          <div class="wl-block__vis">${wheelArt()}</div>
        </div>
      </section>

      <section class="wl-sec">
        <header class="wl-head">
          <h2>Как это выглядит дома</h2>
          <p>Не витрина и не постановочный рендер — обычный вечер, ноутбук на журнальном
          столике и договорённость, что решает колесо.</p>
        </header>
        <div class="wl-frames">
          <figure class="wl-frame">
            <img src="./assets/welcome/night-in.jpg" width="1600" height="893" loading="lazy"
              decoding="async" alt="Ноутбук с библиотекой CineVault в тёмной гостиной">
            <figcaption>Библиотека под рукой: постеры, фильтры и очередь на вечер — в одном тёмном окне.</figcaption>
          </figure>
          <figure class="wl-frame">
            <img src="./assets/welcome/wheel-night.jpg" width="1600" height="893" loading="lazy"
              decoding="async" alt="Киновечер с друзьями: на экране крутится колесо выбора фильма">
            <figcaption>Колесо в момент прокрутки — тот самый круг, когда вылетает чей-то фаворит.</figcaption>
          </figure>
        </div>
      </section>

      <div class="wl-aurora"></div>

      <section class="wl-sec" id="welcome-account">
        <header class="wl-head">
          ${badge("Хранилище открывается ключом", "lock")}
          <h2>Библиотека видна только вам</h2>
          <p>CineVault — сервис с личным кабинетом. Вход по почте и паролю, регистрация —
          по коду приглашения от того, кто уже здесь.</p>
        </header>
        <div class="wl-cards">
          <article class="wl-card">
            <h3>Что даёт аккаунт</h3>
            <p>Библиотека перестаёт быть файлом, который легко потерять, и становится вашей записью в сервисе.</p>
            <ul class="wl-list">
              ${tick("Профиль с именем, по которому вас находят друзья.")}
              ${tick("Фильмы, списки, оценки и история роллов закреплены за аккаунтом.")}
              ${tick("Права на каждую запись проверяет сервер, а не браузер.")}
              ${tick("Резервная копия — обычный файл, который вы кладёте куда захотите.")}
            </ul>
          </article>
          <article class="wl-card">
            <h3>Что нужно для входа</h3>
            <p>Ни установки, ни настройки: кнопка «Создать аккаунт» открывает форму
            на следующей странице, а дальше решают почта и пароль.</p>
            <ul class="wl-list">
              ${tick("Почта, на которую придёт подтверждение регистрации.")}
              ${tick("Код приглашения — восемь латинских букв и цифр.")}
              ${tick("Современный браузер: Chrome, Edge, Firefox или Safari.")}
              ${tick("Светлая и тёмная темы, адаптивная навигация на узких экранах.")}
            </ul>
          </article>
        </div>
      </section>

      <section class="wl-sec" id="welcome-faq">
        <header class="wl-head">
          <h2>Короткие ответы</h2>
          <p>Если чего-то не хватает — остальное разложено по документации в репозитории.</p>
        </header>
        <div class="wl-faq">
          ${FAQ.map(([q, a], i) => `
            <details ${i === 0 ? "open" : ""}>
              <summary>${q}</summary>
              <p>${a}</p>
            </details>
          `).join("")}
        </div>
      </section>

      <section class="wl-final">
        ${badge(`Версия ${APP_VERSION}`, "check")}
        <h2>Заберите свой вечер у алгоритмов</h2>
        <p>${locked
          ? "Код приглашения на руках — значит, до библиотеки осталась одна форма."
          : "Хранилище уже здесь и ждёт вашу библиотеку. Дальше решает колесо."}</p>
        <div class="wl-cta">
          ${ctaPrimary(locked)}
          ${locked
            ? `<button class="btn btn--ghost btn--lg" type="button"
                data-action="account-open" data-mode="signin">Войти</button>`
            : `<button class="btn btn--ghost btn--lg" type="button"
                data-welcome-scroll="feats">Посмотреть возможности</button>`}
        </div>
        <p class="wl-meta">
          <span><i class="wl-dot"></i>По приглашению</span>
          <span><i class="wl-dot"></i>Без установки</span>
          <span><i class="wl-dot"></i>Бесплатно, пока идёт бета</span>
        </p>
      </section>

      <footer class="wl-foot">
        <p>Данные о фильмах предоставлены TMDB. Проект не связан с TMDB и не одобрен ими.
        Использование API бесплатно для некоммерческих проектов при соблюдении атрибуции.</p>
      </footer>

    </div>
  `;
}

function wheelArt() {
  return `
    <svg viewBox="0 0 320 320" class="wl-wheel" role="img"
      aria-label="Колесо выбывания с шестью фильмами">
      <defs>
        <linearGradient id="wl-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#e59cff"/>
          <stop offset="50%" stop-color="#ba9cff"/>
          <stop offset="100%" stop-color="#9cb2ff"/>
        </linearGradient>
      </defs>
      <circle cx="160" cy="168" r="128" class="wl-wheel__halo"/>
      <circle cx="160" cy="168" r="120" class="wl-wheel__disc"/>
      <circle cx="160" cy="168" r="120" fill="none" stroke="url(#wl-rim)" stroke-width="1.5" opacity=".9"/>
      <g class="wl-wheel__spokes">
        <path d="M160 48v240"/><path d="M56 108l208 120"/><path d="M264 108L56 228"/>
      </g>
      <circle cx="160" cy="168" r="86" class="wl-wheel__ring"/>
      <g class="wl-wheel__out">
        <text x="160" y="86" text-anchor="middle">Прибытие</text>
        <text x="256" y="140" text-anchor="middle">Помни</text>
        <text x="248" y="228" text-anchor="middle">Персона</text>
        <text x="160" y="266" text-anchor="middle">Расёмон</text>
        <text x="70" y="228" text-anchor="middle">Солярис</text>
      </g>
      <text x="68" y="140" text-anchor="middle" class="wl-wheel__alive">Сталкер</text>
      <circle cx="160" cy="168" r="40" class="wl-wheel__hub"/>
      <text x="160" y="163" text-anchor="middle" class="wl-wheel__label">КРУГ</text>
      <text x="160" y="184" text-anchor="middle" class="wl-wheel__round">4 / 6</text>
      <path d="M160 34l9 17h-18z" class="wl-wheel__pin"/>
    </svg>
  `;
}
