import type { CanonicalSymbol, StockQuoteStatus } from './provider.js';

export type CachedQuoteSummary = {
  canonicalSymbol: CanonicalSymbol;
  status: StockQuoteStatus;
  cacheExpiresAt: string;
};

export type QuoteCacheDecision =
  | { action: 'use-cache'; cacheStatus: 'hit' }
  | { action: 'refresh'; reason: 'missing' | 'expired' | 'forced' | 'stale-available' };

export type EvaluateQuoteCacheInput = {
  now: Date;
  forceRefresh: boolean;
  quote: CachedQuoteSummary | null;
};

export function evaluateQuoteCache(input: EvaluateQuoteCacheInput): QuoteCacheDecision {
  if (!input.quote) {
    return { action: 'refresh', reason: 'missing' };
  }

  if (input.forceRefresh) {
    return { action: 'refresh', reason: 'forced' };
  }

  if (input.quote.status !== 'ok') {
    return { action: 'refresh', reason: 'stale-available' };
  }

  if (new Date(input.quote.cacheExpiresAt).getTime() <= input.now.getTime()) {
    return { action: 'refresh', reason: 'expired' };
  }

  return { action: 'use-cache', cacheStatus: 'hit' };
}

export function getCacheExpiry(now: Date, ttlSeconds: number): string {
  return new Date(now.getTime() + ttlSeconds * 1000).toISOString();
}
