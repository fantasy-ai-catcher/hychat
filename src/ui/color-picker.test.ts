import { describe, expect, it } from 'vitest';

import {
  colorPickerColumns,
  colorPickerHeight,
  movePickerSelection,
  pickerColorNames,
  pickerGridRows
} from './color-picker.js';
import { DEFAULT_PROFILE_COLOR, PROFILE_COLORS } from '../app/profile-colors.js';

describe('pickerColorNames', () => {
  it('leads with the default, then every palette color', () => {
    const names = pickerColorNames();
    expect(names[0]).toBe(DEFAULT_PROFILE_COLOR);
    expect(names).toHaveLength(PROFILE_COLORS.length + 1);
    expect(names).toContain('sage');
  });
});

describe('colorPickerColumns', () => {
  it('picks columns by terminal width', () => {
    expect(colorPickerColumns(60)).toBe(2);
    expect(colorPickerColumns(70)).toBe(3);
    expect(colorPickerColumns(99)).toBe(3);
    expect(colorPickerColumns(100)).toBe(4);
  });
});

describe('movePickerSelection', () => {
  // 7 cells, 3 columns ->
  //   row0: 0 1 2
  //   row1: 3 4 5
  //   row2: 6
  const count = 7;
  const cols = 3;

  it('moves within the grid', () => {
    expect(movePickerSelection(0, 'right', count, cols)).toBe(1);
    expect(movePickerSelection(1, 'left', count, cols)).toBe(0);
    expect(movePickerSelection(0, 'down', count, cols)).toBe(3);
    expect(movePickerSelection(3, 'up', count, cols)).toBe(0);
  });

  it('clamps at edges (no-op when the target cell does not exist)', () => {
    expect(movePickerSelection(2, 'right', count, cols)).toBe(2); // row end
    expect(movePickerSelection(0, 'left', count, cols)).toBe(0); // col 0
    expect(movePickerSelection(0, 'up', count, cols)).toBe(0); // row 0
    expect(movePickerSelection(6, 'down', count, cols)).toBe(6); // last row
    expect(movePickerSelection(5, 'down', count, cols)).toBe(5); // no cell below 5
    expect(movePickerSelection(6, 'right', count, cols)).toBe(6); // last cell, partial row
  });
});

describe('pickerGridRows', () => {
  it('splits row-major into rows of `columns`', () => {
    expect(pickerGridRows([0, 1, 2, 3, 4, 5, 6], 3)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6]
    ]);
  });
});

describe('colorPickerHeight', () => {
  // 14 cells (default + 13). width 100 -> 4 cols -> 4 rows -> 8; width 60 -> 2 cols -> 7 rows -> 11.
  it('is the grid row count plus 4 rows of chrome', () => {
    expect(colorPickerHeight(100)).toBe(8);
    expect(colorPickerHeight(60)).toBe(11);
  });
});
