import { describe, expect, it, vi } from 'vitest';

import {
  isMouseSequence,
  parseMouseScroll,
  watchTerminalMouse
} from './terminal-mouse.js';

describe('parseMouseScroll', () => {
  it('reads a wheel-up SGR event (button 64)', () => {
    expect(parseMouseScroll('\x1b[<64;10;5M')).toBe('up');
  });

  it('reads a wheel-down SGR event (button 65)', () => {
    expect(parseMouseScroll('\x1b[<65;10;5M')).toBe('down');
  });

  it('ignores a plain click (button 0) and other bytes', () => {
    expect(parseMouseScroll('\x1b[<0;3;4M')).toBeNull();
    expect(parseMouseScroll('hello')).toBeNull();
  });

  it('takes the last wheel event when several arrive in one chunk', () => {
    expect(parseMouseScroll('\x1b[<64;1;1M\x1b[<65;1;1M')).toBe('down');
  });
});

describe('isMouseSequence', () => {
  it('matches a pure SGR mouse chunk, with or without the ESC', () => {
    expect(isMouseSequence('\x1b[<64;10;5M')).toBe(true);
    expect(isMouseSequence('[<64;10;5M')).toBe(true);
    expect(isMouseSequence('\x1b[<0;3;4m')).toBe(true);
  });

  it('rejects ordinary input', () => {
    expect(isMouseSequence('a')).toBe(false);
    expect(isMouseSequence('\x1b[A')).toBe(false);
  });
});

describe('watchTerminalMouse', () => {
  function fakeStreams() {
    const listeners: Array<(data: string) => void> = [];
    const writes: string[] = [];
    return {
      listeners,
      writes,
      streams: {
        stdin: {
          isTTY: true,
          on: (_event: string, cb: (data: string) => void) => listeners.push(cb),
          off: (_event: string, cb: (data: string) => void) => {
            const index = listeners.indexOf(cb);
            if (index >= 0) listeners.splice(index, 1);
          }
        },
        stdout: { isTTY: true, write: (chunk: string) => writes.push(chunk) }
      }
    };
  }

  it('enables reporting, forwards wheel direction, and disables on cleanup', () => {
    const { listeners, writes, streams } = fakeStreams();
    const onScroll = vi.fn();

    const stop = watchTerminalMouse(onScroll, streams as never);
    expect(writes.join('')).toContain('\x1b[?1000h');

    listeners.forEach((cb) => cb('\x1b[<64;1;1M'));
    expect(onScroll).toHaveBeenCalledWith('up');

    stop();
    expect(listeners).toHaveLength(0);
    expect(writes.join('')).toContain('\x1b[?1000l');
  });

  it('does nothing when stdout is not a TTY', () => {
    const { streams, writes } = fakeStreams();
    streams.stdout.isTTY = false;
    const stop = watchTerminalMouse(vi.fn(), streams as never);
    expect(writes).toHaveLength(0);
    stop();
  });
});
