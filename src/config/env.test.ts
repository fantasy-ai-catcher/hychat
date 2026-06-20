import { describe, expect, it } from 'vitest';

import { parseEnv } from './env.js';

describe('parseEnv', () => {
  it('requires Supabase connection settings', () => {
    const result = parseEnv({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('SUPABASE_URL'),
          expect.stringContaining('SUPABASE_PUBLISHABLE_KEY')
        ])
      );
    }
  });

  it('uses defaults for stock provider and quote cache TTL', () => {
    const result = parseEnv({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'publishable-key'
    });

    expect(result).toEqual({
      success: true,
      value: {
        supabaseUrl: 'https://example.supabase.co',
        supabasePublishableKey: 'publishable-key',
        stockProvider: 'yahoo_finance',
        stockQuoteCacheTtlSeconds: 60
      }
    });
  });

  it('accepts an explicit stock quote cache TTL', () => {
    const result = parseEnv({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      STOCK_QUOTE_CACHE_TTL_SECONDS: '120'
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.stockQuoteCacheTtlSeconds).toBe(120);
    }
  });

  it('rejects non-positive stock quote cache TTL values', () => {
    const result = parseEnv({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      STOCK_QUOTE_CACHE_TTL_SECONDS: '0'
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('STOCK_QUOTE_CACHE_TTL_SECONDS')
        ])
      );
    }
  });
});
