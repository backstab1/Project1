-- CineVault, этап 17: дневная квота обращений к TMDB.
--
-- Токен TMDB перестал быть личным файлом пользователя и стал секретом Edge
-- Function — одним на весь сервис. Значит, его расходуют все сразу, и один
-- увлёкшийся пакетным обогащением аккаунт способен исчерпать общий лимит.
-- Поэтому счётчик на пользователя в сутки.
--
-- Считает и проверяет одна функция: клиент к таблице не ходит вовсе, а Edge
-- Function вызывает её от имени пользователя, а не служебным ключом.

create table if not exists public.tmdb_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null default current_date,
  requests integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.tmdb_usage enable row level security;

-- Политик нет намеренно: строки читает и пишет только функция ниже, а она
-- security definer. Своим расходом пользователь интересуется через ответ
-- функции, а не через таблицу.

create or replace function public.take_tmdb_quota(p_limit integer default 300)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_used integer;
begin
  if v_user is null then
    raise exception 'Требуется вход в аккаунт.' using errcode = '28000';
  end if;

  insert into public.tmdb_usage (user_id, day, requests)
  values (v_user, current_date, 1)
  on conflict (user_id, day) do update
    set requests = public.tmdb_usage.requests + 1,
        updated_at = now()
  returning requests into v_used;

  -- Код PT429 PostgREST отдаёт как HTTP 429; Edge Function переводит его в
  -- понятный русский ответ, а не в текст ошибки Postgres.
  if v_used > p_limit then
    raise exception 'Дневной лимит запросов к TMDB исчерпан: % за сутки.', p_limit
      using errcode = 'PT429';
  end if;

  return p_limit - v_used;
end;
$$;

revoke execute on function public.take_tmdb_quota(integer) from public, anon;
grant execute on function public.take_tmdb_quota(integer) to authenticated;

-- Старые сутки не нужны: таблица не должна расти без предела. Чистку делает
-- та же функция раз в сутки на первом обращении — отдельного расписания под
-- одну строку заводить нечего.
create or replace function public.prune_tmdb_usage()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.tmdb_usage where day < current_date - 7;
$$;

revoke execute on function public.prune_tmdb_usage() from public, anon;
grant execute on function public.prune_tmdb_usage() to authenticated;
