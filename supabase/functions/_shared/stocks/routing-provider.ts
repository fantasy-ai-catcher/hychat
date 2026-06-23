import type {
  CachedStockQuote,
  EdgeNormalizedSymbol,
  EdgeStockProvider
} from './provider.ts';

export type SymbolSplit = {
  tencent: EdgeNormalizedSymbol[];
  yahoo: EdgeNormalizedSymbol[];
};

// US/HK/CN are priced by Tencent; JP (which Tencent does not cover) by Yahoo.
export function splitByMarket(symbols: EdgeNormalizedSymbol[]): SymbolSplit {
  const split: SymbolSplit = { tencent: [], yahoo: [] };
  for (const symbol of symbols) {
    if (symbol.market === 'JP') {
      split.yahoo.push(symbol);
    } else {
      split.tencent.push(symbol);
    }
  }
  return split;
}

// Routes each symbol to the provider that covers its market and merges results.
// Each leg runs independently so one market's outage never blames the other's
// symbols (missing symbols fall through to resolveStockQuotes' stale path).
// Throws only when every leg that had symbols failed, preserving the
// orchestrator's whole-batch-failure handling for a total outage.
export function createRoutingProvider(
  tencent: EdgeStockProvider,
  yahoo: EdgeStockProvider
): EdgeStockProvider {
  return {
    id: `${tencent.id}+${yahoo.id}`,
    async getQuotes(symbols: EdgeNormalizedSymbol[]): Promise<CachedStockQuote[]> {
      const split = splitByMarket(symbols);
      const legs: Array<EdgeNormalizedSymbol[]> = [];
      const providers: EdgeStockProvider[] = [];
      if (split.tencent.length > 0) {
        legs.push(split.tencent);
        providers.push(tencent);
      }
      if (split.yahoo.length > 0) {
        legs.push(split.yahoo);
        providers.push(yahoo);
      }

      const settled = await Promise.allSettled(
        legs.map((legSymbols, i) => providers[i].getQuotes(legSymbols))
      );

      const quotes: CachedStockQuote[] = [];
      const errors: string[] = [];
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          quotes.push(...result.value);
        } else {
          errors.push(result.reason instanceof Error ? result.reason.message : 'provider_error');
        }
      }

      if (legs.length > 0 && errors.length === legs.length) {
        throw new Error(errors.join(';'));
      }
      return quotes;
    }
  };
}
