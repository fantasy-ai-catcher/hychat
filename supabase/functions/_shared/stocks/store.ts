import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import type { StockQuoteCacheStore } from './cache.ts';
import type { YahooAuthStore } from './provider.ts';

// Single-row cache for Yahoo's cookie + crumb. Lives in a locked-down public
// table (RLS on, no client grants) so the service-role edge client can reach it
// via the Data API while no one else can.
export function createYahooAuthStore(supabase: SupabaseClient): YahooAuthStore {
  return {
    async get() {
      const { data, error } = await supabase
        .from('yahoo_auth')
        .select('cookie,crumb')
        .eq('id', 1)
        .maybeSingle();
      if (error) {
        throw new Error(error.message);
      }
      if (!data?.cookie || !data?.crumb) {
        return null;
      }
      return { cookie: data.cookie, crumb: data.crumb };
    },
    async set(auth) {
      const { error } = await supabase.from('yahoo_auth').upsert({
        id: 1,
        cookie: auth.cookie,
        crumb: auth.crumb,
        updated_at: new Date().toISOString()
      });
      if (error) {
        throw new Error(error.message);
      }
    }
  };
}

// Maps the stock_quotes table <-> CachedStockQuote in one place so the
// get-stock-quotes and refresh-active-quotes functions cannot drift apart.
export function createSupabaseQuoteCache(supabase: SupabaseClient): StockQuoteCacheStore {
  return {
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
        lastRefreshAttemptAt: data.last_refresh_attempt_at,
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
        last_refresh_attempt_at: quote.lastRefreshAttemptAt ?? new Date().toISOString(),
        updated_at: quote.updatedAt
      });

      if (error) {
        throw new Error(error.message);
      }
    }
  };
}
