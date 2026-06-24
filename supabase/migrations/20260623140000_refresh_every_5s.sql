-- Tighten the active-room refresh cadence from 10s to 5s.
-- Both levers must move together: the cron interval caps how often a refresh
-- can happen, and STOCK_QUOTE_CACHE_TTL_SECONDS gates whether each tick actually
-- re-fetches. This migration sets the cron interval; the TTL is the
-- STOCK_QUOTE_CACHE_TTL_SECONDS secret, set to 5 out-of-band (code default also 5).
-- cron.schedule upserts by job name, so this re-points the existing job.
select cron.schedule(
  'refresh-active-quotes',
  '5 seconds',
  $$select private.trigger_active_quote_refresh();$$
);
