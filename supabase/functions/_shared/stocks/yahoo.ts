import type { CachedStockQuote, EdgeNormalizedSymbol, EdgeStockProvider } from './provider.js';

type YahooChartMeta = {
  symbol?: string;
  currency?: string;
  exchangeName?: string;
  instrumentType?: string;
  marketState?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketTime?: number;
  longName?: string;
  shortName?: string;
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{ meta?: YahooChartMeta }> | null;
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

// Yahoo's keyless quote endpoint. The per-symbol v8 chart route needs no
// crumb/cookie (unlike the batch v7 quote route) but does require a browser
// User-Agent, so we always send one.
export function createYahooProvider(fetchImpl = fetch): EdgeStockProvider {
  return {
    id: 'yahoo_finance',
    async getQuote(symbol: EdgeNormalizedSymbol): Promise<CachedStockQuote> {
      const yahooSymbol = toYahooSymbol(symbol);
      const url = new URL(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`
      );
      url.searchParams.set('interval', '1d');
      url.searchParams.set('range', '1d');

      const response = await fetchImpl(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`provider_http_${response.status}`);
      }

      const payload = (await response.json()) as YahooChartResponse;

      // Yahoo signals an unknown/delisted ticker either with chart.error or with
      // a result that carries no price. Collapse both into one stable reason so
      // the client can show a friendly "check the symbol" hint.
      if (payload.chart?.error) {
        throw new Error('symbol_not_found');
      }

      const meta = payload.chart?.result?.[0]?.meta;
      if (!meta || meta.regularMarketPrice === undefined) {
        throw new Error('symbol_not_found');
      }

      const price = meta.regularMarketPrice;
      const previousClose = meta.chartPreviousClose ?? meta.previousClose;
      const change =
        previousClose === undefined ? undefined : price - previousClose;
      const changePercent =
        change === undefined || !previousClose ? undefined : (change / previousClose) * 100;

      return {
        canonicalSymbol: symbol.canonicalSymbol,
        market: symbol.market,
        providerSymbol: yahooSymbol,
        providerExchange: symbol.providerExchange,
        micCode: symbol.micCode,
        name: meta.longName ?? meta.shortName,
        currency: meta.currency,
        price,
        change,
        changePercent,
        marketTime:
          meta.regularMarketTime === undefined
            ? undefined
            : new Date(meta.regularMarketTime * 1000).toISOString(),
        provider: 'yahoo_finance',
        providerPayload: {
          symbol: meta.symbol,
          exchangeName: meta.exchangeName,
          instrumentType: meta.instrumentType,
          marketState: meta.marketState
        },
        status: 'ok',
        cacheExpiresAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      };
    }
  };
}
