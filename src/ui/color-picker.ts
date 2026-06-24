import { DEFAULT_PROFILE_COLOR, PROFILE_COLORS } from '../app/profile-colors.js';

export type PickerDirection = 'up' | 'down' | 'left' | 'right';

// The pickable names: the default (resets to plain) first, then the palette.
export function pickerColorNames(): string[] {
  return [DEFAULT_PROFILE_COLOR, ...PROFILE_COLORS.map((color) => color.name)];
}

// Columns by terminal width, matching the member-grid responsiveness style.
export function colorPickerColumns(terminalWidth: number): number {
  return terminalWidth >= 100 ? 4 : terminalWidth >= 70 ? 3 : 2;
}

// Row-major move with clamping: compute the target one grid step away; if that
// cell does not exist (past an edge or an empty trailing slot), stay put.
export function movePickerSelection(
  index: number,
  direction: PickerDirection,
  count: number,
  columns: number
): number {
  const column = index % columns;
  switch (direction) {
    case 'left':
      return column > 0 ? index - 1 : index;
    case 'right':
      return column < columns - 1 && index + 1 < count ? index + 1 : index;
    case 'up':
      return index - columns >= 0 ? index - columns : index;
    case 'down':
      return index + columns < count ? index + columns : index;
  }
}

// Split a flat list row-major into rows of up to `columns` items.
export function pickerGridRows<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += columns) {
    rows.push(items.slice(index, index + columns));
  }
  return rows;
}
