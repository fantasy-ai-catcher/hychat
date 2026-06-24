import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROFILE_COLOR,
  formatProfileColorList,
  isProfileColorName,
  PROFILE_COLORS,
  resolveProfileColor
} from './profile-colors.js';

describe('profile colors', () => {
  it('offers exactly 13 muted selectable colors plus the white default', () => {
    expect(DEFAULT_PROFILE_COLOR).toBe('white');
    expect(PROFILE_COLORS).toHaveLength(13);
    expect(PROFILE_COLORS.map((color) => color.name)).toContain('sage');
    expect(PROFILE_COLORS.map((color) => color.name)).not.toContain('white');
    expect(PROFILE_COLORS.map((color) => color.name)).not.toContain('red');
  });

  it('validates color names and resolves terminal color values', () => {
    expect(isProfileColorName('sage')).toBe(true);
    expect(isProfileColorName('white')).toBe(true);
    expect(isProfileColorName('red')).toBe(false);
    expect(resolveProfileColor('sage')).toMatch(/^#/);
    expect(resolveProfileColor('red')).toBe('white');
    expect(resolveProfileColor(undefined)).toBe('white');
  });

  it('formats the selectable colors for the color command', () => {
    expect(formatProfileColorList()).toContain('1:slate');
    expect(formatProfileColorList()).toContain('13:gray');
  });
});
