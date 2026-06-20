import type { ISODateTime } from '../types.js';

export type Market = 'US' | 'HK' | 'CN' | 'JP';

export type CanonicalSymbol = `${string}.${Market}`;

export type NormalizedSymbol = {
  canonicalSymbol: CanonicalSymbol;
  code: string;
  market: Market;
  providerSymbol: string;
  providerExchange?: string;
  micCode?: string;
  displayName?: string;
};

export type StockQuoteStatus = 'ok' | 'stale' | 'error';

export type StockQuote = {
  canonicalSymbol: CanonicalSymbol;
  market: Market;
  providerSymbol: string;
  providerExchange?: string;
  micCode?: string;
  name?: string;
  currency?: string;
  price?: number;
  change?: number;
  changePercent?: number;
  marketTime?: ISODateTime;
  provider: string;
  status: StockQuoteStatus;
  errorMessage?: string;
  cacheExpiresAt: ISODateTime;
  updatedAt: ISODateTime;
};

export interface StockProviderAdapter {
  id: string;
  normalize(input: string): Promise<NormalizedSymbol[]>;
  getQuote(symbol: NormalizedSymbol): Promise<StockQuote>;
  getQuotes(symbols: NormalizedSymbol[]): Promise<StockQuote[]>;
}
