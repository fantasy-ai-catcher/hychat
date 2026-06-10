import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROFILE_COLOR,
  formatProfileColorList,
  isProfileColorName,
  PROFILE_COLORS,
  resolveProfileColor
} from './profile-colors.js';

describe('profile colors', () => {
  it('offers exactly 20 selectable colors plus the white default', () => {
    expect(DEFAULT_PROFILE_COLOR).toBe('white');
    expect(PROFILE_COLORS).toHaveLength(20);
    expect(PROFILE_COLORS.map((color) => color.name)).toContain('rose');
    expect(PROFILE_COLORS.map((color) => color.name)).not.toContain('white');
  });

  it('validates color names and resolves terminal color values', () => {
    expect(isProfileColorName('rose')).toBe(true);
    expect(isProfileColorName('white')).toBe(true);
    expect(isProfileColorName('not-a-color')).toBe(false);
    expect(resolveProfileColor('rose')).toMatch(/^#/);
    expect(resolveProfileColor(undefined)).toBe('white');
  });

  it('formats the selectable colors for the color command', () => {
    expect(formatProfileColorList()).toContain('1:red');
    expect(formatProfileColorList()).toContain('20:gray');
  });
});
