import { describe, expect, it } from 'vitest';

import { moveItem } from './reorder.js';

describe('moveItem', () => {
  it('moves an item up one step', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 'up')).toEqual(['b', 'a', 'c']);
  });

  it('moves an item down one step', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 'down')).toEqual(['a', 'c', 'b']);
  });

  it('is a no-op moving up from the top', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 'up')).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op moving down from the bottom', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 'down')).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c'];
    moveItem(input, 1, 'up');
    expect(input).toEqual(['a', 'b', 'c']);
  });
});
