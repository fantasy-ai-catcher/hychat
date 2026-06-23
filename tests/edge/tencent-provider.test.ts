import { describe, expect, it } from 'vitest';

import {
  parseTencentQuotes,
  toTencentSymbol
} from '../../supabase/functions/_shared/stocks/tencent-provider.js';
import { parseEdgeCanonicalSymbol } from '../../supabase/functions/_shared/stocks/provider.js';
import type { EdgeNormalizedSymbol } from '../../supabase/functions/_shared/stocks/provider.js';

function mapping(...pairs: Array<[string, string]>) {
  const m = new Map<string, EdgeNormalizedSymbol>();
  for (const [ticker, canonical] of pairs) {
    m.set(ticker, parseEdgeCanonicalSymbol(canonical));
  }
  return m;
}

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

describe('parseTencentQuotes', () => {
  // Real field shapes captured from qt.gtimg.cn (trimmed to the fields we read;
  // index 46 is the English name for US rows).
  const usLine =
    'v_usAAPL="200~苹果~AAPL.OQ~297.01~298.01~297.31~' +
    Array(40).fill('0').join('~') + '~Apple Inc.~tail";';
  const hkLine = 'v_hk00700="100~腾讯控股~00700~414.800~433.000~430.000~rest";';
  const cnLine = 'v_sh600519="1~贵州茅台~600519~1222.45~1241.41~1239.00~rest";';

  it('parses a US quote with the English name (field 46) and computed change%', () => {
    const quotes = parseTencentQuotes(usLine, mapping(['usaapl', 'AAPL.US']));
    expect(quotes).toHaveLength(1);
    const q = quotes[0];
    expect(q.canonicalSymbol).toBe('AAPL.US');
    expect(q.name).toBe('Apple Inc.');
    expect(q.currency).toBe('USD');
    expect(q.price).toBe(297.01);
    expect(q.change).toBeCloseTo(-1.0, 2);
    expect(q.changePercent).toBeCloseTo(-0.3355, 3);
    expect(q.provider).toBe('tencent');
    expect(q.status).toBe('ok');
  });

  it('parses HK/CN quotes with the Chinese name (field 1) and market currency', () => {
    const hk = parseTencentQuotes(hkLine, mapping(['hk00700', '0700.HK']))[0];
    expect(hk.name).toBe('腾讯控股');
    expect(hk.currency).toBe('HKD');
    expect(hk.price).toBe(414.8);
    expect(hk.changePercent).toBeCloseTo(-4.203, 2);

    const cn = parseTencentQuotes(cnLine, mapping(['sh600519', '600519.CN']))[0];
    expect(cn.name).toBe('贵州茅台');
    expect(cn.currency).toBe('CNY');
    expect(cn.changePercent).toBeCloseTo(-1.527, 2);
  });

  it('drops misses (v_pv_none_match) and tickers not in the mapping', () => {
    const text = 'v_pv_none_match="1";\n' + hkLine;
    const quotes = parseTencentQuotes(text, mapping(['hk00700', '0700.HK']));
    expect(quotes.map((q) => q.canonicalSymbol)).toEqual(['0700.HK']);
  });
});
