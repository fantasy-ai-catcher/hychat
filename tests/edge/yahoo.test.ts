import { describe, expect, it, vi } from 'vitest';

import {
  parseEdgeCanonicalSymbol,
  type YahooAuth,
  type YahooAuthStore
} from '../../supabase/functions/_shared/stocks/provider.js';
import { createYahooProvider } from '../../supabase/functions/_shared/stocks/yahoo.js';

type Route = [match: string, respond: Response | ((url: string) => Response)];

function routedFetch(routes: Route[]) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    for (const [match, respond] of routes) {
      if (url.includes(match)) {
        return typeof respond === 'function' ? respond(url) : respond;
      }
    }
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
}

function quoteResponse(items: Array<Record<string, unknown>>) {
  return new Response(JSON.stringify({ quoteResponse: { result: items, error: null } }), {
    status: 200
  });
}

function cookieResponse() {
  // fc.yahoo.com answers 404 but still sets the cookie we need.
  const headers = new Headers();
  headers.append('set-cookie', 'A3=token; Path=/; Domain=.yahoo.com');
  return new Response('', { status: 404, headers });
}

function fakeStore(initial: YahooAuth | null = null): YahooAuthStore & { current: YahooAuth | null } {
  let auth = initial;
  return {
    get current() {
      return auth;
    },
    async get() {
      return auth;
    },
    async set(next) {
      auth = next;
    }
  };
}

describe('createYahooProvider (v7 batch)', () => {
  it('prices many symbols in one request', async () => {
    const fetchImpl = routedFetch([
      [
        '/v7/finance/quote',
        quoteResponse([
          {
            symbol: 'AAPL',
            currency: 'USD',
            regularMarketPrice: 299.24,
            regularMarketChange: 2.82,
            regularMarketChangePercent: 0.9513,
            regularMarketTime: 1781640001,
            longName: 'Apple Inc.'
          },
          { symbol: '0700.HK', currency: 'HKD', regularMarketPrice: 440.2, regularMarketChangePercent: -1.17 }
        ])
      ]
    ]);
    const provider = createYahooProvider({ store: fakeStore({ cookie: 'A3=x', crumb: 'c' }), fetchImpl });

    const quotes = await provider.getQuotes([
      parseEdgeCanonicalSymbol('AAPL'),
      parseEdgeCanonicalSymbol('0700.HK')
    ]);

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(quotes).toHaveLength(2);
    const aapl = quotes.find((q) => q.canonicalSymbol === 'AAPL.US');
    expect(aapl?.price).toBe(299.24);
    expect(aapl?.change).toBeCloseTo(2.82, 2);
    expect(aapl?.changePercent).toBeCloseTo(0.9513, 3);
    expect(aapl?.currency).toBe('USD');
    expect(aapl?.name).toBe('Apple Inc.');
    expect(aapl?.marketTime).toBe('2026-06-16T20:00:01.000Z');
    expect(quotes.find((q) => q.canonicalSymbol === '0700.HK')?.price).toBe(440.2);
  });

  it('maps each market onto its Yahoo ticker suffix in the batch request', async () => {
    const cases: Array<[string, string]> = [
      ['AAPL', 'AAPL'],
      ['0700.HK', '0700.HK'],
      ['07709.HK', '7709.HK'],
      ['600519.CN', '600519.SS'],
      ['000001.CN', '000001.SZ'],
      ['7203.JP', '7203.T']
    ];

    const canonicals = cases.map(([canonical]) => parseEdgeCanonicalSymbol(canonical));
    const fetchImpl = routedFetch([['/v7/finance/quote', quoteResponse([])]]);
    const provider = createYahooProvider({ store: fakeStore({ cookie: 'A3=x', crumb: 'c' }), fetchImpl });

    await provider.getQuotes(canonicals);

    const requestedUrl = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    const symbolsParam = new URL(requestedUrl).searchParams.get('symbols') ?? '';
    for (const [, expectedYahoo] of cases) {
      expect(symbolsParam.split(',')).toContain(expectedYahoo);
    }
  });

  it('omits symbols Yahoo does not return', async () => {
    const fetchImpl = routedFetch([
      ['/v7/finance/quote', quoteResponse([{ symbol: 'AAPL', regularMarketPrice: 1 }])]
    ]);
    const provider = createYahooProvider({ store: fakeStore({ cookie: 'A3=x', crumb: 'c' }), fetchImpl });

    const quotes = await provider.getQuotes([
      parseEdgeCanonicalSymbol('AAPL'),
      parseEdgeCanonicalSymbol('NOPE')
    ]);

    expect(quotes.map((q) => q.canonicalSymbol)).toEqual(['AAPL.US']);
  });

  it('authenticates (cookie + crumb) when no auth is cached and persists it', async () => {
    const store = fakeStore(null);
    const fetchImpl = routedFetch([
      ['fc.yahoo.com', cookieResponse()],
      ['/v1/test/getcrumb', new Response('crumb-1', { status: 200 })],
      ['/v7/finance/quote', quoteResponse([{ symbol: 'AAPL', regularMarketPrice: 1 }])]
    ]);
    const provider = createYahooProvider({ store, fetchImpl });

    const quotes = await provider.getQuotes([parseEdgeCanonicalSymbol('AAPL')]);

    expect(quotes).toHaveLength(1);
    expect(store.current).toEqual({ cookie: 'A3=token', crumb: 'crumb-1' });
    const v7Url = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => String(call[0]))
      .find((url) => url.includes('/v7/finance/quote'));
    expect(v7Url).toContain('crumb=crumb-1');
  });

  it('re-authenticates once and retries when the quote route rejects the crumb', async () => {
    const store = fakeStore({ cookie: 'A3=stale', crumb: 'stale' });
    let quoteCalls = 0;
    const fetchImpl = routedFetch([
      ['fc.yahoo.com', cookieResponse()],
      ['/v1/test/getcrumb', new Response('crumb-2', { status: 200 })],
      [
        '/v7/finance/quote',
        () => {
          quoteCalls += 1;
          return quoteCalls === 1
            ? new Response('Unauthorized', { status: 401 })
            : quoteResponse([{ symbol: 'AAPL', regularMarketPrice: 7 }]);
        }
      ]
    ]);
    const provider = createYahooProvider({ store, fetchImpl });

    const quotes = await provider.getQuotes([parseEdgeCanonicalSymbol('AAPL')]);

    expect(quotes[0]?.price).toBe(7);
    expect(store.current).toEqual({ cookie: 'A3=token', crumb: 'crumb-2' });
    expect(quoteCalls).toBe(2);
  });
});
