-- Quote updates need a realtime path so all members see refreshes without
-- polling. RLS already limits rows to symbols on the member's watchlists.
do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stock_quotes'
  ) then
    alter publication supabase_realtime add table public.stock_quotes;
  end if;
end $$;

-- Room-bound invite codes collapse the two-step flow (activate, then be
-- invited into a room) into one: a code created inside a room activates the
-- profile and joins that room.
alter table public.invite_codes
  add column if not exists room_id uuid references public.rooms(id) on delete cascade;

drop function if exists public.create_invite_code();

create or replace function public.create_invite_code(target_room_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  new_code text;
begin
  if not private.is_current_user_active_profile() then
    raise exception 'inactive_profile';
  end if;

  if target_room_id is null then
    if not private.is_current_user_admin() then
      raise exception 'not_admin';
    end if;
  else
    if not (
      private.is_current_user_admin()
      or private.is_current_user_room_owner(target_room_id)
    ) then
      raise exception 'not_room_owner';
    end if;
  end if;

  new_code := lower(replace(gen_random_uuid()::text, '-', ''));

  insert into public.invite_codes (code, created_by, room_id)
  values (new_code, auth.uid(), target_room_id);

  return new_code;
end;
$$;

revoke all on function public.create_invite_code(uuid) from public;
grant execute on function public.create_invite_code(uuid) to authenticated;

-- Issuers need visibility and control over their codes: list shows scope,
-- usage, and expiry; revoke removes an unused code.
create or replace function public.list_invite_codes()
returns table (
  code text,
  room_id uuid,
  room_name text,
  used_by_display_name text,
  used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    ic.code,
    ic.room_id,
    r.name as room_name,
    p.display_name as used_by_display_name,
    ic.used_at,
    ic.expires_at,
    ic.created_at
  from public.invite_codes ic
  left join public.rooms r on r.id = ic.room_id
  left join public.profiles p on p.id = ic.used_by
  where ic.created_by = (select auth.uid())
     or private.is_current_user_admin()
  order by ic.created_at desc;
$$;

revoke all on function public.list_invite_codes() from public;
grant execute on function public.list_invite_codes() to authenticated;

create or replace function public.revoke_invite_code(target_code text)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  deleted_count int;
begin
  delete from public.invite_codes ic
  where ic.code = btrim(target_code)
    and ic.used_at is null
    and (
      ic.created_by = auth.uid()
      or private.is_current_user_admin()
    );

  get diagnostics deleted_count = row_count;

  if deleted_count = 0 then
    raise exception 'invite_code_not_found';
  end if;

  return true;
end;
$$;

revoke all on function public.revoke_invite_code(text) from public;
grant execute on function public.revoke_invite_code(text) to authenticated;

-- start_profile: consuming a room-bound code also joins the room.
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

  if invite_record.id is not null and invite_record.room_id is not null then
    insert into public.room_members (room_id, user_id, role)
    values (invite_record.room_id, current_user_id, 'member')
    on conflict (room_id, user_id) do nothing;
  end if;

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

-- Server-side message flood guard: at most 10 messages per sender per
-- 10 seconds. The 2000-char body cap was the only abuse limit before.
create or replace function private.enforce_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*)
    from public.messages m
    where m.sender_id = new.sender_id
      and m.created_at > now() - interval '10 seconds'
  ) >= 10 then
    raise exception 'rate_limited';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_message_rate_limit on public.messages;
create trigger enforce_message_rate_limit
before insert on public.messages
for each row
execute function private.enforce_message_rate_limit();

-- Anonymous auth users that never activated a profile accumulate forever.
-- For cron or manual ops use only; no client role can execute it.
create or replace function private.cleanup_orphan_anonymous_users(
  max_age interval default interval '7 days'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count int;
begin
  delete from auth.users u
  where u.is_anonymous
    and u.created_at < now() - max_age
    and not exists (
      select 1
      from public.profiles p
      where p.id = u.id
    );

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function private.cleanup_orphan_anonymous_users(interval) from public;
revoke all on function private.cleanup_orphan_anonymous_users(interval) from authenticated;
revoke all on function private.cleanup_orphan_anonymous_users(interval) from anon;
