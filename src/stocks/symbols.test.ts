import { describe, expect, it } from 'vitest';

import { parseCanonicalSymbol } from './symbols.js';

describe('parseCanonicalSymbol', () => {
  it('defaults alphabetic symbols to the US market', () => {
    expect(parseCanonicalSymbol('aapl')).toEqual({
      success: true,
      value: {
        canonicalSymbol: 'AAPL.US',
        code: 'AAPL',
        market: 'US',
        providerSymbol: 'AAPL',
        providerExchange: undefined,
        micCode: undefined
      }
    });
  });

  it('accepts explicit US symbols', () => {
    expect(parseCanonicalSymbol('TSLA.US')).toEqual({
      success: true,
      value: {
        canonicalSymbol: 'TSLA.US',
        code: 'TSLA',
        market: 'US',
        providerSymbol: 'TSLA',
        providerExchange: undefined,
        micCode: undefined
      }
    });
  });

  it('maps Hong Kong symbols to HKEX', () => {
    expect(parseCanonicalSymbol('0700.HK')).toEqual({
      success: true,
      value: {
        canonicalSymbol: '0700.HK',
        code: '0700',
        market: 'HK',
        providerSymbol: '0700',
        providerExchange: 'HKEX',
        micCode: 'XHKG'
      }
    });
  });

  it('maps Shanghai A-share symbols to SSE', () => {
    expect(parseCanonicalSymbol('600519.CN')).toEqual({
      success: true,
      value: {
        canonicalSymbol: '600519.CN',
        code: '600519',
        market: 'CN',
        providerSymbol: '600519',
        providerExchange: 'SSE',
        micCode: 'XSHG'
      }
    });
  });

  it('maps Shenzhen A-share symbols to SZSE', () => {
    expect(parseCanonicalSymbol('000001.CN')).toEqual({
      success: true,
      value: {
        canonicalSymbol: '000001.CN',
        code: '000001',
        market: 'CN',
        providerSymbol: '000001',
        providerExchange: 'SZSE',
        micCode: 'XSHE'
      }
    });
  });

  it('rejects numeric symbols without a market suffix', () => {
    expect(parseCanonicalSymbol('0700')).toEqual({
      success: false,
      error: 'Numeric symbols must include a market suffix such as .HK or .CN'
    });
  });

  it('rejects unsupported markets', () => {
    expect(parseCanonicalSymbol('AAPL.LN')).toEqual({
      success: false,
      error: 'Unsupported market: LN'
    });
  });
});
