import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadRuntimeDotenv } from './cli.js';

describe('loadRuntimeDotenv', () => {
  it('loads user config and cwd env files without overriding process env', () => {
    const root = mkdtempSync(join(tmpdir(), 'hychat-env-'));
    const homeDir = join(root, 'home');
    const cwd = join(root, 'project');
    const configDir = join(homeDir, '.config', 'hychat');
    mkdirSync(configDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    try {
      writeFileSync(
        join(configDir, '.env'),
        [
          'SUPABASE_URL=https://home.supabase.co',
          'SUPABASE_PUBLISHABLE_KEY=home-key',
          'STOCK_PROVIDER=yahoo_finance'
        ].join('\n')
      );
      writeFileSync(
        join(cwd, '.env'),
        [
          'SUPABASE_URL=https://cwd.supabase.co',
          'STOCK_QUOTE_CACHE_TTL_SECONDS=120'
        ].join('\n')
      );
      const env: Record<string, string | undefined> = {
        SUPABASE_PUBLISHABLE_KEY: 'shell-key'
      };

      const loaded = loadRuntimeDotenv({ cwd, homeDir, env });

      expect(loaded).toEqual([join(configDir, '.env'), join(cwd, '.env')]);
      expect(env).toEqual({
        SUPABASE_URL: 'https://cwd.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'shell-key',
        STOCK_PROVIDER: 'yahoo_finance',
        STOCK_QUOTE_CACHE_TTL_SECONDS: '120'
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
