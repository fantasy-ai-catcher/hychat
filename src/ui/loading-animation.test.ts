import { describe, expect, it } from 'vitest';

import {
  buildShimmerSegments,
  formatBusyElapsed,
  spinnerFrame,
  spinnerFrames
} from './loading-animation.js';

describe('spinnerFrame', () => {
  it('cycles through the braille frames', () => {
    expect(spinnerFrame(0)).toBe(spinnerFrames[0]);
    expect(spinnerFrame(1)).toBe(spinnerFrames[1]);
    expect(spinnerFrame(spinnerFrames.length)).toBe(spinnerFrames[0]);
    expect(spinnerFrame(spinnerFrames.length + 2)).toBe(spinnerFrames[2]);
  });
});

describe('buildShimmerSegments', () => {
  it('returns an empty list for empty text', () => {
    expect(buildShimmerSegments('', 5)).toEqual([]);
  });

  it('always reconstructs the original text', () => {
    for (let tick = 0; tick < 20; tick += 1) {
      const segments = buildShimmerSegments('Loading…', tick);
      expect(segments.map((segment) => segment.text).join('')).toBe('Loading…');
    }
  });

  it('starts fully dim before the highlight enters from the left', () => {
    expect(buildShimmerSegments('Loading…', 0)).toEqual([
      { text: 'Loading…', bright: false }
    ]);
  });

  it('sweeps a highlight window across the text', () => {
    expect(buildShimmerSegments('Loading…', 1)).toEqual([
      { text: 'L', bright: true },
      { text: 'oading…', bright: false }
    ]);
    expect(buildShimmerSegments('Loading…', 4)).toEqual([
      { text: 'L', bright: false },
      { text: 'oad', bright: true },
      { text: 'ing…', bright: false }
    ]);
  });

  it('lets the highlight exit on the right, then wraps around', () => {
    expect(buildShimmerSegments('Loading…', 10)).toEqual([
      { text: 'Loading', bright: false },
      { text: '…', bright: true }
    ]);
    // cycle length is text length + window size (8 + 3)
    expect(buildShimmerSegments('Loading…', 11)).toEqual([
      { text: 'Loading…', bright: false }
    ]);
    expect(buildShimmerSegments('Loading…', 12)).toEqual(
      buildShimmerSegments('Loading…', 1)
    );
  });
});

describe('formatBusyElapsed', () => {
  it('shows whole elapsed seconds', () => {
    const start = 1_000_000;
    expect(formatBusyElapsed(start, start)).toBe('(0s)');
    expect(formatBusyElapsed(start, start + 999)).toBe('(0s)');
    expect(formatBusyElapsed(start, start + 1_000)).toBe('(1s)');
    expect(formatBusyElapsed(start, start + 52_400)).toBe('(52s)');
  });
});
