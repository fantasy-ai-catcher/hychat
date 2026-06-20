import type {
  CachedStockQuote,
  EdgeNormalizedSymbol,
  EdgeStockProvider,
  YahooAuth,
  YahooAuthStore
} from './provider.js';

const USER_AGENT = 'Mozilla/5.0';

type YahooQuoteItem = {
  symbol?: string;
  currency?: string;
  fullExchangeName?: string;
  marketState?: string;
  regularMarketPrice?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketTime?: number;
  longName?: string;
  shortName?: string;
};

type YahooQuoteResponse = {
  quoteResponse?: {
    result?: YahooQuoteItem[] | null;
    error?: { code?: string; description?: string } | null;
  };
};

// Map our canonical-symbol normalization onto Yahoo's ticker conventions.
// US carries no suffix; the other markets use a Yahoo-specific suffix.
function toYahooSymbol(symbol: EdgeNormalizedSymbol): string {
  switch (symbol.market) {
    case 'HK':
      return `${symbol.code}.HK`;
    case 'JP':
      return `${symbol.code}.T`;
    case 'CN':
      return symbol.providerExchange === 'SSE' ? `${symbol.code}.SS` : `${symbol.code}.SZ`;
    default:
      return symbol.code;
  }
}

function extractCookie(setCookies: string[]): string {
  // Keep only the "name=value" head of each Set-Cookie; that is all Yahoo's
  // crumb endpoint checks for.
  return setCookies
    .map((entry) => entry.split(';')[0]?.trim())
    .filter((pair): pair is string => Boolean(pair))
    .join('; ');
}

function mapItem(item: YahooQuoteItem, symbol: EdgeNormalizedSymbol): CachedStockQuote | null {
  const price = item.regularMarketPrice;
  if (price === undefined || price === null) {
    return null;
  }

  return {
    canonicalSymbol: symbol.canonicalSymbol,
    market: symbol.market,
    providerSymbol: toYahooSymbol(symbol),
    providerExchange: symbol.providerExchange,
    micCode: symbol.micCode,
    name: item.longName ?? item.shortName,
    currency: item.currency,
    price,
    change: item.regularMarketChange,
    changePercent: item.regularMarketChangePercent,
    marketTime:
      item.regularMarketTime === undefined
        ? undefined
        : new Date(item.regularMarketTime * 1000).toISOString(),
    provider: 'yahoo_finance',
    providerPayload: {
      symbol: item.symbol,
      exchange: item.fullExchangeName,
      marketState: item.marketState
    },
    status: 'ok',
    // Overwritten by the cache resolver with the real TTL / timestamps.
    cacheExpiresAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

// Yahoo's batch v7 quote route prices many symbols in one request but requires
// a cookie + crumb. We reuse a persisted pair and only re-authenticate when the
// route rejects us (401/403), so steady state is a single request per call.
export function createYahooProvider(opts: {
  store: YahooAuthStore;
  fetchImpl?: typeof fetch;
}): EdgeStockProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function authenticate(): Promise<YahooAuth> {
    const cookieRes = await fetchImpl('https://fc.yahoo.com', {
      headers: { 'User-Agent': USER_AGENT }
    });
    const cookie = extractCookie(cookieRes.headers.getSetCookie?.() ?? []);
    if (!cookie) {
      throw new Error('provider_cookie_missing');
    }

    const crumbRes = await fetchImpl('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': USER_AGENT, Cookie: cookie }
    });
    if (!crumbRes.ok) {
      throw new Error(`provider_crumb_${crumbRes.status}`);
    }
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.includes('<')) {
      throw new Error('provider_crumb_invalid');
    }

    const auth: YahooAuth = { cookie, crumb };
    await opts.store.set(auth);
    return auth;
  }

  function requestQuotes(auth: YahooAuth, yahooSymbols: string[]): Promise<Response> {
    const url = new URL('https://query1.finance.yahoo.com/v7/finance/quote');
    url.searchParams.set('symbols', yahooSymbols.join(','));
    url.searchParams.set('crumb', auth.crumb);
    return fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Cookie: auth.cookie, Accept: 'application/json' }
    });
  }

  return {
    id: 'yahoo_finance',
    async getQuotes(symbols: EdgeNormalizedSymbol[]): Promise<CachedStockQuote[]> {
      if (symbols.length === 0) {
        return [];
      }

      // Yahoo echoes its own symbol, so key the reverse lookup by it.
      const bySymbol = new Map<string, EdgeNormalizedSymbol>();
      const yahooSymbols: string[] = [];
      for (const symbol of symbols) {
        const yahooSymbol = toYahooSymbol(symbol);
        bySymbol.set(yahooSymbol.toUpperCase(), symbol);
        yahooSymbols.push(yahooSymbol);
      }

      let auth = (await opts.store.get()) ?? (await authenticate());
      let response = await requestQuotes(auth, yahooSymbols);
      if (response.status === 401 || response.status === 403) {
        auth = await authenticate();
        response = await requestQuotes(auth, yahooSymbols);
      }
      if (!response.ok) {
        throw new Error(`provider_http_${response.status}`);
      }

      const payload = (await response.json()) as YahooQuoteResponse;
      if (payload.quoteResponse?.error) {
        throw new Error('provider_error');
      }

      const quotes: CachedStockQuote[] = [];
      for (const item of payload.quoteResponse?.result ?? []) {
        const symbol = item.symbol ? bySymbol.get(item.symbol.toUpperCase()) : undefined;
        if (!symbol) {
          continue;
        }
        const mapped = mapItem(item, symbol);
        if (mapped) {
          quotes.push(mapped);
        }
      }
      return quotes;
    }
  };
}
