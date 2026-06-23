import type {
  CachedStockQuote,
  EdgeMarket,
  EdgeNormalizedSymbol
} from './provider.ts';

// Map a normalized symbol to Tencent's market-prefixed ticker.
// US -> usAAPL, HK -> hk00700 (5-digit), CN -> sh/sz<code>, JP -> null.
export function toTencentSymbol(symbol: EdgeNormalizedSymbol): string | null {
  switch (symbol.market) {
    case 'US':
      return `us${symbol.code.toUpperCase()}`;
    case 'HK':
      return `hk${symbol.code.padStart(5, '0')}`;
    case 'CN':
      return `${symbol.providerExchange === 'SSE' ? 'sh' : 'sz'}${symbol.code}`;
    default:
      return null;
  }
}

function currencyFor(market: EdgeMarket): string {
  return market === 'US' ? 'USD' : market === 'HK' ? 'HKD' : 'CNY';
}

const hasLatinLetter = (value: string | undefined): boolean => /[A-Za-z]/.test(value ?? '');

// One quote line: v_<ticker>="<f0>~<f1>~...";  Field 1 is the Chinese name,
// 2 the echoed symbol, 3 the current price, 4 the previous close; US rows carry
// the English name at field 46. Change/percent live at market-specific offsets,
// so we compute them from price - previous close (identical to Tencent's own
// values). Unknown tickers and the v_pv_none_match miss line are skipped by the
// mapping lookup.
export function parseTencentQuotes(
  text: string,
  tickerToSymbol: Map<string, EdgeNormalizedSymbol>
): CachedStockQuote[] {
  const quotes: CachedStockQuote[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^v_([a-z0-9._]+)="([^"]*)"/i);
    if (!match) {
      continue;
    }
    const symbol = tickerToSymbol.get(match[1].toLowerCase());
    if (!symbol) {
      continue;
    }
    const fields = match[2].split('~');
    const price = Number(fields[3]);
    if (!Number.isFinite(price) || price === 0) {
      continue; // no usable price -> treat as not found, resolver serves stale
    }
    const prevClose = Number(fields[4]);
    const hasPrev = Number.isFinite(prevClose) && prevClose !== 0;
    const change = hasPrev ? price - prevClose : undefined;
    const changePercent = hasPrev ? ((price - prevClose) / prevClose) * 100 : undefined;
    const rawName =
      symbol.market === 'US'
        ? hasLatinLetter(fields[46])
          ? fields[46]
          : fields[2] || fields[1]
        : fields[1];

    quotes.push({
      canonicalSymbol: symbol.canonicalSymbol,
      market: symbol.market,
      providerSymbol: match[1],
      providerExchange: symbol.providerExchange,
      micCode: symbol.micCode,
      name: rawName?.trim() || undefined,
      currency: currencyFor(symbol.market),
      price,
      change,
      changePercent,
      provider: 'tencent',
      providerPayload: { marketCode: fields[0] },
      status: 'ok',
      // Overwritten by the cache resolver with the real TTL / timestamps.
      cacheExpiresAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    });
  }
  return quotes;
}
