-- CineVault, этап 14: политики доступа.
--
-- Правило проекта: разграничение живёт здесь, а не в клиенте. Браузер ходит с
-- анонимным ключом, и всё, что он может, описано ниже.

alter table public.profiles            enable row level security;
alter table public.invites             enable row level security;
alter table public.user_settings       enable row level security;
alter table public.categories          enable row level security;
alter table public.movies              enable row level security;
alter table public.franchises          enable row level security;
alter table public.franchise_movies    enable row level security;
alter table public.participants        enable row level security;
alter table public.ratings             enable row level security;
alter table public.friendships         enable row level security;
alter table public.shared_lists        enable row level security;
alter table public.shared_list_members enable row level security;
alter table public.shared_list_items   enable row level security;
alter table public.roll_sessions       enable row level security;
alter table public.roll_session_members enable row level security;
alter table public.roll_events         enable row level security;

-- Профили ------------------------------------------------------------------
-- Список всех пользователей не отдаётся: чужой профиль виден, только если
-- между людьми уже есть заявка или дружба. Поиск нового человека идёт через
-- find_profile_by_handle, то есть по точному имени и по одному за раз.

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.friendships f
      where (f.requester_id = auth.uid() and f.addressee_id = profiles.id)
         or (f.addressee_id = auth.uid() and f.requester_id = profiles.id)
    )
  );

-- Вставки нет намеренно: профиль появляется только в обмен на приглашение,
-- через redeem_invite.
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy invites_select on public.invites
  for select to authenticated
  using (created_by = auth.uid() or used_by = auth.uid());

-- Настройки ----------------------------------------------------------------

create policy user_settings_all on public.user_settings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Библиотека ---------------------------------------------------------------

create policy categories_select on public.categories
  for select to authenticated
  using (public.library_visible_to(owner_id, auth.uid()));

create policy categories_write on public.categories
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Владелец видит и удалённые фильмы: на них держится отмена удаления.
create policy movies_select on public.movies
  for select to authenticated
  using (
    owner_id = auth.uid()
    or (
      deleted_at is null
      and (
        public.library_visible_to(owner_id, auth.uid())
        or public.movie_shared_with(id, auth.uid())
      )
    )
  );

create policy movies_write on public.movies
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy franchises_select on public.franchises
  for select to authenticated
  using (public.library_visible_to(owner_id, auth.uid()));

create policy franchises_write on public.franchises
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy franchise_movies_select on public.franchise_movies
  for select to authenticated
  using (public.library_visible_to(owner_id, auth.uid()));

create policy franchise_movies_write on public.franchise_movies
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy participants_all on public.participants
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Оценки -------------------------------------------------------------------
-- Друг может поставить оценку в чужой библиотеке, но только свою и только
-- если библиотека ему открыта. Чужую оценку не трогает никто, кроме её автора
-- и владельца библиотеки.

create policy ratings_select on public.ratings
  for select to authenticated
  using (
    rater_user_id = auth.uid()
    or public.library_visible_to(owner_id, auth.uid())
  );

create policy ratings_insert on public.ratings
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    or (
      rater_user_id = auth.uid()
      and public.library_visible_to(owner_id, auth.uid())
    )
  );

create policy ratings_update on public.ratings
  for update to authenticated
  using (owner_id = auth.uid() or rater_user_id = auth.uid())
  with check (owner_id = auth.uid() or rater_user_id = auth.uid());

create policy ratings_delete on public.ratings
  for delete to authenticated
  using (owner_id = auth.uid() or rater_user_id = auth.uid());

-- Друзья -------------------------------------------------------------------
-- Переходы состояний проверяет триггер friendships_guard: заявку принимает
-- только адресат, и никто не «дружит» сам с собой в обход заявки.

create policy friendships_select on public.friendships
  for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy friendships_insert on public.friendships
  for insert to authenticated
  with check (requester_id = auth.uid() and status in ('pending', 'blocked'));

create policy friendships_update on public.friendships
  for update to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid())
  with check (requester_id = auth.uid() or addressee_id = auth.uid());

create policy friendships_delete on public.friendships
  for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- Общие списки -------------------------------------------------------------

create policy shared_lists_select on public.shared_lists
  for select to authenticated
  using (owner_id = auth.uid() or public.is_list_member(id, auth.uid()));

create policy shared_lists_insert on public.shared_lists
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy shared_lists_update on public.shared_lists
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy shared_lists_delete on public.shared_lists
  for delete to authenticated
  using (owner_id = auth.uid());

create policy shared_list_members_select on public.shared_list_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_list_member(list_id, auth.uid()));

create policy shared_list_members_insert on public.shared_list_members
  for insert to authenticated
  with check (
    exists (
      select 1 from public.shared_lists l
      where l.id = list_id and l.owner_id = auth.uid()
    )
  );

create policy shared_list_members_update on public.shared_list_members
  for update to authenticated
  using (
    exists (
      select 1 from public.shared_lists l
      where l.id = list_id and l.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.shared_lists l
      where l.id = list_id and l.owner_id = auth.uid()
    )
  );

-- Выйти из общего списка можно самому, не спрашивая владельца.
create policy shared_list_members_delete on public.shared_list_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.shared_lists l
      where l.id = list_id and l.owner_id = auth.uid()
    )
  );

create policy shared_list_items_select on public.shared_list_items
  for select to authenticated
  using (public.is_list_member(list_id, auth.uid()));

-- Подзапрос по movies сам подчиняется политике movies_select, поэтому положить
-- в список фильм, которого не видишь, нельзя.
create policy shared_list_items_insert on public.shared_list_items
  for insert to authenticated
  with check (
    added_by = auth.uid()
    and public.can_edit_list(list_id, auth.uid())
    and exists (select 1 from public.movies m where m.id = movie_id)
  );

create policy shared_list_items_update on public.shared_list_items
  for update to authenticated
  using (public.can_edit_list(list_id, auth.uid()))
  with check (public.can_edit_list(list_id, auth.uid()));

create policy shared_list_items_delete on public.shared_list_items
  for delete to authenticated
  using (
    added_by = auth.uid()
    or public.can_edit_list(list_id, auth.uid())
  );

-- Сессии колеса ------------------------------------------------------------

create policy roll_sessions_select on public.roll_sessions
  for select to authenticated
  using (public.is_session_member(id, auth.uid()));

create policy roll_sessions_insert on public.roll_sessions
  for insert to authenticated
  with check (host_id = auth.uid());

create policy roll_sessions_update on public.roll_sessions
  for update to authenticated
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

create policy roll_sessions_delete on public.roll_sessions
  for delete to authenticated
  using (host_id = auth.uid());

create policy roll_session_members_select on public.roll_session_members
  for select to authenticated
  using (public.is_session_member(session_id, auth.uid()));

create policy roll_session_members_insert on public.roll_session_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.roll_sessions s
      where s.id = session_id and s.host_id = auth.uid()
    )
  );

create policy roll_session_members_delete on public.roll_session_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.roll_sessions s
      where s.id = session_id and s.host_id = auth.uid()
    )
  );

-- Журнал событий только читают. Пишет его Edge Function ключом service_role:
-- случайность спина и право хода не могут исходить из браузера, иначе колесо
-- перестаёт быть общим. Политики update и delete нет ни для кого — журнал
-- неизменяем по определению.
create policy roll_events_select on public.roll_events
  for select to authenticated
  using (public.is_session_member(session_id, auth.uid()));
