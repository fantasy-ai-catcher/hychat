import { describe, expect, it } from 'vitest';

import {
  formatQuoteChangePercent,
  formatQuotePrice,
  quoteChangeColor
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
