-- CineVault, этап 14: точки входа, которые нельзя отдать политикам.

-- Приглашения --------------------------------------------------------------

-- Алфавит без I, O, 0 и 1: код диктуют голосом и переписывают руками.
create or replace function public.generate_invite_code()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
           1 + floor(random() * 32)::int, 1),
    ''
  )
  from generate_series(1, 8);
$$;

-- Регистрация закрытая: аккаунт без профиля не видит и не может ничего.
-- Профиль выдаётся здесь, в обмен на действующий код.
create or replace function public.redeem_invite(
  p_code text,
  p_handle text,
  p_display_name text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invite public.invites;
  v_profile public.profiles;
begin
  if v_user is null then
    raise exception 'Требуется вход в аккаунт.' using errcode = '28000';
  end if;

  if exists (select 1 from public.profiles where id = v_user) then
    raise exception 'Профиль уже создан.' using errcode = '23505';
  end if;

  select * into v_invite
  from public.invites
  where code = upper(trim(p_code))
  for update;

  if v_invite.code is null then
    raise exception 'Код приглашения не найден.' using errcode = '22023';
  end if;
  if v_invite.used_by is not null then
    raise exception 'Код приглашения уже использован.' using errcode = '22023';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'Срок действия кода истёк.' using errcode = '22023';
  end if;

  insert into public.profiles (id, handle, display_name)
  values (v_user, lower(trim(p_handle)), trim(p_display_name))
  returning * into v_profile;

  insert into public.user_settings (user_id) values (v_user)
  on conflict (user_id) do nothing;

  update public.invites
  set used_by = v_user, used_at = now()
  where code = v_invite.code;

  return v_profile;
end;
$$;

-- Каждый может позвать знакомых, но не может раздавать коды пачками.
create or replace function public.create_invite()
returns public.invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_unused integer;
  v_code text;
  v_invite public.invites;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user) then
    raise exception 'Требуется профиль.' using errcode = '28000';
  end if;

  select count(*) into v_unused
  from public.invites
  where created_by = v_user
    and used_by is null
    and (expires_at is null or expires_at > now());

  if v_unused >= 5 then
    raise exception 'Уже есть пять неиспользованных приглашений.'
      using errcode = '54000';
  end if;

  loop
    v_code := public.generate_invite_code();
    exit when not exists (select 1 from public.invites where code = v_code);
  end loop;

  insert into public.invites (code, created_by, expires_at)
  values (v_code, v_user, now() + interval '30 days')
  returning * into v_invite;

  return v_invite;
end;
$$;

-- Поиск друга --------------------------------------------------------------

-- Профили закрыты политикой, поэтому нового человека находят по точному
-- имени и по одному за раз: выгрузить список всех пользователей нельзя.
create or replace function public.find_profile_by_handle(p_handle text)
returns table (id uuid, handle text, display_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.profiles where profiles.id = v_user) then
    raise exception 'Требуется профиль.' using errcode = '28000';
  end if;

  return query
  select p.id, p.handle, p.display_name
  from public.profiles p
  where p.handle = lower(trim(p_handle))
    and p.id <> v_user
    -- Заблокировавший не должен находиться поиском.
    and not exists (
      select 1 from public.friendships f
      where f.status = 'blocked'
        and ((f.requester_id = p.id and f.addressee_id = v_user)
          or (f.addressee_id = p.id and f.requester_id = v_user))
    );
end;
$$;

-- Заявки в друзья ----------------------------------------------------------

-- Политика решает, кто может трогать строку; переходы состояний — здесь.
create or replace function public.friendships_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'accepted' then
      raise exception 'Дружба начинается с заявки.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.status = 'accepted' and old.status <> 'accepted' then
    if auth.uid() <> old.addressee_id then
      raise exception 'Принять заявку может только адресат.' using errcode = '42501';
    end if;
    new.responded_at := now();
  end if;

  if new.status = 'blocked' and old.status <> 'blocked' then
    new.responded_at := now();
  end if;

  -- Разблокировка не возвращает дружбу молча: строка удаляется, заявка подаётся
  -- заново.
  if old.status = 'blocked' and new.status <> 'blocked' then
    raise exception 'Снимите блокировку удалением заявки.' using errcode = '23514';
  end if;

  if new.requester_id <> old.requester_id or new.addressee_id <> old.addressee_id then
    raise exception 'Участники заявки не меняются.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger friendships_guard_trigger
  before insert or update on public.friendships
  for each row execute function public.friendships_guard();

-- Сотня пользователей — это уже незнакомцы: без ограничения один аккаунт
-- может засыпать заявками всех остальных.
create or replace function public.friendships_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
begin
  select count(*) into v_recent
  from public.friendships
  where requester_id = new.requester_id
    and created_at > now() - interval '1 day';

  if v_recent >= 20 then
    raise exception 'Слишком много заявок за сутки. Попробуйте завтра.'
      using errcode = '54000';
  end if;

  return new;
end;
$$;

create trigger friendships_rate_limit_trigger
  before insert on public.friendships
  for each row execute function public.friendships_rate_limit();

-- Права --------------------------------------------------------------------

revoke execute on function public.generate_invite_code() from public, anon, authenticated;
revoke execute on function public.redeem_invite(text, text, text) from public, anon;
revoke execute on function public.create_invite() from public, anon;
revoke execute on function public.find_profile_by_handle(text) from public, anon;

grant execute on function public.redeem_invite(text, text, text) to authenticated;
grant execute on function public.create_invite() to authenticated;
grant execute on function public.find_profile_by_handle(text) to authenticated;
