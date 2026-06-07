import { describe, expect, it, vi } from 'vitest';

import { createDoctorReport, getCliName, getCliVersion, runCli } from './cli.js';

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
});
