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

  for (const rawSymbol of input.symbols) {
    const symbol = parseEdgeCanonicalSymbol(rawSymbol);
    const cached = await input.cache.get(symbol.canonicalSymbol);

    if (
      cached &&
      !input.force &&
      cached.status === 'ok' &&
      new Date(cached.cacheExpiresAt).getTime() > input.now.getTime()
    ) {
      quotes.push(toResolvedQuote(cached, 'hit'));
      continue;
    }

    try {
      const fresh = await input.provider.getQuote(symbol);
      const sanitized = sanitizeQuote({
        ...fresh,
        cacheExpiresAt: getCacheExpiresAt(input.now, input.ttlSeconds),
        updatedAt: input.now.toISOString()
      });
      await input.cache.upsert(sanitized);
      quotes.push(toResolvedQuote(sanitized, 'refreshed'));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'provider_unavailable';
      failed.push({ symbol: symbol.canonicalSymbol, reason });

      if (cached) {
        quotes.push(toResolvedQuote({ ...cached, status: 'stale' }, 'stale'));
      }
    }
  }

  return { quotes, failed };
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
