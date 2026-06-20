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

// Resolves Chinese display names for HK/CN symbols (Yahoo only has English).
// Returns canonicalSymbol -> name; symbols it can't name are simply omitted.
export type ChineseNameResolver = (
  symbols: EdgeNormalizedSymbol[]
) => Promise<Map<string, string>>;

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
  // Optional: when set, HK/CN symbols missing a Chinese name get one from here
  // (fetched once and cached). Omitted in unit tests; wired to Tencent in prod.
  nameResolver?: ChineseNameResolver;
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

  // Chinese names are static, so only ask the resolver for HK/CN symbols that
  // just refreshed and don't already have a Chinese name cached. Once a name is
  // stored, it is reused on every later refresh without another lookup.
  let chineseNames = new Map<string, string>();
  if (input.nameResolver) {
    const needNames = toFetch.filter(
      (symbol) =>
        (symbol.market === 'HK' || symbol.market === 'CN') &&
        freshBySymbol.has(symbol.canonicalSymbol) &&
        !hasChineseName(cachedBySymbol.get(symbol.canonicalSymbol)?.name)
    );
    if (needNames.length > 0) {
      try {
        chineseNames = await input.nameResolver(needNames);
      } catch {
        chineseNames = new Map();
      }
    }
  }

  const upserts: Array<Promise<void>> = [];
  for (const symbol of toFetch) {
    const cached = cachedBySymbol.get(symbol.canonicalSymbol) ?? null;
    const freshQuote = freshBySymbol.get(symbol.canonicalSymbol);

    if (freshQuote) {
      const sanitized = sanitizeQuote({
        ...freshQuote,
        name: resolveDisplayName(symbol, freshQuote, cached, chineseNames),
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

// True once a name contains CJK — our signal that a HK/CN row already holds a
// Chinese name and needs no further Tencent lookup.
function hasChineseName(name: string | undefined): boolean {
  return name !== undefined && /[㐀-鿿]/.test(name);
}

// HK/CN: prefer a freshly fetched Chinese name, else a Chinese name already
// cached, else Yahoo's English name. US/JP always keep Yahoo's name.
function resolveDisplayName(
  symbol: EdgeNormalizedSymbol,
  fresh: CachedStockQuote,
  cached: CachedStockQuote | null,
  chineseNames: Map<string, string>
): string | undefined {
  if (symbol.market === 'HK' || symbol.market === 'CN') {
    return (
      chineseNames.get(symbol.canonicalSymbol) ??
      (hasChineseName(cached?.name) ? cached?.name : fresh.name)
    );
  }
  return fresh.name;
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
