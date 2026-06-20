import type { Market, NormalizedSymbol } from './provider.js';

export type ParseCanonicalSymbolResult =
  | { success: true; value: NormalizedSymbol }
  | { success: false; error: string };

const supportedMarkets = new Set<Market>(['US', 'HK', 'CN', 'JP']);

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
      error: 'Numeric symbols must include a market suffix such as .HK, .CN, or .JP'
    };
  }

  const market = (rawMarket ?? 'US') as Market;

  if (!supportedMarkets.has(market)) {
    return { success: false, error: `Unsupported market: ${rawMarket}` };
  }

  if (!isValidCodeForMarket(code, market)) {
    return { success: false, error: `Invalid ${market} symbol: ${code}` };
  }

  // HK tickers are canonicalized to the zero-padded 4-digit form Yahoo expects,
  // so 700, 0700 and 07709 dedupe to one symbol (0700.HK, 7709.HK).
  const canonicalCode = market === 'HK' ? normalizeHkCode(code) : code;

  return {
    success: true,
    value: {
      canonicalSymbol: `${canonicalCode}.${market}`,
      code: canonicalCode,
      market,
      providerSymbol: canonicalCode,
      ...getProviderMarketFields(canonicalCode, market)
    }
  };
}

// Strip excess leading zeros, then left-pad to a minimum of 4 digits.
// Idempotent: 0700 -> 0700, 700 -> 0700, 07709 -> 7709, 13456 -> 13456.
export function normalizeHkCode(code: string): string {
  const stripped = code.replace(/^0+/, '');
  return (stripped === '' ? '0' : stripped).padStart(4, '0');
}

function isValidCodeForMarket(code: string, market: Market): boolean {
  if (market === 'US') {
    return /^[A-Z][A-Z0-9.-]{0,9}$/.test(code);
  }

  if (market === 'HK') {
    // HK codes are 1-5 digits (e.g. 5 -> 0005 HSBC); normalizeHkCode pads them.
    return /^\d{1,5}$/.test(code);
  }

  if (market === 'JP') {
    // Tokyo tickers are 4-digit numeric (e.g. 7203). Post-2024 alphanumeric
    // codes are not supported yet.
    return /^\d{4}$/.test(code);
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

  if (market === 'JP') {
    return { providerExchange: 'TSE', micCode: 'XTKS' };
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
