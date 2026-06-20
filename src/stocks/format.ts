// Pure display formatting for stock quotes. Kept free of UI/state imports so the
// dependency direction stays ui -> stocks and the logic is strict-TDD testable.

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
