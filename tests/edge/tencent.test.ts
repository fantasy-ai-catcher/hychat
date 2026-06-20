import { describe, expect, it } from 'vitest';

import {
  parseTencentResponse,
  toTencentSymbol
} from '../../supabase/functions/_shared/stocks/tencent.js';
import { parseEdgeCanonicalSymbol } from '../../supabase/functions/_shared/stocks/provider.js';

describe('toTencentSymbol', () => {
  it('zero-pads HK codes to five digits', () => {
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('7709.HK'))).toBe('hk07709');
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('0700.HK'))).toBe('hk00700');
  });

  it('prefixes A-shares by exchange', () => {
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('600519.CN'))).toBe('sh600519');
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('002980.CN'))).toBe('sz002980');
  });

  it('returns null for markets Tencent should not name (US/JP)', () => {
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('AAPL.US'))).toBeNull();
    expect(toTencentSymbol(parseEdgeCanonicalSymbol('7203.JP'))).toBeNull();
  });
});

describe('parseTencentResponse', () => {
  it('maps the Chinese name (field 1) back to the canonical symbol', () => {
    const text =
      'v_hk07709="100~XL二南方海力士~07709~161.000~";\n' +
      'v_sh600519="1~贵州茅台~600519~1215.00~";\n';
    const mapping = new Map([
      ['hk07709', '7709.HK'],
      ['sh600519', '600519.CN']
    ]);

    const names = parseTencentResponse(text, mapping);

    expect(names.get('7709.HK')).toBe('XL二南方海力士');
    expect(names.get('600519.CN')).toBe('贵州茅台');
  });

  it('skips lines with no name or no known mapping', () => {
    const text = 'v_hk00001="";\nv_szunknown="100~foo~";\n';
    const names = parseTencentResponse(text, new Map([['hk00001', '0001.HK']]));
    expect(names.size).toBe(0);
  });
});
