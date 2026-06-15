import { describe, expect, it, vi } from 'vitest';
import React from 'react';

import { createDoctorReport, getCliName, getCliVersion, runCli } from './cli.js';
import { getProfileSessionPath } from './app/session-storage.js';

vi.mock('ink', () => ({
  render: vi.fn()
}));

vi.mock('./supabase/client.js', () => ({
  createHychatSupabaseClient: vi.fn((_config, options) => ({
    authStoragePath: options?.authStoragePath,
    realtime: { connect: vi.fn() }
  }))
}));

vi.mock('./app/hychat-service.js', () => ({
  createHychatService: vi.fn((supabase) => ({
    sourcePath: supabase.authStoragePath,
    createInviteCode: vi.fn(async () => 'invite123')
  }))
}));

vi.mock('./app/realtime-adapter.js', () => ({
  createRealtimeAdapter: vi.fn(() => ({ mockedRealtime: true }))
}));

describe('CLI scaffold', () => {
  it('exposes the CLI name', () => {
    expect(getCliName()).toBe('hychat');
  });

  it('exposes a package version for package manager smoke tests', () => {
    expect(getCliVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('prints the version without requiring runtime env', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runCli({ argv: ['node', 'hychat', '--version'] });

      expect(log).toHaveBeenCalledWith(getCliVersion());
    } finally {
      log.mockRestore();
    }
  });

  it('reports missing runtime env in doctor output', () => {
    expect(createDoctorReport({}).ok).toBe(false);
    expect(createDoctorReport({}).lines.join('\n')).toContain('SUPABASE_URL');
  });

  it('uses isolated auth storage for a named local profile', async () => {
    const { createHychatSupabaseClient } = await import('./supabase/client.js');
    const { render } = await import('ink');
    const homeDir = '/tmp/hychat-home';
    const env = {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test'
    };

    await runCli({
      argv: ['node', 'hychat', '--profile', 'test'],
      homeDir,
      env
    });

    const options = vi.mocked(createHychatSupabaseClient).mock.calls.at(-1)?.[1];
    expect(options?.authStoragePath).toBe(getProfileSessionPath('test', homeDir));
    const appElement = vi.mocked(render).mock.calls.at(-1)?.[0];
    expect(React.isValidElement(appElement)).toBe(true);
  });
});
