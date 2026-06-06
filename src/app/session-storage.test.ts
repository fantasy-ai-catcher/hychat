import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { JsonFileStorage } from './session-storage.js';

describe('JsonFileStorage', () => {
  it('persists and removes auth values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hychat-session-'));
    try {
      const storage = new JsonFileStorage(join(dir, 'session.json'));

      expect(storage.getItem('token')).toBeNull();
      storage.setItem('token', 'abc');
      expect(storage.getItem('token')).toBe('abc');
      storage.removeItem('token');
      expect(storage.getItem('token')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
