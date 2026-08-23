-- CineVault, этап 14: базовая схема серверной версии.
--
-- Правила предметной области остаются в src/domain/*. Здесь фиксируются только
-- те из них, нарушение которых повредило бы данные: принадлежность записи
-- владельцу, единственность оценки зрителя, связность списков и франшиз.
--
-- Требуется PostgreSQL 15 или новее: используется «on delete set null (столбец)»
-- для составных внешних ключей. Новые проекты Supabase этому условию отвечают.

-- Общее -------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Профили и приглашения ----------------------------------------------------

-- Регистрация закрытая: строка в auth.users сама по себе не даёт ничего.
-- Доступ появляется только вместе с профилем, а профиль создаётся обменом
-- кода приглашения (см. redeem_invite в 20260824090200_functions.sql).
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  -- Только строчная латиница, цифры и подчёркивание: кириллическая «а» и
  -- латинская «a» не должны давать двух неразличимых на глаз аккаунтов.
  handle text not null unique
    check (handle ~ '^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$'),
  display_name text not null
    check (char_length(display_name) between 1 and 60),
  library_visibility text not null default 'private'
    check (library_visibility in ('private', 'friends')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invites (
  code text primary key
    check (code ~ '^[A-Z0-9]{8}$'),
  created_by uuid references auth.users on delete set null,
  used_by uuid references auth.users on delete set null,
  used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invites_used_state check (
    (used_by is null and used_at is null)
    or (used_by is not null and used_at is not null)
  )
);

create index invites_created_by_idx on public.invites (created_by);

create table public.user_settings (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Библиотека ---------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  parent_id uuid references public.categories on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  normalized_name text not null,
  sort_order integer not null default 0,
  roll_quota integer not null default 0 check (roll_quota >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_not_own_parent check (parent_id is null or parent_id <> id),
  -- Мишень для составных внешних ключей: фильм не может лежать в чужом списке.
  constraint categories_id_owner_key unique (id, owner_id)
);

create index categories_owner_idx on public.categories (owner_id);
create index categories_parent_idx on public.categories (parent_id);

-- Дубликат списка ловится в базе, а не только в интерфейсе. NULL в parent_id
-- не сравнивается сам с собой, поэтому индексов два.
create unique index categories_owner_root_name_key
  on public.categories (owner_id, normalized_name)
  where parent_id is null;
create unique index categories_owner_child_name_key
  on public.categories (owner_id, parent_id, normalized_name)
  where parent_id is not null;

create table public.movies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  category_id uuid,
  category_position integer not null default 0,
  title text not null check (char_length(title) between 1 and 300),
  normalized_title text not null,
  original_title text not null default '',
  tmdb_id integer check (tmdb_id > 0),
  overview text not null default '',
  genres text[] not null default '{}',
  tags text[] not null default '{}'
    check (coalesce(array_length(tags, 1), 0) <= 12),
  notes text not null default '' check (char_length(notes) <= 2000),
  is_favorite boolean not null default false,
  status text not null default 'queued'
    check (status in ('queued', 'watching', 'watched', 'dropped')),
  watched_at timestamptz,
  -- Путь постера в TMDB; изображение отдаёт CDN TMDB, у себя не храним.
  poster_path text,
  -- Своя обложка: адрес в Storage или внешняя ссылка.
  cover_url text not null default '',
  release_year integer check (release_year between 1888 and 2200),
  duration_minutes integer check (duration_minutes between 1 and 2000),
  country text not null default '',
  tmdb_updated_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Инвариант resolveWatchState из entities.js: статус и дата просмотра —
  -- одна и та же величина с двух сторон.
  constraint movies_watch_state check (
    (status = 'watched' and watched_at is not null)
    or (status <> 'watched' and watched_at is null)
  ),
  constraint movies_id_owner_key unique (id, owner_id),
  -- Удаление списка переносит фильмы в «Без списка», как и раньше; owner_id
  -- при этом обязан уцелеть, поэтому обнуляется только category_id.
  constraint movies_category_fk foreign key (category_id, owner_id)
    references public.categories (id, owner_id) on delete set null (category_id)
);

create index movies_owner_idx on public.movies (owner_id) where deleted_at is null;
create index movies_category_idx on public.movies (category_id);
create index movies_owner_status_idx on public.movies (owner_id, status);
create index movies_tags_idx on public.movies using gin (tags);

-- Один и тот же фильм TMDB не заводится в библиотеке дважды.
create unique index movies_owner_tmdb_key
  on public.movies (owner_id, tmdb_id)
  where tmdb_id is not null and deleted_at is null;

create table public.franchises (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  category_id uuid,
  category_position integer not null default 0,
  name text not null check (char_length(name) between 1 and 200),
  normalized_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint franchises_id_owner_key unique (id, owner_id),
  constraint franchises_category_fk foreign key (category_id, owner_id)
    references public.categories (id, owner_id) on delete set null (category_id)
);

create index franchises_owner_idx on public.franchises (owner_id);
create unique index franchises_owner_name_key
  on public.franchises (owner_id, normalized_name);

-- Вместо массива movieIds: порядок внутри франшизы должен переживать
-- одновременную правку с двух устройств.
create table public.franchise_movies (
  -- Фильм входит максимум в одну франшизу — это первичный ключ по movie_id.
  movie_id uuid primary key,
  franchise_id uuid not null,
  owner_id uuid not null references auth.users on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  -- Оба составных ключа ведут к одному владельцу: собрать франшизу из чужих
  -- фильмов нельзя даже в обход интерфейса.
  constraint franchise_movies_movie_fk foreign key (movie_id, owner_id)
    references public.movies (id, owner_id) on delete cascade,
  constraint franchise_movies_franchise_fk foreign key (franchise_id, owner_id)
    references public.franchises (id, owner_id) on delete cascade
);

create index franchise_movies_franchise_idx
  on public.franchise_movies (franchise_id, sort_order);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  normalized_name text not null,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index participants_owner_name_key
  on public.participants (owner_id, normalized_name);

-- Оценка вынесена из фильма: иначе оценка друга требовала бы права на запись
-- во всю карточку. rater_user_id заполнен для зарегистрированного зрителя,
-- rater_name остаётся для гостя за столом.
create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  movie_id uuid not null,
  -- Владелец библиотеки, в которой стоит оценка. Составной ключ ниже не даёт
  -- приписать оценку к фильму другого человека.
  owner_id uuid not null,
  rater_user_id uuid references auth.users on delete cascade,
  rater_name text not null check (char_length(rater_name) between 1 and 60),
  normalized_rater_name text not null,
  value numeric(3, 1) not null
    check (value >= 1 and value <= 10 and (value * 2) = floor(value * 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ratings_movie_fk foreign key (movie_id, owner_id)
    references public.movies (id, owner_id) on delete cascade
);

create index ratings_movie_idx on public.ratings (movie_id);
create index ratings_rater_idx on public.ratings (rater_user_id);

-- Один зритель — одна оценка на фильм, независимо от того, аккаунт это или имя.
create unique index ratings_movie_account_key
  on public.ratings (movie_id, rater_user_id)
  where rater_user_id is not null;
create unique index ratings_movie_guest_key
  on public.ratings (movie_id, normalized_rater_name)
  where rater_user_id is null;

-- Друзья -------------------------------------------------------------------

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users on delete cascade,
  addressee_id uuid not null references auth.users on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'blocked')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_not_self check (requester_id <> addressee_id)
);

-- Пара уникальна в любом порядке: встречная заявка не создаёт вторую строку.
create unique index friendships_pair_key on public.friendships (
  least(requester_id, addressee_id),
  greatest(requester_id, addressee_id)
);
create index friendships_addressee_idx on public.friendships (addressee_id, status);

-- Общие списки -------------------------------------------------------------

create table public.shared_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shared_list_members (
  list_id uuid not null references public.shared_lists on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'viewer'
    check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (list_id, user_id)
);

create index shared_list_members_user_idx on public.shared_list_members (user_id);

create table public.shared_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shared_lists on delete cascade,
  movie_id uuid not null references public.movies on delete cascade,
  added_by uuid not null references auth.users on delete cascade,
  -- Дробная позиция: два человека вставляют между одними и теми же соседями,
  -- не переписывая весь список.
  sort_order double precision not null default 0,
  created_at timestamptz not null default now(),
  unique (list_id, movie_id)
);

create index shared_list_items_list_idx on public.shared_list_items (list_id, sort_order);

-- Сессии колеса ------------------------------------------------------------

create table public.roll_sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'completed', 'abandoned')),
  -- Свёрнутый снимок состояния, чтобы присоединившийся не перечитывал журнал.
  state jsonb not null default '{}'::jsonb,
  save_threshold integer not null default 3 check (save_threshold >= 1),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index roll_sessions_host_idx on public.roll_sessions (host_id, status);

create table public.roll_session_members (
  session_id uuid not null references public.roll_sessions on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  saves_left integer not null default 0 check (saves_left >= 0),
  joined_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create index roll_session_members_user_idx on public.roll_session_members (user_id);

-- Журнал событий: одинаковый журнал даёт одинаковое состояние у всех клиентов,
-- потому что применяется один и тот же редьюсер из src/domain/rollEngine.js.
create table public.roll_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.roll_sessions on delete cascade,
  seq bigint generated always as identity,
  actor_id uuid references auth.users on delete set null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index roll_events_order_key on public.roll_events (session_id, seq);

-- Триггеры updated_at ------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array[
    'profiles', 'user_settings', 'categories', 'movies', 'franchises',
    'participants', 'ratings', 'friendships', 'shared_lists', 'roll_sessions'
  ]
  loop
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I
         for each row execute function public.touch_updated_at()',
      target, target
    );
  end loop;
end;
$$;

-- Realtime: клиенты подписаны на журнал событий и состав сессии.
-- Публикации может не быть в чистом Postgres вне Supabase, поэтому с проверкой.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.roll_events;
    alter publication supabase_realtime add table public.roll_sessions;
    alter publication supabase_realtime add table public.roll_session_members;
  end if;
end;
$$;
