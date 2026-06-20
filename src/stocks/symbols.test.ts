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

  it('maps Tokyo symbols to TSE', () => {
    expect(parseCanonicalSymbol('7203.JP')).toEqual({
      success: true,
      value: {
        canonicalSymbol: '7203.JP',
        code: '7203',
        market: 'JP',
        providerSymbol: '7203',
        providerExchange: 'TSE',
        micCode: 'XTKS'
      }
    });
  });

  it('rejects malformed Tokyo symbols', () => {
    expect(parseCanonicalSymbol('72030.JP')).toEqual({
      success: false,
      error: 'Invalid JP symbol: 72030'
    });
  });

  it('canonicalizes Hong Kong codes to zero-padded 4-digit form', () => {
    expect(parseCanonicalSymbol('700.HK')).toMatchObject({
      success: true,
      value: { canonicalSymbol: '0700.HK', code: '0700', providerSymbol: '0700' }
    });
    expect(parseCanonicalSymbol('07709.HK')).toMatchObject({
      success: true,
      value: { canonicalSymbol: '7709.HK', code: '7709', providerSymbol: '7709' }
    });
  });

  it('rejects numeric symbols without a market suffix', () => {
    expect(parseCanonicalSymbol('0700')).toEqual({
      success: false,
      error: 'Numeric symbols must include a market suffix such as .HK, .CN, or .JP'
    });
  });

  it('rejects unsupported markets', () => {
    expect(parseCanonicalSymbol('AAPL.LN')).toEqual({
      success: false,
      error: 'Unsupported market: LN'
    });
  });
});
