import { describe, expect, it } from 'vitest';

import { toTencentSymbol } from '../../supabase/functions/_shared/stocks/tencent-provider.js';
import { parseEdgeCanonicalSymbol } from '../../supabase/functions/_shared/stocks/provider.js';

describe('toTencentSymbol', () => {
  it('prefixes US tickers with us', () => {
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('AAPL.US'))).toBe('usAAPL');
  });

  it('zero-pads HK codes to five digits', () => {
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('0700.HK'))).toBe('hk00700');
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('7709.HK'))).toBe('hk07709');
  });

  it('prefixes A-shares by exchange', () => {
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('600519.CN'))).toBe('sh600519');
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('000001.CN'))).toBe('sz000001');
  });

  it('returns null for JP (handled by Yahoo)', () => {
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('7203.JP'))).toBeNull();
  });
});
