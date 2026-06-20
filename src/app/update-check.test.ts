import { describe, expect, it } from 'vitest';

import {
  buildCheckFailedLines,
  buildOutdatedLines,
  compareSemver,
  evaluateUpdateGate,
  isUpToDate,
  parseLatestVersionFromTag,
  parseSemver,
  runUpdateGate,
  shouldSkipUpdateCheck,
  UPDATE_COMMAND
} from './update-check.js';

describe('semver helpers', () => {
  it('parses x.y.z with an optional leading v', () => {
    expect(parseSemver('0.2.0')).toEqual([0, 2, 0]);
    expect(parseSemver('v1.10.3')).toEqual([1, 10, 3]);
    expect(parseSemver('1.2.3-beta.1')).toEqual([1, 2, 3]);
    expect(parseSemver('not-a-version')).toBeNull();
    expect(parseSemver(undefined)).toBeNull();
  });

  it('compares versions numerically, not lexically', () => {
    expect(compareSemver('0.2.0', '0.10.0')).toBe(-1);
    expect(compareSemver('1.0.0', '0.9.9')).toBe(1);
    expect(compareSemver('0.2.0', '0.2.0')).toBe(0);
  });

  it('treats current as up to date only when >= latest', () => {
    expect(isUpToDate('0.2.0', '0.3.0')).toBe(false);
    expect(isUpToDate('0.3.0', '0.3.0')).toBe(true);
    expect(isUpToDate('0.4.0', '0.3.0')).toBe(true);
  });

  it('extracts the version from a release tag', () => {
    expect(parseLatestVersionFromTag('v0.3.0')).toBe('0.3.0');
    expect(parseLatestVersionFromTag('0.3.0')).toBe('0.3.0');
    expect(parseLatestVersionFromTag(undefined)).toBeNull();
    expect(parseLatestVersionFromTag('garbage')).toBeNull();
  });
});

describe('shouldSkipUpdateCheck', () => {
  it('skips only when the env var is a non-empty, non-zero value', () => {
    expect(shouldSkipUpdateCheck({ HYCHAT_SKIP_UPDATE_CHECK: '1' })).toBe(true);
    expect(shouldSkipUpdateCheck({ HYCHAT_SKIP_UPDATE_CHECK: 'yes' })).toBe(true);
    expect(shouldSkipUpdateCheck({ HYCHAT_SKIP_UPDATE_CHECK: '0' })).toBe(false);
    expect(shouldSkipUpdateCheck({ HYCHAT_SKIP_UPDATE_CHECK: '' })).toBe(false);
    expect(shouldSkipUpdateCheck({})).toBe(false);
  });
});

describe('evaluateUpdateGate', () => {
  it('allows when current is up to date', () => {
    expect(evaluateUpdateGate({ current: '0.3.0', latest: '0.3.0' })).toEqual({
      allow: true,
      lines: []
    });
  });

  it('blocks with the update command when outdated', () => {
    const result = evaluateUpdateGate({ current: '0.2.0', latest: '0.3.0' });
    expect(result.allow).toBe(false);
    expect(result.lines.join('\n')).toContain(UPDATE_COMMAND);
    expect(result.lines.join('\n')).toContain('0.2.0 → 0.3.0');
  });
});

describe('message builders', () => {
  it('always include the update command', () => {
    expect(buildOutdatedLines({ current: '0.2.0', latest: '0.3.0' }).join('\n')).toContain(
      UPDATE_COMMAND
    );
    expect(buildCheckFailedLines().join('\n')).toContain(UPDATE_COMMAND);
  });
});

describe('runUpdateGate', () => {
  const base = { currentVersion: '0.2.0', env: {} as Record<string, string | undefined> };

  it('allows immediately when the skip env var is set, without fetching', async () => {
    let fetched = false;
    const result = await runUpdateGate({
      currentVersion: '0.1.0',
      env: { HYCHAT_SKIP_UPDATE_CHECK: '1' },
      fetcher: async () => {
        fetched = true;
        return '9.9.9';
      }
    });
    expect(result.allow).toBe(true);
    expect(fetched).toBe(false);
  });

  it('allows when the fetched latest matches the current version', async () => {
    const result = await runUpdateGate({ ...base, fetcher: async () => '0.2.0' });
    expect(result.allow).toBe(true);
  });

  it('blocks with the outdated message when a newer version exists', async () => {
    const result = await runUpdateGate({ ...base, fetcher: async () => '0.3.0' });
    expect(result.allow).toBe(false);
    expect(result.lines.join('\n')).toContain('0.2.0 → 0.3.0');
  });

  it('blocks with the check-failed message when the fetch throws', async () => {
    const result = await runUpdateGate({
      ...base,
      fetcher: async () => {
        throw new Error('offline');
      }
    });
    expect(result.allow).toBe(false);
    expect(result.lines.join('\n')).toContain('无法确认');
  });

  it('blocks when the fetch returns no usable version', async () => {
    const result = await runUpdateGate({ ...base, fetcher: async () => null });
    expect(result.allow).toBe(false);
    expect(result.lines.join('\n')).toContain('无法确认');
  });
});
