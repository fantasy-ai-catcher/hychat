import { describe, expect, it, vi } from 'vitest';

import {
  BELL,
  MACOS_NOTIFY_SOUND,
  bannerSequence,
  createTerminalNotifier,
  detectTerminalProgram,
  ghosttyNotifySequence,
  iterm2NotifySequence
} from './notify-sound.js';

describe('notification sequences', () => {
  it('builds an iTerm2 OSC 9 sequence', () => {
    expect(iterm2NotifySequence('bob mentioned you')).toBe('\x1b]9;bob mentioned you\x07');
  });

  it('builds a Ghostty OSC 777 sequence', () => {
    expect(ghosttyNotifySequence('HyChat', 'bob mentioned you')).toBe(
      '\x1b]777;notify;HyChat;bob mentioned you\x07'
    );
  });
});

describe('detectTerminalProgram', () => {
  it('detects iTerm2', () => {
    expect(detectTerminalProgram({ TERM_PROGRAM: 'iTerm.app' })).toBe('iterm2');
  });

  it('detects Ghostty (TERM_PROGRAM or resources dir)', () => {
    expect(detectTerminalProgram({ TERM_PROGRAM: 'ghostty' })).toBe('ghostty');
    expect(detectTerminalProgram({ GHOSTTY_RESOURCES_DIR: '/x' })).toBe('ghostty');
  });

  it('falls back to other for Apple Terminal / unknown', () => {
    expect(detectTerminalProgram({ TERM_PROGRAM: 'Apple_Terminal' })).toBe('other');
    expect(detectTerminalProgram({})).toBe('other');
  });
});

describe('bannerSequence', () => {
  it('uses OSC 9 in iTerm2', () => {
    expect(bannerSequence({ TERM_PROGRAM: 'iTerm.app' }, 'HyChat', 'hi')).toBe(
      iterm2NotifySequence('hi')
    );
  });

  it('uses OSC 777 in Ghostty', () => {
    expect(bannerSequence({ TERM_PROGRAM: 'ghostty' }, 'HyChat', 'hi')).toBe(
      ghosttyNotifySequence('HyChat', 'hi')
    );
  });

  it('falls back to the bell elsewhere', () => {
    expect(bannerSequence({ TERM_PROGRAM: 'Apple_Terminal' }, 'HyChat', 'hi')).toBe(BELL);
  });
});

describe('createTerminalNotifier', () => {
  function harness(overrides: { env?: Record<string, string>; platform?: NodeJS.Platform } = {}) {
    const writes: string[] = [];
    const spawn = vi.fn();
    const notifier = createTerminalNotifier({
      stdout: { write: (s: string) => writes.push(s) },
      spawn: spawn as never,
      env: overrides.env ?? {},
      platform: overrides.platform ?? 'darwin'
    });
    return { writes, spawn, notifier };
  }

  it('off rings nothing', () => {
    const { writes, spawn, notifier } = harness();
    notifier.ring('off', 'x');
    expect(writes).toHaveLength(0);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('bell writes the BEL byte', () => {
    const { writes, notifier } = harness();
    notifier.ring('bell', 'x');
    expect(writes).toEqual([BELL]);
  });

  it('sound spawns afplay on macOS', () => {
    const { spawn, notifier } = harness({ platform: 'darwin' });
    notifier.ring('sound', 'x');
    expect(spawn).toHaveBeenCalledWith('afplay', [MACOS_NOTIFY_SOUND], expect.any(Object));
  });

  it('sound falls back to the bell off macOS', () => {
    const { writes, spawn, notifier } = harness({ platform: 'linux' });
    notifier.ring('sound', 'x');
    expect(spawn).not.toHaveBeenCalled();
    expect(writes).toEqual([BELL]);
  });

  it('banner writes the terminal notification sequence', () => {
    const { writes, notifier } = harness({ env: { TERM_PROGRAM: 'iTerm.app' } });
    notifier.ring('banner', 'bob mentioned you');
    expect(writes).toEqual([iterm2NotifySequence('bob mentioned you')]);
  });

  it('never throws when afplay spawn fails', () => {
    const writes: string[] = [];
    const notifier = createTerminalNotifier({
      stdout: { write: (s: string) => writes.push(s) },
      spawn: (() => {
        throw new Error('ENOENT');
      }) as never,
      env: {},
      platform: 'darwin'
    });
    expect(() => notifier.ring('sound', 'x')).not.toThrow();
  });
});
