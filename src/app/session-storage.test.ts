import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getDefaultSessionPath, getProfileSessionPath, JsonFileStorage } from './session-storage.js';

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

  it('builds isolated session paths for named local profiles', () => {
    const homeDir = join('/tmp', 'hychat-home');

    expect(getDefaultSessionPath(homeDir)).toBe(join(homeDir, '.hychat', 'session.json'));
    expect(getProfileSessionPath('test', homeDir)).toBe(
      join(homeDir, '.hychat', 'sessions', 'test', 'session.json')
    );
  });

  it('rejects unsafe local profile names', () => {
    expect(() => getProfileSessionPath('../test', '/tmp')).toThrow('Invalid profile name');
    expect(() => getProfileSessionPath('', '/tmp')).toThrow('Invalid profile name');
  });
});
