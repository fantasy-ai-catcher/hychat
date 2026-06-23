import type { EdgeNormalizedSymbol } from './provider.ts';

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
