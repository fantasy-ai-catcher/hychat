import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { resolveStockQuotes, type ResolvedQuote } from '../_shared/stocks/cache.ts';
import { createSupabaseQuoteCache, createYahooAuthStore } from '../_shared/stocks/store.ts';
import { createTencentProvider } from '../_shared/stocks/tencent-provider.ts';
import { createExtendedHoursProvider } from '../_shared/stocks/sina-extended.ts';
import { createSinaHkProvider } from '../_shared/stocks/sina-hk.ts';
import { createRoutingProvider } from '../_shared/stocks/routing-provider.ts';
import { createYahooProvider } from '../_shared/stocks/yahoo.ts';

type ActiveRow = { room_id: string; canonical_symbol: string };

// Cron-triggered (pg_cron -> pg_net) refresh of every symbol watched in a room
// that currently has people. Authorized by a shared secret, not a user JWT, so
// this function runs with verify_jwt = false (see config.toml). One batched
// Yahoo call refreshes all symbols; one realtime broadcast per active room
// pushes that room's quotes to its clients in a single message.
Deno.serve(async (request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const cronSecret = Deno.env.get('STOCK_REFRESH_CRON_SECRET');

    if (!supabaseUrl || !serviceRoleKey || !cronSecret) {
      return Response.json({ error: 'missing_server_configuration' }, { status: 500 });
    }

    if (request.headers.get('x-cron-secret') !== cronSecret) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const staleAfterSeconds = Number(Deno.env.get('STOCK_PRESENCE_STALE_SECONDS') ?? '90');
    const { data: rows, error: roomsError } = await supabase.rpc('active_rooms_with_symbols', {
      stale_after_seconds: staleAfterSeconds
    });
    if (roomsError) {
      return Response.json({ error: roomsError.message }, { status: 500 });
    }

    // Group symbols by room and collect the deduped union to fetch once.
    const symbolsByRoom = new Map<string, string[]>();
    const allSymbols = new Set<string>();
    for (const row of (rows ?? []) as ActiveRow[]) {
      allSymbols.add(row.canonical_symbol);
      const list = symbolsByRoom.get(row.room_id) ?? [];
      list.push(row.canonical_symbol);
      symbolsByRoom.set(row.room_id, list);
    }

    if (allSymbols.size === 0) {
      return Response.json({ rooms: 0, refreshed: 0, failed: [] });
    }

    const result = await resolveStockQuotes({
      symbols: [...allSymbols],
      // The scheduled tick relies on the TTL to decide what actually needs a
      // provider hit, so it never forces.
      force: false,
      cache: createSupabaseQuoteCache(supabase),
      provider: createRoutingProvider(
        createSinaHkProvider(createExtendedHoursProvider(createTencentProvider())),
        createYahooProvider({ store: createYahooAuthStore(supabase) })
      ),
      now: new Date(),
      ttlSeconds: Number(Deno.env.get('STOCK_QUOTE_CACHE_TTL_SECONDS') ?? '5'),
      forceMinIntervalSeconds: Number(
        Deno.env.get('STOCK_QUOTE_FORCE_MIN_INTERVAL_SECONDS') ?? '30'
      ),
      failureRetrySeconds: Number(Deno.env.get('STOCK_QUOTE_FAILURE_RETRY_SECONDS') ?? '15')
    });

    const quoteBySymbol = new Map<string, ResolvedQuote>();
    for (const quote of result.quotes) {
      quoteBySymbol.set(quote.symbol, quote);
    }

    // One broadcast message per room carrying just that room's quotes. This is
    // what keeps realtime usage independent of how many symbols are watched.
    const messages = [...symbolsByRoom.entries()]
      .map(([roomId, symbols]) => ({
        topic: `room:${roomId}:updates`,
        event: 'quotes',
        payload: {
          quotes: symbols
            .map((symbol) => quoteBySymbol.get(symbol))
            .filter((quote): quote is ResolvedQuote => quote !== undefined)
        }
      }))
      .filter((message) => message.payload.quotes.length > 0);

    if (messages.length > 0) {
      await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        },
        body: JSON.stringify({ messages })
      });
    }

    return Response.json({
      rooms: messages.length,
      refreshed: result.quotes.length,
      failed: result.failed
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    return Response.json({ error: message }, { status: 400 });
  }
});
