-- The refresh cron fires every 10s regardless of who is online. When no room
-- has a present user watching symbols there is nothing to refresh, yet the old
-- trigger still POSTed to the edge function every tick (a wasted invocation
-- against the free-tier quota). Short-circuit in the cron itself: only invoke
-- the edge function when active_rooms_with_symbols() returns at least one row.
-- The edge function still re-checks active rooms; this just avoids the call.
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
  -- Nobody present watching anything -> don't invoke the edge function at all.
  if not exists (select 1 from public.active_rooms_with_symbols()) then
    return;
  end if;

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
