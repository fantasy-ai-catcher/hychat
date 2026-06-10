-- The project carries Supabase legacy default privileges that granted ALL
-- (including TRUNCATE, which RLS does not govern) on every public table to
-- both anon and authenticated. Reset everything to the explicit minimum the
-- RLS policies actually support: anon gets nothing, authenticated gets only
-- the verbs it uses through the Data API.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select on public.profiles to authenticated;
grant select, insert, update on public.rooms to authenticated;
grant select, insert, delete on public.room_members to authenticated;
grant select, insert on public.messages to authenticated;
grant select, insert, delete on public.room_watchlist to authenticated;
grant select on public.stock_quotes to authenticated;

-- invite_codes intentionally has no direct Data API access: codes are
-- created via create_invite_code() and consumed inside start_profile(),
-- both security definer RPCs.

-- Stop future tables from receiving blanket grants automatically. New
-- tables must ship their own explicit grants in the migration that
-- creates them (see CLAUDE.md).
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
