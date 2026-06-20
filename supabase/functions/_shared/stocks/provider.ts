export type EdgeMarket = 'US' | 'HK' | 'CN' | 'JP';

export type EdgeNormalizedSymbol = {
  canonicalSymbol: `${string}.${EdgeMarket}`;
  code: string;
  market: EdgeMarket;
  providerSymbol: string;
  providerExchange?: string;
  micCode?: string;
};

export type CachedStockQuote = {
  canonicalSymbol: `${string}.${EdgeMarket}`;
  market: EdgeMarket;
  providerSymbol: string;
  providerExchange?: string;
  micCode?: string;
  name?: string;
  currency?: string;
  price?: number;
  change?: number;
  changePercent?: number;
  marketTime?: string;
  provider: string;
  providerPayload?: unknown;
  status: 'ok' | 'stale' | 'error';
  errorMessage?: string;
  cacheExpiresAt: string;
  lastRefreshAttemptAt?: string;
  updatedAt: string;
};

export type EdgeStockProvider = {
  id: string;
  getQuote(symbol: EdgeNormalizedSymbol): Promise<CachedStockQuote>;
};

export function parseEdgeCanonicalSymbol(input: string): EdgeNormalizedSymbol {
  const value = input.trim().toUpperCase();
  const [code, marketPart] = value.split('.');
  const market = (marketPart ?? 'US') as EdgeMarket;

  if (!code) {
    throw new Error('Symbol is required');
  }

  if (!marketPart && /^\d+$/.test(code)) {
    throw new Error('Numeric symbols must include a market suffix');
  }

  if (!['US', 'HK', 'CN', 'JP'].includes(market)) {
    throw new Error(`Unsupported market: ${marketPart}`);
  }

  if (market === 'JP') {
    return {
      canonicalSymbol: `${code}.JP`,
      code,
      market,
      providerSymbol: code,
      providerExchange: 'TSE',
      micCode: 'XTKS'
    };
  }

  if (market === 'HK') {
    // Canonicalize to Yahoo's zero-padded 4-digit form (0700, 7709), idempotent
    // with the client so cache keys agree.
    const hkCode = (code.replace(/^0+/, '') || '0').padStart(4, '0');
    return {
      canonicalSymbol: `${hkCode}.HK`,
      code: hkCode,
      market,
      providerSymbol: hkCode,
      providerExchange: 'HKEX',
      micCode: 'XHKG'
    };
  }

  if (market === 'CN') {
    const exchange = /^[5689]/.test(code) ? 'SSE' : 'SZSE';
    return {
      canonicalSymbol: `${code}.CN`,
      code,
      market,
      providerSymbol: code,
      providerExchange: exchange,
      micCode: exchange === 'SSE' ? 'XSHG' : 'XSHE'
    };
  }

  return {
    canonicalSymbol: `${code}.US`,
    code,
    market,
    providerSymbol: code
  };
}
