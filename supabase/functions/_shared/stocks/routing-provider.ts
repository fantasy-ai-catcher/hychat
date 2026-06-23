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
