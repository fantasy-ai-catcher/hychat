import type {
  CachedStockQuote,
  EdgeNormalizedSymbol,
  EdgeStockProvider
} from './provider.ts';

// Tencent's free HK feed is ~15 minutes delayed. Sina's rt_hk endpoint is
// real-time, so we keep Tencent's quote (notably its Chinese name) but overlay
// Sina's live price/change for HK symbols.

// HK symbol -> Sina rt_hk<5-digit code>; other markets return null.
export function toSinaHkSymbol(symbol: EdgeNormalizedSymbol): string | null {
  if (symbol.market !== 'HK') {
    return null;
  }
  return `rt_hk${symbol.code.padStart(5, '0')}`;
}

export type SinaHkQuote = { price: number; change: number; changePercent: number };

// rt_hk line: var hq_str_rt_hk07709="en,cn,open,prevClose,high,low,PRICE,CHANGE,CHANGE%,...";
// Field 6 = current price, 7 = change amount, 8 = change percent.
export function parseSinaHkRealtime(
  text: string,
  tickerToCanonical: Map<string, string>
): Map<string, SinaHkQuote> {
  const out = new Map<string, SinaHkQuote>();
  for (const line of text.split('\n')) {
    const match = line.match(/hq_str_(rt_hk[0-9]+)="([^"]*)"/i);
    if (!match) {
      continue;
    }
    const canonical = tickerToCanonical.get(match[1].toLowerCase());
    if (!canonical) {
      continue;
    }
    const fields = match[2].split(',');
    const price = Number(fields[6]);
    if (!Number.isFinite(price) || price === 0) {
      continue;
    }
    const change = Number(fields[7]);
    const changePercent = Number(fields[8]);
    out.set(canonical, {
      price,
      change: Number.isFinite(change) ? change : 0,
      changePercent: Number.isFinite(changePercent) ? changePercent : 0
    });
  }
  return out;
}

// Wraps a base provider: replaces each HK quote's price/change/percent with
// Sina's real-time values, keeping the base quote's name (Tencent's Chinese
// name). Pass-through for non-HK. Sina failures leave the base quotes untouched
// (this is a best-effort freshness overlay, never a hard dependency).
export function createSinaHkProvider(
  base: EdgeStockProvider,
  opts: { fetchImpl?: typeof fetch } = {}
): EdgeStockProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    id: `${base.id}+sina_hk`,
    async getQuotes(symbols: EdgeNormalizedSymbol[]): Promise<CachedStockQuote[]> {
      const quotes = await base.getQuotes(symbols);

      const tickerToCanonical = new Map<string, string>();
      const tickers: string[] = [];
      for (const symbol of symbols) {
        const sinaSymbol = toSinaHkSymbol(symbol);
        if (sinaSymbol) {
          tickerToCanonical.set(sinaSymbol, symbol.canonicalSymbol);
          tickers.push(sinaSymbol);
        }
      }
      if (tickers.length === 0) {
        return quotes;
      }

      let realtime: Map<string, SinaHkQuote>;
      try {
        const response = await fetchImpl(`https://hq.sinajs.cn/list=${tickers.join(',')}`, {
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.sina.com.cn' }
        });
        if (!response.ok) {
          return quotes;
        }
        const text = new TextDecoder('gbk').decode(await response.arrayBuffer());
        realtime = parseSinaHkRealtime(text, tickerToCanonical);
      } catch {
        return quotes;
      }

      return quotes.map((quote) => {
        const rt = realtime.get(quote.canonicalSymbol);
        if (!rt) {
          return quote;
        }
        return { ...quote, price: rt.price, change: rt.change, changePercent: rt.changePercent };
      });
    }
  };
}
