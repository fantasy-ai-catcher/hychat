-- Yahoo Finance provider adds the Japan (Tokyo) market. Extend the
-- stock_quotes.market CHECK so Japanese quotes can be cached.
-- room_watchlist.canonical_symbol is free text, so it needs no change.

alter table public.stock_quotes
  drop constraint if exists stock_quotes_market_check;

alter table public.stock_quotes
  add constraint stock_quotes_market_check
  check (market in ('US', 'HK', 'CN', 'JP'));
