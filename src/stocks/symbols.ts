import type { Market, NormalizedSymbol } from './provider.js';

export type ParseCanonicalSymbolResult =
  | { success: true; value: NormalizedSymbol }
  | { success: false; error: string };

const supportedMarkets = new Set<Market>(['US', 'HK', 'CN']);

export function parseCanonicalSymbol(input: string): ParseCanonicalSymbolResult {
  const value = input.trim().toUpperCase();

  if (value.length === 0) {
    return { success: false, error: 'Symbol is required' };
  }

  const [rawCode, rawMarket] = value.split('.');
  const code = rawCode ?? '';

  if (!rawMarket && /^\d+$/.test(code)) {
    return {
      success: false,
      error: 'Numeric symbols must include a market suffix such as .HK or .CN'
    };
  }

  const market = (rawMarket ?? 'US') as Market;

  if (!supportedMarkets.has(market)) {
    return { success: false, error: `Unsupported market: ${rawMarket}` };
  }

  if (!isValidCodeForMarket(code, market)) {
    return { success: false, error: `Invalid ${market} symbol: ${code}` };
  }

  return {
    success: true,
    value: {
      canonicalSymbol: `${code}.${market}`,
      code,
      market,
      providerSymbol: code,
      ...getProviderMarketFields(code, market)
    }
  };
}

function isValidCodeForMarket(code: string, market: Market): boolean {
  if (market === 'US') {
    return /^[A-Z][A-Z0-9.-]{0,9}$/.test(code);
  }

  if (market === 'HK') {
    return /^\d{4,5}$/.test(code);
  }

  return /^\d{6}$/.test(code) && inferChinaExchange(code) !== undefined;
}

function getProviderMarketFields(
  code: string,
  market: Market
): Pick<NormalizedSymbol, 'providerExchange' | 'micCode'> {
  if (market === 'HK') {
    return { providerExchange: 'HKEX', micCode: 'XHKG' };
  }

  if (market === 'CN') {
    const exchange = inferChinaExchange(code);
    return exchange === 'SSE'
      ? { providerExchange: 'SSE', micCode: 'XSHG' }
      : { providerExchange: 'SZSE', micCode: 'XSHE' };
  }

  return {};
}

function inferChinaExchange(code: string): 'SSE' | 'SZSE' | undefined {
  if (/^[5689]/.test(code)) {
    return 'SSE';
  }

  if (/^[023]/.test(code)) {
    return 'SZSE';
  }

  return undefined;
}
