import type { ChineseNameResolver } from './cache.ts';
import type { EdgeNormalizedSymbol } from './provider.ts';

// Tencent's free quote endpoint (qt.gtimg.cn) carries Chinese names for HK and
// A-share symbols, which Yahoo does not return. We use it for the display name
// only — prices still come from Yahoo. Names are effectively static, so
// resolveStockQuotes asks for a symbol's name once and caches it.

// Map our normalized symbol to Tencent's market-prefixed ticker, or null for
// markets we should not ask Tencent about (US/JP keep Yahoo's English name).
export function toTencentSymbol(symbol: EdgeNormalizedSymbol): string | null {
  if (symbol.market === 'HK') {
    // Tencent uses 5-digit zero-padded HK codes (00700, 07709); ours are 4.
    return `hk${symbol.code.padStart(5, '0')}`;
  }
  if (symbol.market === 'CN') {
    return `${symbol.providerExchange === 'SSE' ? 'sh' : 'sz'}${symbol.code}`;
  }
  return null;
}

// Each line looks like: v_hk07709="100~XL二南方海力士~07709~...";
// Field 0 is a market code, field 1 is the Chinese name.
export function parseTencentResponse(
  text: string,
  tencentToCanonical: Map<string, string>
): Map<string, string> {
  const names = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = line.match(/^v_([a-z0-9]+)="([^"]*)"/i);
    if (!match) {
      continue;
    }
    const canonical = tencentToCanonical.get(match[1]);
    const name = match[2].split('~')[1]?.trim();
    if (canonical && name) {
      names.set(canonical, name);
    }
  }
  return names;
}

export const fetchChineseNames: ChineseNameResolver = async (symbols) => {
  const tencentToCanonical = new Map<string, string>();
  for (const symbol of symbols) {
    const tencentSymbol = toTencentSymbol(symbol);
    if (tencentSymbol) {
      tencentToCanonical.set(tencentSymbol, symbol.canonicalSymbol);
    }
  }
  if (tencentToCanonical.size === 0) {
    return new Map();
  }

  try {
    const query = [...tencentToCanonical.keys()].join(',');
    const response = await fetch(`https://qt.gtimg.cn/q=${query}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!response.ok) {
      return new Map();
    }
    // The body is GBK-encoded, not UTF-8.
    const text = new TextDecoder('gbk').decode(await response.arrayBuffer());
    return parseTencentResponse(text, tencentToCanonical);
  } catch {
    // Names are a cosmetic enhancement; never let a Tencent hiccup break quotes.
    return new Map();
  }
};
