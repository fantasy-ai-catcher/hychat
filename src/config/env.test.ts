import { describe, expect, it } from 'vitest';

import { parseEnv } from './env.js';

describe('parseEnv', () => {
  it('falls back to baked-in Supabase connection defaults', () => {
    const result = parseEnv({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.supabaseUrl).toMatch(/^https:\/\/.+\.supabase\.co$/);
      expect(result.value.supabasePublishableKey).toMatch(/^sb_publishable_/);
    }
  });

  it('lets env override the baked-in connection defaults', () => {
    const result = parseEnv({
      SUPABASE_URL: 'https://override.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_override'
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.supabaseUrl).toBe('https://override.supabase.co');
      expect(result.value.supabasePublishableKey).toBe('sb_publishable_override');
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
        stockQuoteCacheTtlSeconds: 60,
        showPresenceActivity: false
      }
    });
  });

  it('defaults presence join/left activity lines to off', () => {
    const result = parseEnv({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.showPresenceActivity).toBe(false);
    }
  });

  it('enables presence activity when HYCHAT_SHOW_PRESENCE_ACTIVITY is truthy', () => {
    for (const value of ['1', 'true', 'yes', 'on', 'TRUE']) {
      const result = parseEnv({ HYCHAT_SHOW_PRESENCE_ACTIVITY: value });
      expect(result.success && result.value.showPresenceActivity).toBe(true);
    }
    for (const value of ['0', 'false', '', 'no']) {
      const result = parseEnv({ HYCHAT_SHOW_PRESENCE_ACTIVITY: value });
      expect(result.success && result.value.showPresenceActivity).toBe(false);
    }
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
