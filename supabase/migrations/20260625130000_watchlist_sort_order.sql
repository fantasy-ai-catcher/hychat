-- Manual, shared per-room ordering for the stock watchlist. Adds a sort_order
-- column, backfills existing rows by insertion time, auto-appends new rows, and
-- exposes a member-gated RPC to rewrite the order. listWatchlist orders by it.

alter table public.room_watchlist
  add column if not exists sort_order int not null default 0;

-- Backfill: per room, number rows by their existing insertion order.
with ordered as (
  select room_id, canonical_symbol,
         row_number() over (partition by room_id order by created_at, canonical_symbol) - 1 as rn
  from public.room_watchlist
)
update public.room_watchlist w
set sort_order = ordered.rn
from ordered
where ordered.room_id = w.room_id
  and ordered.canonical_symbol = w.canonical_symbol;

-- New rows append to the end of their room unless an explicit order was given.
create or replace function private.set_watchlist_sort_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sort_order is null or new.sort_order = 0 then
    select coalesce(max(sort_order) + 1, 0)
    into new.sort_order
    from public.room_watchlist
    where room_id = new.room_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_watchlist_sort_order on public.room_watchlist;
create trigger set_watchlist_sort_order
  before insert on public.room_watchlist
  for each row execute function private.set_watchlist_sort_order();

-- Rewrite the order: each listed symbol gets sort_order = its array index.
-- Member-gated; tolerant of symbols that are no longer present.
create or replace function public.reorder_watchlist(
  target_room_id uuid,
  ordered_symbols text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1 from public.room_members rm
    where rm.room_id = target_room_id
      and rm.user_id = current_user_id
  ) then
    raise exception 'not_a_member';
  end if;

  update public.room_watchlist w
  set sort_order = idx.position
  from (
    select symbol, ordinality - 1 as position
    from unnest(ordered_symbols) with ordinality as t(symbol, ordinality)
  ) idx
  where w.room_id = target_room_id
    and w.canonical_symbol = idx.symbol;
end;
$$;

revoke all on function public.reorder_watchlist(uuid, text[]) from public;
grant execute on function public.reorder_watchlist(uuid, text[]) to authenticated;
