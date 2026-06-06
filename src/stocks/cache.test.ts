import { describe, expect, it } from 'vitest';

import { evaluateQuoteCache } from './cache.js';

const now = new Date('2026-06-06T08:00:00.000Z');

describe('evaluateQuoteCache', () => {
  it('returns hit for an ok quote that has not expired', () => {
    expect(
      evaluateQuoteCache({
        now,
        forceRefresh: false,
        quote: {
          canonicalSymbol: 'AAPL.US',
          status: 'ok',
          cacheExpiresAt: '2026-06-06T08:00:30.000Z'
        }
      })
    ).toEqual({ action: 'use-cache', cacheStatus: 'hit' });
  });

  it('refreshes when no quote exists', () => {
    expect(evaluateQuoteCache({ now, forceRefresh: false, quote: null })).toEqual({
      action: 'refresh',
      reason: 'missing'
    });
  });

  it('refreshes expired quotes', () => {
    expect(
      evaluateQuoteCache({
        now,
        forceRefresh: false,
        quote: {
          canonicalSymbol: 'AAPL.US',
          status: 'ok',
          cacheExpiresAt: '2026-06-06T07:59:59.000Z'
        }
      })
    ).toEqual({ action: 'refresh', reason: 'expired' });
  });

  it('refreshes when force refresh is requested', () => {
    expect(
      evaluateQuoteCache({
        now,
        forceRefresh: true,
        quote: {
          canonicalSymbol: 'AAPL.US',
          status: 'ok',
          cacheExpiresAt: '2026-06-06T08:00:30.000Z'
        }
      })
    ).toEqual({ action: 'refresh', reason: 'forced' });
  });

  it('allows stale fallback for expired quotes after provider failure', () => {
    expect(
      evaluateQuoteCache({
        now,
        forceRefresh: false,
        quote: {
          canonicalSymbol: 'AAPL.US',
          status: 'stale',
          cacheExpiresAt: '2026-06-06T07:59:59.000Z'
        }
      })
    ).toEqual({ action: 'refresh', reason: 'stale-available' });
  });
});
