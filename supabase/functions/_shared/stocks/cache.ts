import {
  type CachedStockQuote,
  type EdgeNormalizedSymbol,
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
  name?: string;
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

  // Dedupe so a symbol watched in several rooms is read/fetched once.
  const symbols = new Map<string, EdgeNormalizedSymbol>();
  for (const rawSymbol of input.symbols) {
    const parsed = parseEdgeCanonicalSymbol(rawSymbol);
    symbols.set(parsed.canonicalSymbol, parsed);
  }

  // Read every cache row up front, then decide what still needs the provider.
  const cachedBySymbol = new Map<string, CachedStockQuote | null>();
  await Promise.all(
    [...symbols.values()].map(async (symbol) => {
      cachedBySymbol.set(symbol.canonicalSymbol, await input.cache.get(symbol.canonicalSymbol));
    })
  );

  const toFetch: EdgeNormalizedSymbol[] = [];
  for (const symbol of symbols.values()) {
    const cached = cachedBySymbol.get(symbol.canonicalSymbol) ?? null;
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

    toFetch.push(symbol);
  }

  if (toFetch.length === 0) {
    return { quotes, failed };
  }

  // One batched provider call for everything that needs refreshing.
  let fresh: CachedStockQuote[] | null = null;
  let batchError: string | null = null;
  try {
    fresh = await input.provider.getQuotes(toFetch);
  } catch (error) {
    batchError = error instanceof Error ? error.message : 'provider_unavailable';
  }

  const freshBySymbol = new Map<string, CachedStockQuote>();
  for (const quote of fresh ?? []) {
    freshBySymbol.set(quote.canonicalSymbol, quote);
  }

  const upserts: Array<Promise<void>> = [];
  for (const symbol of toFetch) {
    const cached = cachedBySymbol.get(symbol.canonicalSymbol) ?? null;
    const freshQuote = freshBySymbol.get(symbol.canonicalSymbol);

    if (freshQuote) {
      const sanitized = sanitizeQuote({
        ...freshQuote,
        cacheExpiresAt: getCacheExpiresAt(input.now, input.ttlSeconds),
        lastRefreshAttemptAt: input.now.toISOString(),
        updatedAt: input.now.toISOString()
      });
      upserts.push(input.cache.upsert(sanitized));
      quotes.push(toResolvedQuote(sanitized, 'refreshed'));
      continue;
    }

    // A whole-batch failure blames every symbol; a missing item in an otherwise
    // good response means Yahoo did not recognize that one ticker.
    failed.push({ symbol: symbol.canonicalSymbol, reason: batchError ?? 'symbol_not_found' });
    if (cached) {
      const stale: CachedStockQuote = {
        ...cached,
        status: 'stale',
        lastRefreshAttemptAt: input.now.toISOString()
      };
      upserts.push(input.cache.upsert(stale));
      quotes.push(toResolvedQuote(stale, 'stale'));
    }
  }
  await Promise.all(upserts);

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
    name: quote.name,
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
