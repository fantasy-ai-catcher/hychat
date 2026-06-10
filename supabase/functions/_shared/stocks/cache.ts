import {
  type CachedStockQuote,
  type EdgeStockProvider,
  parseEdgeCanonicalSymbol
} from './provider.js';

export type StockQuoteCacheStore = {
  get(symbol: string): Promise<CachedStockQuote | null>;
  upsert(quote: CachedStockQuote): Promise<void>;
};

export type ResolveStockQuotesInput = {
  symbols: string[];
  force: boolean;
  cache: StockQuoteCacheStore;
  provider: EdgeStockProvider;
  now: Date;
  ttlSeconds: number;
  // Provider quota guards: force refreshes are ignored while a fresh ok row
  // was refreshed within forceMinIntervalSeconds, and after any attempt the
  // provider is left alone for failureRetrySeconds (stale rows are served
  // instead). Both default to values safe for free-tier quotas.
  forceMinIntervalSeconds?: number;
  failureRetrySeconds?: number;
};

export type ResolvedQuote = {
  symbol: string;
  price?: number;
  changePercent?: number;
  cacheStatus: 'hit' | 'refreshed' | 'stale';
};

export type ResolveStockQuotesResult = {
  quotes: ResolvedQuote[];
  failed: Array<{ symbol: string; reason: string }>;
};

export async function resolveStockQuotes(
  input: ResolveStockQuotesInput
): Promise<ResolveStockQuotesResult> {
  if (input.symbols.length === 0) {
    throw new Error('At least one symbol is required');
  }

  const quotes: ResolvedQuote[] = [];
  const failed: Array<{ symbol: string; reason: string }> = [];
  const forceMinIntervalMs = (input.forceMinIntervalSeconds ?? 30) * 1000;
  const failureRetryMs = (input.failureRetrySeconds ?? 15) * 1000;

  for (const rawSymbol of input.symbols) {
    const symbol = parseEdgeCanonicalSymbol(rawSymbol);
    const cached = await input.cache.get(symbol.canonicalSymbol);
    const msSinceAttempt = getMsSinceAttempt(cached, input.now);
    const cacheIsFresh =
      cached !== null &&
      cached.status === 'ok' &&
      new Date(cached.cacheExpiresAt).getTime() > input.now.getTime();

    if (cached && cacheIsFresh && !input.force) {
      quotes.push(toResolvedQuote(cached, 'hit'));
      continue;
    }

    if (
      cached &&
      cacheIsFresh &&
      input.force &&
      msSinceAttempt !== null &&
      msSinceAttempt < forceMinIntervalMs
    ) {
      quotes.push(toResolvedQuote(cached, 'hit'));
      continue;
    }

    if (
      cached &&
      !cacheIsFresh &&
      msSinceAttempt !== null &&
      msSinceAttempt < failureRetryMs
    ) {
      quotes.push(toResolvedQuote({ ...cached, status: 'stale' }, 'stale'));
      continue;
    }

    try {
      const fresh = await input.provider.getQuote(symbol);
      const sanitized = sanitizeQuote({
        ...fresh,
        cacheExpiresAt: getCacheExpiresAt(input.now, input.ttlSeconds),
        lastRefreshAttemptAt: input.now.toISOString(),
        updatedAt: input.now.toISOString()
      });
      await input.cache.upsert(sanitized);
      quotes.push(toResolvedQuote(sanitized, 'refreshed'));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'provider_unavailable';
      failed.push({ symbol: symbol.canonicalSymbol, reason });

      if (cached) {
        const stale: CachedStockQuote = {
          ...cached,
          status: 'stale',
          lastRefreshAttemptAt: input.now.toISOString()
        };
        await input.cache.upsert(stale);
        quotes.push(toResolvedQuote(stale, 'stale'));
      }
    }
  }

  return { quotes, failed };
}

function getMsSinceAttempt(cached: CachedStockQuote | null, now: Date): number | null {
  if (!cached?.lastRefreshAttemptAt) {
    return null;
  }

  return now.getTime() - new Date(cached.lastRefreshAttemptAt).getTime();
}

function toResolvedQuote(
  quote: CachedStockQuote,
  cacheStatus: ResolvedQuote['cacheStatus']
): ResolvedQuote {
  return {
    symbol: quote.canonicalSymbol,
    price: quote.price,
    changePercent: quote.changePercent,
    cacheStatus
  };
}

function sanitizeQuote(quote: CachedStockQuote): CachedStockQuote {
  return {
    ...quote,
    providerPayload: sanitizeProviderPayload(quote.providerPayload)
  };
}

function sanitizeProviderPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (!['secret', 'apiKey', 'apikey', 'token'].includes(key)) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

function getCacheExpiresAt(now: Date, ttlSeconds: number): string {
  return new Date(now.getTime() + ttlSeconds * 1000).toISOString();
}
