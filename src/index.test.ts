import { describe, expect, it } from 'vitest';

import { getCliName } from './cli.js';

describe('CLI scaffold', () => {
  it('exposes the CLI name', () => {
    expect(getCliName()).toBe('hychat');
  });
});
