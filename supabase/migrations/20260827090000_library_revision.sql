-- CineVault, этап 16: оптимистичная блокировка записи.
--
-- Приложение правит библиотеку пакетами, собранными из снимка в памяти:
-- перенос фильма между списками переписывает позиции соседей, удаление списка
-- трогает все его фильмы. Поэтому блокировка стоит не на строке, а на всей
-- библиотеке владельца: сравнивать updated_at каждой строки бессмысленно,
-- если пакет опирается на состояние соседних строк, а удаление строки на
-- другом устройстве вообще не оставляет времени, с которым можно сравнить.
--
-- Ревизия — счётчик в user_settings: строка на пользователя там уже есть,
-- заводить ради счётчика отдельную таблицу нечего. Каждый успешный пакет
-- увеличивает её на единицу. Клиент запоминает ревизию при загрузке и
-- присылает обратно; если на сервере она другая, значит между загрузкой и
-- записью кто-то уже писал, и пакет отвергается целиком.

alter table public.user_settings
  add column if not exists revision bigint not null default 0;

-- Ревизия читается вместе с библиотекой; отдельная функция нужна на случай,
-- когда строки настроек ещё нет — у нового аккаунта её и не будет.
create or replace function public.library_revision()
returns bigint
language sql
stable
as $$
  select coalesce(
    (select revision from public.user_settings where user_id = auth.uid()),
    0
  );
$$;

revoke execute on function public.library_revision() from public, anon;
grant execute on function public.library_revision() to authenticated;

-- Возвращаемый тип меняется с void на bigint, поэтому старую версию нужно
-- снять: create or replace такое не переживает.
drop function if exists public.apply_library_changes(jsonb);

create or replace function public.apply_library_changes(
  commands jsonb,
  expected_revision bigint default null
)
returns bigint
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_current bigint;
  v_next bigint;
  v_command jsonb;
  v_table text;
  v_op text;
  v_movie public.movies;
  v_franchise public.franchises;
  v_category public.categories;
  v_participant public.participants;
  v_session public.roll_sessions;
  v_rating public.ratings;
  v_keep uuid[];
begin
  if v_user is null then
    raise exception 'Требуется вход в аккаунт.' using errcode = '28000';
  end if;

  -- Строка настроек заодно служит замком: пока пакет не закончился, второй
  -- пакет того же владельца ждёт здесь, а не переплетается с этим.
  insert into public.user_settings (user_id, data)
  values (v_user, '{}'::jsonb)
  on conflict (user_id) do nothing;

  select revision into v_current
  from public.user_settings
  where user_id = v_user
  for update;

  if expected_revision is not null and expected_revision <> v_current then
    -- Код PT409, а не 40001. Класс 40 означает «транзакция откачена, повторите»,
    -- и PostgREST повторяет такой запрос сам; расхождение ревизий постоянное,
    -- поэтому запрос уходил в бесконечный повтор и не возвращался вовсе.
    -- Коды вида PTxxx PostgREST превращает в HTTP-статус xxx: клиент получает
    -- 409 Conflict с этим же текстом.
    raise exception
      'Библиотека изменилась на другом устройстве (ревизия % вместо %).',
      v_current, expected_revision
      using errcode = 'PT409';
  end if;

  for v_command in select * from jsonb_array_elements(coalesce(commands, '[]'::jsonb))
  loop
    v_table := v_command ->> 'table';
    v_op := v_command ->> 'op';

    if v_op = 'delete' then
      -- Имя таблицы приходит снаружи, поэтому оно не подставляется в запрос, а
      -- сверяется со списком известных: динамический SQL здесь не нужен.
      if v_table = 'movies' then
        delete from public.movies
        where id = (v_command ->> 'id')::uuid and owner_id = v_user;
      elsif v_table = 'categories' then
        delete from public.categories
        where id = (v_command ->> 'id')::uuid and owner_id = v_user;
      elsif v_table = 'franchises' then
        delete from public.franchises
        where id = (v_command ->> 'id')::uuid and owner_id = v_user;
      elsif v_table = 'participants' then
        delete from public.participants
        where id = (v_command ->> 'id')::uuid and owner_id = v_user;
      elsif v_table = 'roll_sessions' then
        delete from public.roll_sessions
        where id = (v_command ->> 'id')::uuid and host_id = v_user;
      else
        raise exception 'Удаление из таблицы «%» не поддерживается.', v_table
          using errcode = '22023';
      end if;

    elsif v_op = 'setting' then
      update public.user_settings
      set data = data || jsonb_build_object(v_command ->> 'key', v_command -> 'value')
      where user_id = v_user;

    elsif v_op = 'put' and v_table = 'movies' then
      v_movie := jsonb_populate_record(null::public.movies, v_command -> 'row');
      v_movie.owner_id := v_user;
      v_movie := public.movie_defaults(v_movie);
      insert into public.movies select v_movie.*
      on conflict (id) do update set
        category_id = excluded.category_id,
        category_position = excluded.category_position,
        title = excluded.title,
        normalized_title = excluded.normalized_title,
        original_title = excluded.original_title,
        tmdb_id = excluded.tmdb_id,
        overview = excluded.overview,
        genres = excluded.genres,
        tags = excluded.tags,
        notes = excluded.notes,
        is_favorite = excluded.is_favorite,
        status = excluded.status,
        watched_at = excluded.watched_at,
        cover_url = excluded.cover_url,
        release_year = excluded.release_year,
        duration_minutes = excluded.duration_minutes,
        country = excluded.country,
        tmdb_updated_at = excluded.tmdb_updated_at;

      -- Оценки приходят полным составом карточки, поэтому исчезнувшие удаляем.
      select coalesce(array_agg((r ->> 'id')::uuid), '{}')
      into v_keep
      from jsonb_array_elements(coalesce(v_command -> 'ratings', '[]'::jsonb)) as r;

      delete from public.ratings
      where movie_id = v_movie.id
        and owner_id = v_user
        and not (id = any (v_keep));

      for v_rating in
        select (jsonb_populate_record(null::public.ratings, r)).*
        from jsonb_array_elements(coalesce(v_command -> 'ratings', '[]'::jsonb)) as r
      loop
        v_rating.owner_id := v_user;
        v_rating.movie_id := v_movie.id;
        v_rating.id := coalesce(v_rating.id, gen_random_uuid());
        v_rating.created_at := coalesce(v_rating.created_at, now());
        v_rating.updated_at := coalesce(v_rating.updated_at, now());
        insert into public.ratings select v_rating.*
        on conflict (id) do update set
          rater_name = excluded.rater_name,
          normalized_rater_name = excluded.normalized_rater_name,
          rater_user_id = excluded.rater_user_id,
          value = excluded.value;
      end loop;

    elsif v_op = 'put' and v_table = 'franchises' then
      v_franchise := jsonb_populate_record(null::public.franchises, v_command -> 'row');
      v_franchise.owner_id := v_user;
      v_franchise.id := coalesce(v_franchise.id, gen_random_uuid());
      v_franchise.category_position := coalesce(v_franchise.category_position, 0);
      v_franchise.created_at := coalesce(v_franchise.created_at, now());
      v_franchise.updated_at := coalesce(v_franchise.updated_at, now());
      insert into public.franchises select v_franchise.*
      on conflict (id) do update set
        category_id = excluded.category_id,
        category_position = excluded.category_position,
        name = excluded.name,
        normalized_name = excluded.normalized_name;

      delete from public.franchise_movies
      where franchise_id = v_franchise.id
        and owner_id = v_user;

      insert into public.franchise_movies (movie_id, franchise_id, owner_id, sort_order)
      select value::uuid, v_franchise.id, v_user, ordinality - 1
      from jsonb_array_elements_text(coalesce(v_command -> 'movie_ids', '[]'::jsonb))
        with ordinality
      on conflict (movie_id) do update set
        franchise_id = excluded.franchise_id,
        sort_order = excluded.sort_order;

    elsif v_op = 'put' and v_table = 'categories' then
      v_category := jsonb_populate_record(null::public.categories, v_command -> 'row');
      v_category.owner_id := v_user;
      v_category.id := coalesce(v_category.id, gen_random_uuid());
      v_category.sort_order := coalesce(v_category.sort_order, 0);
      v_category.roll_quota := coalesce(v_category.roll_quota, 0);
      v_category.created_at := coalesce(v_category.created_at, now());
      v_category.updated_at := coalesce(v_category.updated_at, now());
      insert into public.categories select v_category.*
      on conflict (id) do update set
        parent_id = excluded.parent_id,
        name = excluded.name,
        normalized_name = excluded.normalized_name,
        sort_order = excluded.sort_order,
        roll_quota = excluded.roll_quota;

    elsif v_op = 'put' and v_table = 'participants' then
      v_participant := jsonb_populate_record(null::public.participants, v_command -> 'row');
      v_participant.owner_id := v_user;
      v_participant.id := coalesce(v_participant.id, gen_random_uuid());
      v_participant.last_used_at := coalesce(v_participant.last_used_at, now());
      v_participant.created_at := coalesce(v_participant.created_at, now());
      v_participant.updated_at := coalesce(v_participant.updated_at, now());
      insert into public.participants select v_participant.*
      on conflict (id) do update set
        name = excluded.name,
        normalized_name = excluded.normalized_name,
        last_used_at = excluded.last_used_at;

    elsif v_op = 'put' and v_table = 'roll_sessions' then
      v_session := jsonb_populate_record(null::public.roll_sessions, v_command -> 'row');
      v_session.host_id := v_user;
      v_session.id := coalesce(v_session.id, gen_random_uuid());
      v_session.status := coalesce(v_session.status, 'active');
      v_session.state := coalesce(v_session.state, '{}'::jsonb);
      v_session.save_threshold := coalesce(v_session.save_threshold, 3);
      v_session.created_at := coalesce(v_session.created_at, now());
      v_session.updated_at := coalesce(v_session.updated_at, now());
      insert into public.roll_sessions select v_session.*
      on conflict (id) do update set
        status = excluded.status,
        state = excluded.state,
        save_threshold = excluded.save_threshold,
        completed_at = excluded.completed_at;

    else
      raise exception 'Неизвестная операция «%» для таблицы «%».', v_op, v_table
        using errcode = '22023';
    end if;
  end loop;

  update public.user_settings
  set revision = revision + 1
  where user_id = v_user
  returning revision into v_next;

  return v_next;
end;
$$;

revoke execute on function public.apply_library_changes(jsonb, bigint) from public, anon;
grant execute on function public.apply_library_changes(jsonb, bigint) to authenticated;

-- Переноса библиотеки в аккаунт больше нет: библиотека с самого начала
-- живёт на сервере, а файлов, из которых её можно было бы влить, приложение
-- не создаёт. Функция удаляется вместе с этим решением.
drop function if exists public.import_library(jsonb);
