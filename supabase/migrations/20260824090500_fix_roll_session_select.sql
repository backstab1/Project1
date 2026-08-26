-- CineVault: чтение сессии колеса без перечитывания собственной таблицы.
--
-- Прежняя политика roll_sessions_select опиралась на is_session_member, а та
-- ищет строку в самой roll_sessions. При «insert ... returning» это не
-- работает: внутри одного оператора только что вставленная строка ещё не
-- видна отдельному запросу, поэтому ведущий получал отказ на свою же сессию.
-- Клиент всегда просит вернуть созданную строку, так что ломалось сразу.
--
-- Теперь ведущий узнаётся по полю строки, а участники — по отдельной таблице.

drop policy if exists roll_sessions_select on public.roll_sessions;

create policy roll_sessions_select on public.roll_sessions
  for select to authenticated
  using (
    host_id = auth.uid()
    or exists (
      select 1
      from public.roll_session_members m
      where m.session_id = roll_sessions.id
        and m.user_id = auth.uid()
    )
  );
