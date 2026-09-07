-- CineVault: регистрация становится прямой.
--
-- Закрытая бета по кодам приглашений отменена решением заказчика 8 сентября
-- 2026 года. Аккаунт заводится сразу: почта, пароль, имя пользователя — и всё.
--
-- Что это меняет по существу: раньше код был вторым рубежом — знать адрес
-- сервиса было мало, требовалось ещё приглашение. Теперь единственная защита
-- от посторонних — подтверждение почты и то, что чужую библиотеку всё равно
-- не видно: политики RLS отдают строки только владельцу и принятым друзьям.
-- Регистрация открыта, доступ к данным — нет.

-- Профиль создаётся напрямую. Функция остаётся security definer: строку в
-- profiles заводит она, а не клиент, поэтому подставить чужой идентификатор
-- в обход по-прежнему нельзя.
create or replace function public.create_profile(
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
  v_profile public.profiles;
begin
  if v_user is null then
    raise exception 'Требуется вход в аккаунт.' using errcode = '28000';
  end if;

  if exists (select 1 from public.profiles where id = v_user) then
    raise exception 'Профиль уже создан.' using errcode = '23505';
  end if;

  insert into public.profiles (id, handle, display_name)
  values (v_user, lower(trim(p_handle)), trim(p_display_name))
  returning * into v_profile;

  insert into public.user_settings (user_id) values (v_user)
  on conflict (user_id) do nothing;

  return v_profile;
end;
$$;

revoke execute on function public.create_profile(text, text) from public, anon;
grant execute on function public.create_profile(text, text) to authenticated;

-- Всё, что обслуживало приглашения, уходит вместе с ними.
drop function if exists public.redeem_invite(text, text, text);
drop function if exists public.create_invite(timestamptz);
drop function if exists public.create_invite();
drop policy if exists invites_select on public.invites;
drop table if exists public.invites;
