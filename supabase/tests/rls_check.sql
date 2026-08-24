-- Проверка политик доступа без Node.js: скрипт целиком выполняется в
-- SQL Editor панели Supabase.
--
-- Запускать ТОЛЬКО на dev-проекте. Скрипт создаёт двух пользователей,
-- проверяет границы доступа и удаляет их за собой; последний запрос показывает
-- таблицу результатов.
--
-- Если скрипт оборвался посреди работы, уберите остатки вручную:
--   delete from auth.users where email like 'rls-%@cinevault.test';
--
-- Как это работает: обычные запросы в редакторе идут ролью с правом обходить
-- RLS, поэтому каждая проверка выполняется через pg_temp.as_user — она
-- переключается на роль authenticated и подставляет тот же claim «sub», из
-- которого auth.uid() берёт пользователя в настоящем запросе из браузера.

-- Подготовка ---------------------------------------------------------------

create temporary table rls_results (
  seq serial primary key,
  name text,
  passed boolean,
  detail text
);

create function pg_temp.record(p_name text, p_passed boolean, p_detail text default '')
returns void language sql as $$
  insert into rls_results (name, passed, detail) values (p_name, p_passed, p_detail);
$$;

-- Считает строки запросом от имени пользователя.
create function pg_temp.as_user(p_uid uuid, p_sql text)
returns bigint language plpgsql as $$
declare
  v_result bigint;
begin
  execute 'set local role authenticated';
  execute format(
    'set local "request.jwt.claims" = %L',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text
  );
  execute p_sql into v_result;
  execute 'reset role';
  return v_result;
exception when others then
  execute 'reset role';
  raise;
end;
$$;

-- Выполняет запрос от имени пользователя и возвращает текст ошибки.
-- NULL означает «запрос прошёл» — для запрещающих проверок это провал.
create function pg_temp.denied(p_uid uuid, p_sql text)
returns text language plpgsql as $$
begin
  execute 'set local role authenticated';
  execute format(
    'set local "request.jwt.claims" = %L',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text
  );
  execute p_sql;
  execute 'reset role';
  return null;
exception when others then
  execute 'reset role';
  return sqlerrm;
end;
$$;

-- Идентификаторы фиксированные, чтобы проверки читались глазами.
do $$
declare
  v_alice uuid := '00000000-0000-4000-8000-00000000a11c';
  v_bob   uuid := '00000000-0000-4000-8000-00000000b0b0';
  v_category uuid := '00000000-0000-4000-8000-0000000ca7e9';
  v_movie uuid := '00000000-0000-4000-8000-00000000d00e';
  v_error text;
  v_count bigint;
  v_friendship uuid;
begin
  insert into auth.users (id, email) values
    (v_alice, 'rls-alice@cinevault.test'),
    (v_bob, 'rls-bob@cinevault.test');

  insert into public.profiles (id, handle, display_name) values
    (v_alice, 'rls_alice', 'Алиса'),
    (v_bob, 'rls_bob', 'Боб');

  -- Библиотеку Алиса заводит сама, обычным правом authenticated.
  perform pg_temp.as_user(v_alice, format($q$
    with inserted as (
      insert into public.categories (id, owner_id, name, normalized_name, roll_quota)
      values (%L, %L, 'Вечер пятницы', 'вечер пятницы', 3)
      returning 1
    ) select count(*) from inserted
  $q$, v_category, v_alice));

  perform pg_temp.as_user(v_alice, format($q$
    with inserted as (
      insert into public.movies (id, owner_id, category_id, title, normalized_title)
      values (%L, %L, %L, 'Дюна', 'дюна')
      returning 1
    ) select count(*) from inserted
  $q$, v_movie, v_alice, v_category));

  perform pg_temp.record('владелец создаёт список и фильм', true);

  -- 1. Границы до дружбы --------------------------------------------------

  v_count := pg_temp.as_user(v_bob, format(
    'select count(*) from public.movies where id = %L', v_movie));
  perform pg_temp.record('чужая библиотека невидима без дружбы',
    v_count = 0, format('строк: %s', v_count));

  v_error := pg_temp.denied(v_bob, format($q$
    insert into public.movies (owner_id, title, normalized_title)
    values (%L, 'Подделка', 'подделка')
  $q$, v_alice));
  perform pg_temp.record('нельзя записать фильм в чужую библиотеку',
    v_error is not null, coalesce(v_error, 'вставка прошла'));

  v_count := pg_temp.as_user(v_bob, format(
    'select count(*) from public.profiles where id = %L', v_alice));
  perform pg_temp.record('чужой профиль не виден без заявки',
    v_count = 0, format('строк: %s', v_count));

  v_count := pg_temp.as_user(v_bob,
    'select count(*) from public.find_profile_by_handle(''rls_alice'')');
  perform pg_temp.record('поиск по точному имени находит человека',
    v_count = 1, format('строк: %s', v_count));

  -- 2. Заявка и дружба ----------------------------------------------------

  perform pg_temp.as_user(v_bob, format($q$
    with inserted as (
      insert into public.friendships (requester_id, addressee_id)
      values (%L, %L) returning 1
    ) select count(*) from inserted
  $q$, v_bob, v_alice));
  perform pg_temp.record('заявка в друзья отправляется', true);

  select id into v_friendship from public.friendships
  where requester_id = v_bob and addressee_id = v_alice;

  v_error := pg_temp.denied(v_bob, format($q$
    update public.friendships set status = 'accepted' where id = %L
  $q$, v_friendship));
  perform pg_temp.record('заявитель не принимает свою же заявку',
    v_error is not null, coalesce(v_error, 'приняли сами себя'));

  perform pg_temp.as_user(v_alice, format($q$
    with changed as (
      update public.friendships set status = 'accepted' where id = %L returning 1
    ) select count(*) from changed
  $q$, v_friendship));
  perform pg_temp.record('адресат принимает заявку', true);

  v_count := pg_temp.as_user(v_bob, format(
    'select count(*) from public.movies where id = %L', v_movie));
  perform pg_temp.record('дружба сама по себе не открывает библиотеку',
    v_count = 0, format('строк: %s', v_count));

  -- 3. Видимость включена вручную -----------------------------------------

  perform pg_temp.as_user(v_alice, format($q$
    with changed as (
      update public.profiles set library_visibility = 'friends'
      where id = %L returning 1
    ) select count(*) from changed
  $q$, v_alice));

  v_count := pg_temp.as_user(v_bob, format(
    'select count(*) from public.movies where id = %L', v_movie));
  perform pg_temp.record('друг видит открытую библиотеку',
    v_count = 1, format('строк: %s', v_count));

  v_count := pg_temp.as_user(v_bob, format($q$
    with changed as (
      update public.movies set title = 'Переписано' where id = %L returning 1
    ) select count(*) from changed
  $q$, v_movie));
  perform pg_temp.record('друг не правит чужой фильм',
    v_count = 0, format('изменено строк: %s', v_count));

  -- 4. Оценки -------------------------------------------------------------

  perform pg_temp.as_user(v_bob, format($q$
    with inserted as (
      insert into public.ratings
        (movie_id, owner_id, rater_user_id, rater_name, normalized_rater_name, value)
      values (%L, %L, %L, 'Боб', 'боб', 8.5) returning 1
    ) select count(*) from inserted
  $q$, v_movie, v_alice, v_bob));
  perform pg_temp.record('друг оценивает фильм в открытой библиотеке', true);

  v_error := pg_temp.denied(v_bob, format($q$
    insert into public.ratings
      (movie_id, owner_id, rater_user_id, rater_name, normalized_rater_name, value)
    values (%L, %L, %L, 'Боб', 'боб', 4) returning 1
  $q$, v_movie, v_alice, v_bob));
  perform pg_temp.record('вторая оценка того же зрителя не создаётся',
    v_error is not null, coalesce(v_error, 'создались две оценки'));

  v_error := pg_temp.denied(v_bob, format($q$
    insert into public.ratings
      (movie_id, owner_id, rater_user_id, rater_name, normalized_rater_name, value)
    values (%L, %L, %L, 'чужим именем', 'чужим именем', 1)
  $q$, v_movie, v_alice, v_alice));
  perform pg_temp.record('нельзя поставить оценку от чужого имени',
    v_error is not null, coalesce(v_error, 'подделка прошла'));

  -- 5. Журнал колеса ------------------------------------------------------

  perform pg_temp.as_user(v_alice, format($q$
    with inserted as (
      insert into public.roll_sessions (host_id) values (%L) returning 1
    ) select count(*) from inserted
  $q$, v_alice));

  v_error := pg_temp.denied(v_alice, format($q$
    insert into public.roll_events (session_id, actor_id, type, payload)
    select id, %L, 'spin', '{"index":0}'::jsonb
    from public.roll_sessions where host_id = %L limit 1
  $q$, v_alice, v_alice));
  perform pg_temp.record('браузер не пишет в журнал колеса',
    v_error is not null, coalesce(v_error, 'событие записано из клиента'));

  -- 6. Приглашения --------------------------------------------------------

  v_count := pg_temp.as_user(v_alice, 'select count(*) from public.create_invite()');
  perform pg_temp.record('пользователь создаёт приглашение',
    v_count = 1, format('строк: %s', v_count));

  v_count := pg_temp.as_user(v_bob, format(
    'select count(*) from public.invites where created_by = %L', v_alice));
  perform pg_temp.record('чужие приглашения не видны',
    v_count = 0, format('строк: %s', v_count));

  -- 7. Перенос библиотеки -------------------------------------------------

  v_error := pg_temp.denied(v_bob, format($q$
    select public.import_library(jsonb_build_object(
      'movies', jsonb_build_array(jsonb_build_object(
        'id', '00000000-0000-4000-8000-00000000dead'::text,
        'owner_id', %L,
        'title', 'Чужой фильм',
        'normalized_title', 'чужой фильм',
        'status', 'queued'
      ))
    ))
  $q$, v_alice));
  -- Импорт обязан положить фильм Бобу, а не Алисе: owner_id из данных
  -- игнорируется. Поэтому вызов проходит, а фильм появляется у Боба.
  perform pg_temp.record('импорт игнорирует чужой owner_id из данных',
    v_error is null, coalesce(v_error, ''));

  v_count := pg_temp.as_user(v_bob,
    'select count(*) from public.movies where title = ''Чужой фильм'' and owner_id = auth.uid()');
  perform pg_temp.record('перенесённый фильм принадлежит вызвавшему',
    v_count = 1, format('строк: %s', v_count));

  v_error := pg_temp.denied(v_bob, $q$
    select public.import_library(jsonb_build_object('movies', jsonb_build_array()))
  $q$);
  perform pg_temp.record('повторный импорт в непустую библиотеку отклонён',
    v_error is not null, coalesce(v_error, 'импорт прошёл дважды'));
end;
$$;

-- Уборка -------------------------------------------------------------------

delete from auth.users where email like 'rls-%@cinevault.test';

-- Итог --------------------------------------------------------------------

select
  seq as "№",
  name as "проверка",
  case when passed then 'ok' else 'ПРОВАЛ' end as "результат",
  detail as "подробности"
from rls_results
order by seq;
