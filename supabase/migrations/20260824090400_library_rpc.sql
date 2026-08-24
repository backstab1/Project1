-- CineVault, этап 16: запись библиотеки.
--
-- Обе функции — security invoker: они работают правами вызывающего, и каждая
-- строка проходит через политики RLS. Владельца берём из auth.uid(), а не из
-- присланных данных: подставить чужой owner_id в JSON нельзя.
--
-- Функция в Postgres выполняется в одной транзакции. Это и есть то самое
-- «пакет либо применяется целиком, либо не применяется вовсе», на котором
-- держатся массовые операции каталога.
--
-- Важная тонкость jsonb_populate_record: отсутствующее в JSON поле становится
-- NULL, а NULL при вставке подставляется вместо default и роняет not null.
-- Поэтому обязательные времена и статусы проходят через coalesce.

-- У фильма обязательных полей со значением по умолчанию слишком много, чтобы
-- перечислять их дважды, поэтому они собраны здесь.
create or replace function public.movie_defaults(p_movie public.movies)
returns public.movies
language plpgsql
immutable
as $$
begin
  p_movie.id := coalesce(p_movie.id, gen_random_uuid());
  p_movie.category_position := coalesce(p_movie.category_position, 0);
  p_movie.original_title := coalesce(p_movie.original_title, '');
  p_movie.overview := coalesce(p_movie.overview, '');
  p_movie.genres := coalesce(p_movie.genres, '{}');
  p_movie.tags := coalesce(p_movie.tags, '{}');
  p_movie.notes := coalesce(p_movie.notes, '');
  p_movie.is_favorite := coalesce(p_movie.is_favorite, false);
  p_movie.status := coalesce(p_movie.status, 'queued');
  p_movie.cover_url := coalesce(p_movie.cover_url, '');
  p_movie.country := coalesce(p_movie.country, '');
  p_movie.created_at := coalesce(p_movie.created_at, now());
  p_movie.updated_at := coalesce(p_movie.updated_at, now());
  return p_movie;
end;
$$;

-- Перенос существующей библиотеки -----------------------------------------

create or replace function public.import_library(payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_existing integer;
  v_item jsonb;
  v_movie public.movies;
  v_franchise public.franchises;
  v_category public.categories;
  v_participant public.participants;
  v_rating public.ratings;
  v_counts jsonb;
begin
  if v_user is null then
    raise exception 'Требуется вход в аккаунт.' using errcode = '28000';
  end if;

  -- Перенос делается один раз в пустую библиотеку. Повторный вызов означал бы
  -- слияние, а слияние — отдельная операция с разбором дублей.
  select count(*) into v_existing from public.movies where owner_id = v_user;
  if v_existing > 0 then
    raise exception 'Библиотека уже не пуста: в ней % фильмов.', v_existing
      using errcode = '23505';
  end if;

  -- Родитель может встретиться в списке позже ребёнка, поэтому связи между
  -- списками проставляются вторым проходом.
  for v_item in select * from jsonb_array_elements(coalesce(payload -> 'categories', '[]'::jsonb))
  loop
    v_category := jsonb_populate_record(null::public.categories, v_item);
    v_category.owner_id := v_user;
    v_category.parent_id := null;
    v_category.id := coalesce(v_category.id, gen_random_uuid());
    v_category.sort_order := coalesce(v_category.sort_order, 0);
    v_category.roll_quota := coalesce(v_category.roll_quota, 0);
    v_category.created_at := coalesce(v_category.created_at, now());
    v_category.updated_at := coalesce(v_category.updated_at, now());
    insert into public.categories select v_category.*;
  end loop;

  update public.categories c
  set parent_id = (item ->> 'parent_id')::uuid
  from jsonb_array_elements(coalesce(payload -> 'categories', '[]'::jsonb)) as item
  where c.id = (item ->> 'id')::uuid
    and c.owner_id = v_user
    and item ->> 'parent_id' is not null;

  for v_item in select * from jsonb_array_elements(coalesce(payload -> 'movies', '[]'::jsonb))
  loop
    v_movie := jsonb_populate_record(null::public.movies, v_item - 'ratings');
    v_movie.owner_id := v_user;
    v_movie := public.movie_defaults(v_movie);
    insert into public.movies select v_movie.*;

    for v_rating in
      select (jsonb_populate_record(null::public.ratings, r)).*
      from jsonb_array_elements(coalesce(v_item -> 'ratings', '[]'::jsonb)) as r
    loop
      v_rating.owner_id := v_user;
      v_rating.movie_id := v_movie.id;
      v_rating.id := coalesce(v_rating.id, gen_random_uuid());
      v_rating.created_at := coalesce(v_rating.created_at, now());
      v_rating.updated_at := coalesce(v_rating.updated_at, now());
      insert into public.ratings select v_rating.*;
    end loop;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(payload -> 'franchises', '[]'::jsonb))
  loop
    v_franchise := jsonb_populate_record(null::public.franchises, v_item - 'movie_ids');
    v_franchise.owner_id := v_user;
    v_franchise.id := coalesce(v_franchise.id, gen_random_uuid());
    v_franchise.category_position := coalesce(v_franchise.category_position, 0);
    v_franchise.created_at := coalesce(v_franchise.created_at, now());
    v_franchise.updated_at := coalesce(v_franchise.updated_at, now());
    insert into public.franchises select v_franchise.*;

    insert into public.franchise_movies (movie_id, franchise_id, owner_id, sort_order)
    select value::uuid, v_franchise.id, v_user, ordinality - 1
    from jsonb_array_elements_text(coalesce(v_item -> 'movie_ids', '[]'::jsonb))
      with ordinality;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(payload -> 'participants', '[]'::jsonb))
  loop
    v_participant := jsonb_populate_record(null::public.participants, v_item);
    v_participant.owner_id := v_user;
    v_participant.id := coalesce(v_participant.id, gen_random_uuid());
    v_participant.last_used_at := coalesce(v_participant.last_used_at, now());
    v_participant.created_at := coalesce(v_participant.created_at, now());
    v_participant.updated_at := coalesce(v_participant.updated_at, now());
    insert into public.participants select v_participant.*;
  end loop;

  select jsonb_build_object(
    'movies', (select count(*) from public.movies where owner_id = v_user),
    'categories', (select count(*) from public.categories where owner_id = v_user),
    'franchises', (select count(*) from public.franchises where owner_id = v_user),
    'participants', (select count(*) from public.participants where owner_id = v_user),
    'ratings', (select count(*) from public.ratings where owner_id = v_user)
  ) into v_counts;

  return v_counts;
end;
$$;

-- Пакет изменений ----------------------------------------------------------

create or replace function public.apply_library_changes(commands jsonb)
returns void
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
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
      insert into public.user_settings (user_id, data)
      values (
        v_user,
        jsonb_build_object(v_command ->> 'key', v_command -> 'value')
      )
      on conflict (user_id) do update
      set data = user_settings.data
        || jsonb_build_object(v_command ->> 'key', v_command -> 'value');

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
end;
$$;

revoke execute on function public.import_library(jsonb) from public, anon;
revoke execute on function public.apply_library_changes(jsonb) from public, anon;
grant execute on function public.import_library(jsonb) to authenticated;
grant execute on function public.apply_library_changes(jsonb) to authenticated;
