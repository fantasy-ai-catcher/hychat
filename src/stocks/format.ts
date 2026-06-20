// Pure display formatting for stock quotes. Kept free of UI/state imports so the
// dependency direction stays ui -> stocks and the logic is strict-TDD testable.

import stringWidth from 'string-width';

export function formatQuotePrice(price: number | undefined): string {
  if (price === undefined) {
    return '-';
  }

  return price.toFixed(2);
}

export function formatQuoteChangePercent(changePercent: number | undefined): string {
  if (changePercent === undefined) {
    return '-';
  }

  const sign = changePercent > 0 ? '+' : '';
  return `${sign}${changePercent.toFixed(2)}%`;
}

export function quoteChangeColor(
  changePercent: number | undefined
): 'green' | 'red' | undefined {
  if (changePercent === undefined || changePercent === 0) {
    return undefined;
  }

  return changePercent > 0 ? 'green' : 'red';
}

export type WatchlistDirection = 'up' | 'down' | 'flat';

export function quoteChangeDirection(
  changePercent: number | undefined
): WatchlistDirection {
  if (changePercent === undefined || changePercent === 0) {
    return 'flat';
  }

  return changePercent > 0 ? 'up' : 'down';
}

// Header-table percent: the arrow carries the sign, so the magnitude is shown
// unsigned. Flat moves keep "0.00%" with no arrow.
export function formatWatchlistPercent(changePercent: number | undefined): string {
  if (changePercent === undefined) {
    return '-';
  }

  const magnitude = `${Math.abs(changePercent).toFixed(2)}%`;
  const direction = quoteChangeDirection(changePercent);
  if (direction === 'flat') {
    return magnitude;
  }

  return `${direction === 'up' ? '▲' : '▼'} ${magnitude}`;
}

// Input for the header watchlist table. Declared locally (not imported from the
// UI/state layer) so format.ts stays a pure leaf of the dependency graph.
export type WatchlistQuote = {
  symbol: string;
  name?: string;
  price?: number;
  changePercent?: number;
};

export type WatchlistRow = {
  key: string;
  label: string;
  // The canonical symbol code (e.g. 7709.HK), shown as its own dim column to the
  // right of the name. Always present even when a shortname is known.
  symbol: string;
  price: string;
  percent: string;
  direction: WatchlistDirection;
};

export type WatchlistTable = {
  rows: WatchlistRow[];
  // Display-column widths so the Ink render can align columns. The label width
  // is capped (see maxLabelWidth) and long names are truncated at render time.
  labelWidth: number;
  symbolWidth: number;
  priceWidth: number;
  percentWidth: number;
  hiddenCount: number;
};

export type BuildWatchlistTableOptions = {
  maxRows?: number;
  maxLabelWidth?: number;
};

// Turns a room's watchlist quotes into an aligned, height-bounded table for the
// header panel. Pure: column widths are display-width aware (CJK shortnames are
// double width) and the visible rows are capped so a large watchlist can't grow
// the header without bound.
export function buildWatchlistTable(
  quotes: WatchlistQuote[],
  options: BuildWatchlistTableOptions = {}
): WatchlistTable {
  const maxRows = options.maxRows ?? 8;
  const maxLabelWidth = options.maxLabelWidth ?? 16;

  const visible = quotes.slice(0, maxRows);
  const hiddenCount = Math.max(quotes.length - visible.length, 0);

  const rows: WatchlistRow[] = visible.map((quote) => ({
    key: quote.symbol,
    label: quote.name?.trim() || quote.symbol,
    symbol: quote.symbol,
    price: formatQuotePrice(quote.price),
    percent: formatWatchlistPercent(quote.changePercent),
    direction: quoteChangeDirection(quote.changePercent)
  }));

  const labelWidth = Math.min(
    Math.max(0, ...rows.map((row) => stringWidth(row.label))),
    maxLabelWidth
  );
  const symbolWidth = Math.max(0, ...rows.map((row) => stringWidth(row.symbol)));
  const priceWidth = Math.max(0, ...rows.map((row) => stringWidth(row.price)));
  const percentWidth = Math.max(0, ...rows.map((row) => stringWidth(row.percent)));

  return { rows, labelWidth, symbolWidth, priceWidth, percentWidth, hiddenCount };
}
