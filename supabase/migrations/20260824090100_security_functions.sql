-- CineVault, этап 14: вспомогательные функции для политик доступа.
--
-- Все функции объявлены security definer намеренно: политика, которая читает
-- ту же таблицу, на которую наложена, уходит в бесконечную рекурсию. Функция
-- с definer-правами обходит RLS внутри себя и возвращает наружу только «да»
-- или «нет», поэтому лишних данных через неё не утекает.

create or replace function public.is_friend(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select a is not null
     and b is not null
     and exists (
       select 1
       from public.friendships f
       where f.status = 'accepted'
         and ((f.requester_id = a and f.addressee_id = b)
           or (f.requester_id = b and f.addressee_id = a))
     );
$$;

-- Библиотека видна владельцу всегда, другу — только при явно включённой
-- видимости. По умолчанию библиотека закрыта.
create or replace function public.library_visible_to(owner uuid, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select owner = viewer
      or (
        public.is_friend(viewer, owner)
        and exists (
          select 1
          from public.profiles p
          where p.id = owner
            and p.library_visibility = 'friends'
        )
      );
$$;

create or replace function public.list_role(list uuid, uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.shared_list_members m
  where m.list_id = list
    and m.user_id = uid;
$$;

create or replace function public.is_list_member(list uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.list_role(list, uid) is not null;
$$;

create or replace function public.can_edit_list(list uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.list_role(list, uid) in ('owner', 'editor');
$$;

-- Фильм в общем списке должен быть виден всем участникам списка, даже если
-- библиотека владельца закрыта: он положил его туда сам.
create or replace function public.movie_shared_with(movie uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shared_list_items i
    join public.shared_list_members m on m.list_id = i.list_id
    where i.movie_id = movie
      and m.user_id = uid
  );
$$;

create or replace function public.is_session_member(session uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.roll_sessions s
    where s.id = session
      and s.host_id = uid
  )
  or exists (
    select 1
    from public.roll_session_members m
    where m.session_id = session
      and m.user_id = uid
  );
$$;

-- Ключ service_role и так обходит RLS; анонимному ключу эти функции не нужны.
revoke execute on function public.is_friend(uuid, uuid) from public, anon;
revoke execute on function public.library_visible_to(uuid, uuid) from public, anon;
revoke execute on function public.list_role(uuid, uuid) from public, anon;
revoke execute on function public.is_list_member(uuid, uuid) from public, anon;
revoke execute on function public.can_edit_list(uuid, uuid) from public, anon;
revoke execute on function public.movie_shared_with(uuid, uuid) from public, anon;
revoke execute on function public.is_session_member(uuid, uuid) from public, anon;

grant execute on function public.is_friend(uuid, uuid) to authenticated;
grant execute on function public.library_visible_to(uuid, uuid) to authenticated;
grant execute on function public.list_role(uuid, uuid) to authenticated;
grant execute on function public.is_list_member(uuid, uuid) to authenticated;
grant execute on function public.can_edit_list(uuid, uuid) to authenticated;
grant execute on function public.movie_shared_with(uuid, uuid) to authenticated;
grant execute on function public.is_session_member(uuid, uuid) to authenticated;
