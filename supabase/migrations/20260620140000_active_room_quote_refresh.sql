-- Server-side scheduled stock refresh, keyed by room.
--
-- Quotes should refresh automatically while a room has people AND a watchlist,
-- without depending on any one client polling. Presence today is ephemeral
-- Realtime channel state (not in Postgres), so cron cannot see who is online.
-- We persist a lightweight heartbeat so a scheduled job can find "active" rooms,
-- fetch their symbols once (batched), and push each room its quotes in a single
-- realtime broadcast.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Liveness heartbeat. Bounded by rooms x members (tiny) and overwritten in
-- place, so no pruning job is needed; FK cascade handles room/user deletion.
create table if not exists public.room_presence (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_seen timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_presence_last_seen_idx
  on public.room_presence (last_seen);

alter table public.room_presence enable row level security;

-- Writes go through the RPC only; no direct table grants to authenticated.
-- A self-heartbeat needs SECURITY DEFINER, mirroring join_room / leave_room.
create or replace function public.heartbeat_presence(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.is_current_user_active_profile() then
    raise exception 'inactive_profile';
  end if;

  if not private.is_current_user_room_member(target_room_id) then
    raise exception 'not_a_room_member';
  end if;

  insert into public.room_presence (room_id, user_id, last_seen)
  values (target_room_id, (select auth.uid()), now())
  on conflict (room_id, user_id) do update set last_seen = now();
end;
$$;

revoke execute on function public.heartbeat_presence(uuid) from public;
grant execute on function public.heartbeat_presence(uuid) to authenticated;

-- (room_id, canonical_symbol) for every watchlist entry of a room that has a
-- recent heartbeat. The refresh function dedupes the union to fetch each symbol
-- once, then broadcasts each room only its own symbols. service_role only.
create or replace function public.active_rooms_with_symbols(stale_after_seconds int default 90)
returns table (room_id uuid, canonical_symbol text)
language sql
stable
security definer
set search_path = public
as $$
  select rw.room_id, rw.canonical_symbol
  from public.room_watchlist rw
  where exists (
    select 1
    from public.room_presence rp
    where rp.room_id = rw.room_id
      and rp.last_seen > now() - make_interval(secs => stale_after_seconds)
  );
$$;

revoke all on function public.active_rooms_with_symbols(int) from public;
revoke all on function public.active_rooms_with_symbols(int) from anon;
revoke all on function public.active_rooms_with_symbols(int) from authenticated;
grant execute on function public.active_rooms_with_symbols(int) to service_role;

-- Cookie + crumb for Yahoo's batch quote route. Single row, refreshed by the
-- edge function on rejection. Public so the service-role Data API client can
-- reach it, but RLS-on with no policies/grants keeps every client out.
create table if not exists public.yahoo_auth (
  id int primary key default 1 check (id = 1),
  cookie text,
  crumb text,
  updated_at timestamptz not null default now()
);

alter table public.yahoo_auth enable row level security;
grant select, insert, update on public.yahoo_auth to service_role;

-- Cron entrypoint: fire the refresh edge function via pg_net. URL + secret live
-- in Vault (never committed); this is a safe no-op until they are inserted.
create or replace function private.trigger_active_quote_refresh()
returns void
language plpgsql
security definer
set search_path = public, private, vault, net
as $$
declare
  fn_url text;
  cron_secret text;
begin
  select decrypted_secret into fn_url
  from vault.decrypted_secrets
  where name = 'refresh_active_quotes_url';

  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'stock_refresh_cron_secret';

  if fn_url is null or cron_secret is null then
    return;
  end if;

  perform net.http_post(
    url := fn_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function private.trigger_active_quote_refresh() from public;
revoke all on function private.trigger_active_quote_refresh() from anon;
revoke all on function private.trigger_active_quote_refresh() from authenticated;

-- Every 10s (pg_cron 1.5+ seconds syntax). One batched Yahoo request + one
-- broadcast per room per tick, so this rate is independent of symbol count.
-- Keep STOCK_QUOTE_CACHE_TTL_SECONDS at ~10 so each tick is a real refresh.
-- Unschedule first so re-running is safe.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-active-quotes') then
    perform cron.unschedule('refresh-active-quotes');
  end if;
end $$;

select cron.schedule(
  'refresh-active-quotes',
  '10 seconds',
  $$select private.trigger_active_quote_refresh();$$
);

-- Sanity cap on watchlist size. A v7 batch easily handles 50 in one request,
-- so this is a guard rail, not a performance limit.
create or replace function public.enforce_watchlist_cap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.room_watchlist where room_id = new.room_id) >= 50 then
    raise exception 'watchlist_full';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_watchlist_cap on public.room_watchlist;
create trigger enforce_watchlist_cap
  before insert on public.room_watchlist
  for each row execute function public.enforce_watchlist_cap();
