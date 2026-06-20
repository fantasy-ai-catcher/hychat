import { describe, expect, it, vi } from 'vitest';

import {
  parseEdgeCanonicalSymbol,
  type EdgeNormalizedSymbol
} from '../../supabase/functions/_shared/stocks/provider.js';
import { createYahooProvider } from '../../supabase/functions/_shared/stocks/yahoo.js';

function chartResponse(meta: Record<string, unknown>) {
  return new Response(JSON.stringify({ chart: { result: [{ meta }], error: null } }), {
    status: 200
  });
}

function fetchReturning(response: Response) {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

describe('createYahooProvider', () => {
  it('parses a quote and computes change from the previous close', async () => {
    const fetchImpl = fetchReturning(
      chartResponse({
        symbol: 'AAPL',
        currency: 'USD',
        exchangeName: 'NMS',
        regularMarketPrice: 299.24,
        chartPreviousClose: 296.42,
        regularMarketTime: 1781640001,
        longName: 'Apple Inc.'
      })
    );
    const provider = createYahooProvider(fetchImpl);

    const quote = await provider.getQuote(parseEdgeCanonicalSymbol('AAPL'));

    expect(quote.price).toBe(299.24);
    expect(quote.change).toBeCloseTo(2.82, 2);
    expect(quote.changePercent).toBeCloseTo(0.9513, 3);
    expect(quote.currency).toBe('USD');
    expect(quote.name).toBe('Apple Inc.');
    expect(quote.marketTime).toBe('2026-06-16T20:00:01.000Z');
    expect(quote.provider).toBe('yahoo_finance');
  });

  it('maps each market onto its Yahoo ticker suffix', async () => {
    const cases: Array<[string, string]> = [
      ['AAPL', 'AAPL'],
      ['0700.HK', '0700.HK'],
      ['07709.HK', '7709.HK'],
      ['600519.CN', '600519.SS'],
      ['000001.CN', '000001.SZ'],
      ['7203.JP', '7203.T']
    ];

    for (const [canonical, expectedYahoo] of cases) {
      const fetchImpl = fetchReturning(chartResponse({ regularMarketPrice: 1 }));
      const provider = createYahooProvider(fetchImpl);
      await provider.getQuote(parseEdgeCanonicalSymbol(canonical) as EdgeNormalizedSymbol);

      const requestedUrl = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(requestedUrl).toContain(`/v8/finance/chart/${encodeURIComponent(expectedYahoo)}`);
    }
  });

  it('reports symbol_not_found when Yahoo returns a chart error', async () => {
    const fetchImpl = fetchReturning(
      new Response(
        JSON.stringify({
          chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } }
        }),
        { status: 200 }
      )
    );
    const provider = createYahooProvider(fetchImpl);

    await expect(provider.getQuote(parseEdgeCanonicalSymbol('NOPE'))).rejects.toThrow('symbol_not_found');
  });

  it('reports symbol_not_found when the payload has no price', async () => {
    const fetchImpl = fetchReturning(chartResponse({ symbol: 'APPL' }));
    const provider = createYahooProvider(fetchImpl);

    await expect(provider.getQuote(parseEdgeCanonicalSymbol('APPL'))).rejects.toThrow('symbol_not_found');
  });
});
