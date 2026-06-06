create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  owner_id uuid not null references auth.users(id) on delete cascade,
  message_retention_days int not null default 30 check (message_retention_days between 1 and 365),
  message_retention_min_count int not null default 5000 check (message_retention_min_count between 100 and 50000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('text', 'system')),
  body text not null check (char_length(body) <= 2000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.room_watchlist (
  room_id uuid not null references public.rooms(id) on delete cascade,
  canonical_symbol text not null,
  added_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, canonical_symbol)
);

create table if not exists public.stock_quotes (
  canonical_symbol text not null,
  market text not null check (market in ('US', 'HK', 'CN')),
  provider_symbol text not null,
  provider_exchange text,
  mic_code text,
  name text,
  currency text,
  price numeric,
  change numeric,
  change_percent numeric,
  market_time timestamptz,
  provider text not null,
  provider_payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('ok', 'stale', 'error')),
  error_message text,
  cache_expires_at timestamptz not null,
  last_refresh_attempt_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (canonical_symbol)
);

create index if not exists messages_room_created_at_idx
  on public.messages (room_id, created_at desc);

create index if not exists messages_sender_created_at_idx
  on public.messages (sender_id, created_at desc);

create index if not exists room_members_user_id_idx
  on public.room_members (user_id);

create index if not exists room_watchlist_symbol_idx
  on public.room_watchlist (canonical_symbol);

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.rooms to authenticated;
grant select, insert, update, delete on public.room_members to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, delete on public.room_watchlist to authenticated;
grant select on public.stock_quotes to authenticated;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;
alter table public.room_watchlist enable row level security;
alter table public.stock_quotes enable row level security;

create or replace function private.is_current_user_room_member(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_members rm
    where rm.room_id = target_room_id
      and rm.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_current_user_room_owner(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_members rm
    where rm.room_id = target_room_id
      and rm.user_id = (select auth.uid())
      and rm.role = 'owner'
  );
$$;

grant usage on schema private to authenticated;
grant execute on function private.is_current_user_room_member(uuid) to authenticated;
grant execute on function private.is_current_user_room_owner(uuid) to authenticated;

create policy "profiles are readable by room peers"
on public.profiles for select
to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.room_members mine
    join public.room_members peer
      on peer.room_id = mine.room_id
    where mine.user_id = (select auth.uid())
      and peer.user_id = profiles.id
  )
);

create policy "users can insert their own profile"
on public.profiles for insert
to authenticated
with check (id = (select auth.uid()));

create policy "users can update their own profile"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "members can read rooms"
on public.rooms for select
to authenticated
using (
  owner_id = (select auth.uid())
  or private.is_current_user_room_member(id)
);

create policy "users can create owned rooms"
on public.rooms for insert
to authenticated
with check (owner_id = (select auth.uid()));

create policy "owners can update rooms"
on public.rooms for update
to authenticated
using (private.is_current_user_room_owner(id))
with check (private.is_current_user_room_owner(id));

create policy "members can read room membership"
on public.room_members for select
to authenticated
using (private.is_current_user_room_member(room_id));

create policy "owners can add members"
on public.room_members for insert
to authenticated
with check (private.is_current_user_room_owner(room_id));

create policy "room owners can add themselves"
on public.room_members for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and role = 'owner'
  and exists (
    select 1
    from public.rooms r
    where r.id = room_id
      and r.owner_id = (select auth.uid())
  )
);

create policy "owners can remove members"
on public.room_members for delete
to authenticated
using (
  private.is_current_user_room_owner(room_id)
  and user_id <> (select auth.uid())
);

create policy "members can read messages"
on public.messages for select
to authenticated
using (private.is_current_user_room_member(room_id));

create policy "members can send messages as themselves"
on public.messages for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and private.is_current_user_room_member(room_id)
);

create policy "members can read watchlists"
on public.room_watchlist for select
to authenticated
using (private.is_current_user_room_member(room_id));

create policy "members can add watchlist symbols"
on public.room_watchlist for insert
to authenticated
with check (
  added_by = (select auth.uid())
  and private.is_current_user_room_member(room_id)
);

create policy "members can remove watchlist symbols"
on public.room_watchlist for delete
to authenticated
using (private.is_current_user_room_member(room_id));

create policy "members can read quotes for watched symbols"
on public.stock_quotes for select
to authenticated
using (
  exists (
    select 1
    from public.room_watchlist rw
    where rw.canonical_symbol = stock_quotes.canonical_symbol
      and private.is_current_user_room_member(rw.room_id)
  )
);

create or replace function public.invite_room_member_by_email(target_room_id uuid, target_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
begin
  if not private.is_current_user_room_owner(target_room_id) then
    raise exception 'not_room_owner';
  end if;

  select p.id
  into target_user_id
  from public.profiles p
  where lower(p.email) = lower(target_email);

  if target_user_id is null then
    raise exception 'profile_not_found';
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (target_room_id, target_user_id, 'member')
  on conflict (room_id, user_id) do update set role = excluded.role;

  return target_user_id;
end;
$$;

revoke all on function public.invite_room_member_by_email(uuid, text) from public;
grant execute on function public.invite_room_member_by_email(uuid, text) to authenticated;

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
       or rn > message_retention_min_count
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

create or replace function public.cleanup_orphan_stock_quotes()
returns int
language plpgsql
security invoker
as $$
declare
  deleted_count int;
begin
  delete from public.stock_quotes sq
  where sq.updated_at < now() - interval '7 days'
    and not exists (
      select 1
      from public.room_watchlist rw
      where rw.canonical_symbol = sq.canonical_symbol
    );

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
