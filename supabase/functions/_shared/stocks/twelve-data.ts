import type { CachedStockQuote, EdgeNormalizedSymbol, EdgeStockProvider } from './provider.js';

type TwelveDataQuote = {
  name?: string;
  symbol?: string;
  exchange?: string;
  mic_code?: string;
  currency?: string;
  close?: string;
  change?: string;
  percent_change?: string;
  datetime?: string;
};

export function createTwelveDataProvider(apiKey: string, fetchImpl = fetch): EdgeStockProvider {
  return {
    id: 'twelve_data',
    async getQuote(symbol: EdgeNormalizedSymbol): Promise<CachedStockQuote> {
      const url = new URL('https://api.twelvedata.com/quote');
      url.searchParams.set('symbol', symbol.providerSymbol);
      url.searchParams.set('apikey', apiKey);
      if (symbol.providerExchange) {
        url.searchParams.set('exchange', symbol.providerExchange);
      }

      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(`provider_http_${response.status}`);
      }

      const payload = (await response.json()) as TwelveDataQuote & { status?: string; message?: string };
      if (payload.status === 'error') {
        throw new Error(payload.message ?? 'provider_error');
      }

      return {
        canonicalSymbol: symbol.canonicalSymbol,
        market: symbol.market,
        providerSymbol: symbol.providerSymbol,
        providerExchange: symbol.providerExchange,
        micCode: symbol.micCode,
        name: payload.name,
        currency: payload.currency,
        price: toNumber(payload.close),
        change: toNumber(payload.change),
        changePercent: toNumber(payload.percent_change),
        marketTime: payload.datetime,
        provider: 'twelve_data',
        providerPayload: {
          symbol: payload.symbol,
          exchange: payload.exchange,
          mic_code: payload.mic_code
        },
        status: 'ok',
        cacheExpiresAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      };
    }
  };
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
