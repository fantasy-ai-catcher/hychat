import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { resolveStockQuotes, type StockQuoteCacheStore } from '../_shared/stocks/cache.ts';
import { createTwelveDataProvider } from '../_shared/stocks/twelve-data.ts';

type RequestBody = {
  symbols?: string[];
  force?: boolean;
};

Deno.serve(async (request) => {
  try {
    const body = (await request.json()) as RequestBody;
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const apiKey = Deno.env.get('TWELVE_DATA_API_KEY');

    if (!supabaseUrl || !serviceRoleKey || !apiKey) {
      return Response.json({ error: 'missing_server_configuration' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const cache: StockQuoteCacheStore = {
      async get(symbol) {
        const { data, error } = await supabase
          .from('stock_quotes')
          .select('*')
          .eq('canonical_symbol', symbol)
          .maybeSingle();

        if (error) {
          throw new Error(error.message);
        }

        if (!data) {
          return null;
        }

        return {
          canonicalSymbol: data.canonical_symbol,
          market: data.market,
          providerSymbol: data.provider_symbol,
          providerExchange: data.provider_exchange,
          micCode: data.mic_code,
          name: data.name,
          currency: data.currency,
          price: data.price,
          change: data.change,
          changePercent: data.change_percent,
          marketTime: data.market_time,
          provider: data.provider,
          providerPayload: data.provider_payload,
          status: data.status,
          errorMessage: data.error_message,
          cacheExpiresAt: data.cache_expires_at,
          updatedAt: data.updated_at
        };
      },
      async upsert(quote) {
        const { error } = await supabase.from('stock_quotes').upsert({
          canonical_symbol: quote.canonicalSymbol,
          market: quote.market,
          provider_symbol: quote.providerSymbol,
          provider_exchange: quote.providerExchange,
          mic_code: quote.micCode,
          name: quote.name,
          currency: quote.currency,
          price: quote.price,
          change: quote.change,
          change_percent: quote.changePercent,
          market_time: quote.marketTime,
          provider: quote.provider,
          provider_payload: quote.providerPayload ?? {},
          status: quote.status,
          error_message: quote.errorMessage,
          cache_expires_at: quote.cacheExpiresAt,
          last_refresh_attempt_at: new Date().toISOString(),
          updated_at: quote.updatedAt
        });

        if (error) {
          throw new Error(error.message);
        }
      }
    };

    const result = await resolveStockQuotes({
      symbols: body.symbols ?? [],
      force: body.force ?? false,
      cache,
      provider: createTwelveDataProvider(apiKey),
      now: new Date(),
      ttlSeconds: Number(Deno.env.get('STOCK_QUOTE_CACHE_TTL_SECONDS') ?? '60')
    });

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    return Response.json({ error: message }, { status: 400 });
  }
});
