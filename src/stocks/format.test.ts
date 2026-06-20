import { describe, expect, it } from 'vitest';

import {
  buildWatchlistTable,
  formatQuoteChangePercent,
  formatQuotePrice,
  formatWatchlistPercent,
  quoteChangeColor,
  quoteChangeDirection
} from './format.js';

describe('formatQuotePrice', () => {
  it('renders a dash for a missing price', () => {
    expect(formatQuotePrice(undefined)).toBe('-');
  });

  it('formats to two decimals', () => {
    expect(formatQuotePrice(150)).toBe('150.00');
    expect(formatQuotePrice(150.2)).toBe('150.20');
    expect(formatQuotePrice(150.256)).toBe('150.26');
  });
});

describe('formatQuoteChangePercent', () => {
  it('renders a dash for a missing change', () => {
    expect(formatQuoteChangePercent(undefined)).toBe('-');
  });

  it('signs and rounds the percentage', () => {
    expect(formatQuoteChangePercent(1.2345)).toBe('+1.23%');
    expect(formatQuoteChangePercent(-0.5)).toBe('-0.50%');
    expect(formatQuoteChangePercent(0)).toBe('0.00%');
  });
});

describe('quoteChangeColor', () => {
  it('is undefined for a missing or flat change', () => {
    expect(quoteChangeColor(undefined)).toBeUndefined();
    expect(quoteChangeColor(0)).toBeUndefined();
  });

  it('is green when up and red when down', () => {
    expect(quoteChangeColor(0.1)).toBe('green');
    expect(quoteChangeColor(-0.1)).toBe('red');
  });
});

describe('quoteChangeDirection', () => {
  it('is flat for missing or zero change', () => {
    expect(quoteChangeDirection(undefined)).toBe('flat');
    expect(quoteChangeDirection(0)).toBe('flat');
  });

  it('is up when positive and down when negative', () => {
    expect(quoteChangeDirection(1.2)).toBe('up');
    expect(quoteChangeDirection(-1.2)).toBe('down');
  });
});

describe('formatWatchlistPercent', () => {
  it('renders a dash for a missing change', () => {
    expect(formatWatchlistPercent(undefined)).toBe('-');
  });

  it('prefixes an arrow and drops the sign for non-flat moves', () => {
    expect(formatWatchlistPercent(11.19)).toBe('▲ 11.19%');
    expect(formatWatchlistPercent(-1.53)).toBe('▼ 1.53%');
  });

  it('shows a flat move without an arrow', () => {
    expect(formatWatchlistPercent(0)).toBe('0.00%');
  });
});

describe('buildWatchlistTable', () => {
  it('falls back to the symbol code when no name is known', () => {
    const table = buildWatchlistTable([
      { symbol: 'AAPL.US', price: 298.01, changePercent: 0.7 }
    ]);
    expect(table.rows[0]).toMatchObject({
      key: 'AAPL.US',
      label: 'AAPL.US',
      price: '298.01',
      percent: '▲ 0.70%',
      direction: 'up'
    });
  });

  it('prefers the shortname over the symbol code', () => {
    const table = buildWatchlistTable([
      { symbol: '0700.HK', name: '腾讯控股', price: 161, changePercent: 11.19 }
    ]);
    expect(table.rows[0].label).toBe('腾讯控股');
  });

  it('sizes the label column by display width (CJK is double width)', () => {
    const table = buildWatchlistTable([
      { symbol: 'AAPL.US', name: 'Apple', price: 1, changePercent: 1 },
      { symbol: '0700.HK', name: '腾讯控股', price: 1, changePercent: 1 }
    ]);
    // '腾讯控股' is 4 CJK chars = 8 display columns, wider than 'Apple' (5).
    expect(table.labelWidth).toBe(8);
  });

  it('caps the label column and reports nothing hidden under the row cap', () => {
    const table = buildWatchlistTable(
      [{ symbol: 'X.US', name: 'A Very Long Company Name Inc.', price: 1, changePercent: 1 }],
      { maxLabelWidth: 12 }
    );
    expect(table.labelWidth).toBe(12);
    expect(table.hiddenCount).toBe(0);
  });

  it('caps visible rows and counts the rest as hidden', () => {
    const quotes = Array.from({ length: 5 }, (_, i) => ({
      symbol: `S${i}.US`,
      price: 1,
      changePercent: 1
    }));
    const table = buildWatchlistTable(quotes, { maxRows: 3 });
    expect(table.rows).toHaveLength(3);
    expect(table.hiddenCount).toBe(2);
  });

  it('returns zero widths and no rows for an empty watchlist', () => {
    const table = buildWatchlistTable([]);
    expect(table.rows).toEqual([]);
    expect(table.labelWidth).toBe(0);
    expect(table.priceWidth).toBe(0);
    expect(table.percentWidth).toBe(0);
    expect(table.hiddenCount).toBe(0);
  });
});
