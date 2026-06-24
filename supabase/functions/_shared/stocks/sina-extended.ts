import type {
  CachedStockQuote,
  EdgeNormalizedSymbol,
  EdgeStockProvider
} from './provider.ts';

export type UsSession = 'pre' | 'regular' | 'post' | 'closed';

// US trading sessions in Eastern time (Intl handles EST/EDT automatically):
// pre 04:00-09:30, regular 09:30-16:00, post 16:00-20:00, otherwise closed.
// Weekends are always closed (holidays are not handled — acceptable here).
export function usMarketSession(now: Date): UsSession {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') {
    return 'closed';
  }

  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'pre';
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return 'regular';
  if (minutes >= 16 * 60 && minutes < 20 * 60) return 'post';
  return 'closed';
}

// Map a US symbol to Sina's gb_<lowercase ticker>; other markets return null.
export function toSinaUsSymbol(symbol: EdgeNormalizedSymbol): string | null {
  if (symbol.market !== 'US') {
    return null;
  }
  return `gb_${symbol.code.toLowerCase()}`;
}

export type SinaExtended = { price: number; change: number; changePercent: number };

// Sina US line: var hq_str_gb_aapl="name,price,pct,...,extPrice,extPct,extChg,extTime,...";
// Field 21 = extended price, 22 = extended change %, 23 = extended change amount.
// Rows with no extended trade (price 0/blank) and unknown tickers are skipped.
export function parseSinaExtended(
  text: string,
  tickerToCanonical: Map<string, string>
): Map<string, SinaExtended> {
  const out = new Map<string, SinaExtended>();
  for (const line of text.split('\n')) {
    const match = line.match(/hq_str_(gb_[a-z0-9.]+)="([^"]*)"/i);
    if (!match) {
      continue;
    }
    const canonical = tickerToCanonical.get(match[1].toLowerCase());
    if (!canonical) {
      continue;
    }
    const fields = match[2].split(',');
    const price = Number(fields[21]);
    if (!Number.isFinite(price) || price === 0) {
      continue;
    }
    const change = Number(fields[23]);
    const changePercent = Number(fields[22]);
    out.set(canonical, {
      price,
      change: Number.isFinite(change) ? change : 0,
      changePercent: Number.isFinite(changePercent) ? changePercent : 0
    });
  }
  return out;
}

// Wraps a base provider: during US pre/post sessions it batch-fetches Sina's
// extended-hours quotes and overwrites each US quote's price/change/percent with
// the extended values. Outside pre/post it is a pass-through. Sina failures
// leave the base quotes untouched (extended hours is a best-effort overlay).
export function createExtendedHoursProvider(
  base: EdgeStockProvider,
  opts: { fetchImpl?: typeof fetch; now?: () => Date } = {}
): EdgeStockProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const nowFn = opts.now ?? (() => new Date());

  return {
    id: `${base.id}+sina_ext`,
    async getQuotes(symbols: EdgeNormalizedSymbol[]): Promise<CachedStockQuote[]> {
      const quotes = await base.getQuotes(symbols);

      const session = usMarketSession(nowFn());
      if (session !== 'pre' && session !== 'post') {
        return quotes;
      }

      const tickerToCanonical = new Map<string, string>();
      const tickers: string[] = [];
      for (const symbol of symbols) {
        const sinaSymbol = toSinaUsSymbol(symbol);
        if (sinaSymbol) {
          tickerToCanonical.set(sinaSymbol, symbol.canonicalSymbol);
          tickers.push(sinaSymbol);
        }
      }
      if (tickers.length === 0) {
        return quotes;
      }

      let extended: Map<string, SinaExtended>;
      try {
        const response = await fetchImpl(`https://hq.sinajs.cn/list=${tickers.join(',')}`, {
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.sina.com.cn' }
        });
        if (!response.ok) {
          return quotes;
        }
        const text = new TextDecoder('gbk').decode(await response.arrayBuffer());
        extended = parseSinaExtended(text, tickerToCanonical);
      } catch {
        return quotes;
      }

      return quotes.map((quote) => {
        const ext = extended.get(quote.canonicalSymbol);
        if (!ext) {
          return quote;
        }
        return { ...quote, price: ext.price, change: ext.change, changePercent: ext.changePercent };
      });
    }
  };
}
