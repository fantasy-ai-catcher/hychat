-- Tighten Data API grants to the privileges that policies actually allow.
-- Messages are append-only for members and room_members rows are never
-- updated in place, so the wider grants were unused attack surface.
revoke update, delete on public.messages from authenticated;
revoke update on public.room_members from authenticated;

-- message_retention_min_count is a floor of recent messages to keep per
-- room. Delete only rows that are past retention AND beyond that floor,
-- instead of deleting any expired row regardless of the floor.
create or replace function public.cleanup_old_messages(batch_size int default 1000)
returns int
language plpgsql
security invoker
as $$
declare
  deleted_count int;
begin
  with ranked as (
    select
      m.id,
      m.created_at,
      row_number() over (
        partition by m.room_id
        order by m.created_at desc, m.id desc
      ) as rn,
      r.message_retention_days,
      r.message_retention_min_count
    from public.messages m
    join public.rooms r on r.id = m.room_id
  ),
  victims as (
    select id
    from ranked
    where created_at < now() - make_interval(days => message_retention_days)
      and rn > message_retention_min_count
    order by created_at
    limit batch_size
  )
  delete from public.messages m
  using victims v
  where m.id = v.id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- Cleanup functions are for scheduled jobs, not Data API callers.
-- Postgres grants execute to PUBLIC by default on new functions.
revoke all on function public.cleanup_old_messages(int) from public;
revoke all on function public.cleanup_old_messages(int) from authenticated;
revoke all on function public.cleanup_old_messages(int) from anon;
revoke all on function public.cleanup_orphan_stock_quotes() from public;
revoke all on function public.cleanup_orphan_stock_quotes() from authenticated;
revoke all on function public.cleanup_orphan_stock_quotes() from anon;

-- start_profile: only the very first active profile bootstraps as admin.
-- Everyone after that needs a valid invite code. The previous version also
-- granted admin whenever no admin or no invite code existed yet, which let
-- any reachable client claim admin until the first code was created.
-- Duplicate nicknames now fail with display_name_taken instead of leaking
-- the raw unique constraint error.
create or replace function public.start_profile(
  target_display_name text,
  invite_code text default null
)
returns table (
  id uuid,
  display_name text,
  display_color text,
  role text,
  status text
)
language plpgsql
security definer
set search_path = public, private
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  normalized_display_name text := btrim(target_display_name);
  active_profile_count int;
  invite_record public.invite_codes%rowtype;
  assigned_role text := 'member';
  result_id uuid;
  result_display_name text;
  result_display_color text;
  result_role text;
  result_status text;
begin
  if current_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if char_length(normalized_display_name) < 1 or char_length(normalized_display_name) > 80 then
    raise exception 'invalid_display_name';
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.id = current_user_id
      and p.status = 'active'
  ) then
    begin
      update public.profiles p
      set display_name = normalized_display_name,
          updated_at = now()
      where p.id = current_user_id
      returning p.id, p.display_name, p.display_color, p.role, p.status
      into result_id, result_display_name, result_display_color, result_role, result_status;
    exception
      when unique_violation then
        raise exception 'display_name_taken';
    end;

    id := result_id;
    display_name := result_display_name;
    display_color := result_display_color;
    role := result_role;
    status := result_status;
    return next;
    return;
  end if;

  select count(*)
  into active_profile_count
  from public.profiles p
  where p.status = 'active';

  if active_profile_count = 0 then
    assigned_role := 'admin';
  else
    if invite_code is null or btrim(invite_code) = '' then
      raise exception 'invite_code_required';
    end if;

    select *
    into invite_record
    from public.invite_codes ic
    where ic.code = btrim(invite_code)
      and ic.used_at is null
      and ic.expires_at > now()
    for update;

    if invite_record.id is null then
      raise exception 'invalid_invite_code';
    end if;

    update public.invite_codes ic
    set used_by = current_user_id,
        used_at = now()
    where ic.id = invite_record.id;
  end if;

  begin
    insert into public.profiles (id, email, display_name, display_color, role, status)
    values (current_user_id, null, normalized_display_name, 'white', assigned_role, 'active')
    on conflict (id) do update
    set display_name = excluded.display_name,
        role = case
          when public.profiles.role = 'admin' then public.profiles.role
          else excluded.role
        end,
        status = 'active',
        updated_at = now()
    returning profiles.id, profiles.display_name, profiles.display_color, profiles.role, profiles.status
    into result_id, result_display_name, result_display_color, result_role, result_status;
  exception
    when unique_violation then
      raise exception 'display_name_taken';
  end;

  id := result_id;
  display_name := result_display_name;
  display_color := result_display_color;
  role := result_role;
  status := result_status;
  return next;
end;
$$;

revoke all on function public.start_profile(text, text) from public;
grant execute on function public.start_profile(text, text) to authenticated;
