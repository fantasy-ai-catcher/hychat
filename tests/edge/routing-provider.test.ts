import { describe, expect, it } from 'vitest';

import { splitByMarket } from '../../supabase/functions/_shared/stocks/routing-provider.js';
import { parseEdgeCanonicalSymbol } from '../../supabase/functions/_shared/stocks/provider.js';

describe('splitByMarket', () => {
  it('routes US/HK/CN to Tencent and JP to Yahoo', () => {
    const split = splitByMarket(
      ['AAPL.US', '0700.HK', '600519.CN', '7203.JP'].map(parseEdgeCanonicalSymbol)
    );
    expect(split.tencent.map((s) => s.canonicalSymbol)).toEqual([
      'AAPL.US',
      '0700.HK',
      '600519.CN'
    ]);
    expect(split.yahoo.map((s) => s.canonicalSymbol)).toEqual(['7203.JP']);
  });
});
