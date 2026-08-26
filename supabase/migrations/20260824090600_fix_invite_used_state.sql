-- CineVault: погашенное приглашение остаётся погашенным после удаления
-- аккаунта.
--
-- Дефект: invites.used_by при удалении пользователя обнуляется, а used_at
-- остаётся заполненным. Прежнее ограничение требовало, чтобы оба поля были
-- заполнены или оба пусты, поэтому удаление любого пользователя, гасившего
-- приглашение, падало с ошибкой 23514 — а на удалении аккаунта у нас держится
-- весь этап 15.
--
-- Просто ослабить ограничение мало: с пустым used_by код снова считался бы
-- свободным, и удаление аккаунта возвращало бы приглашение в оборот. Поэтому
-- признаком того, что код израсходован, становится used_at, а не used_by.

alter table public.invites drop constraint if exists invites_used_state;

alter table public.invites add constraint invites_used_state
  check (used_by is null or used_at is not null);

-- Кто именно погасил код — сведение полезное, но необязательное: аккаунт
-- мог быть удалён. Факт расхода хранится в used_at и переживает удаление.
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
  if v_invite.used_at is not null then
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

-- Тот же признак расхода в подсчёте неиспользованных приглашений.
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
    and used_at is null
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
