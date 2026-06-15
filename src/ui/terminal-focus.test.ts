import { describe, expect, it, vi } from 'vitest';

import { isFocusEventOnly, parseFocusEvent, watchTerminalFocus } from './terminal-focus.js';

describe('parseFocusEvent', () => {
  it('detects focus in and focus out', () => {
    expect(parseFocusEvent('\x1b[I')).toBe(true);
    expect(parseFocusEvent('\x1b[O')).toBe(false);
  });

  it('returns null for non-focus input', () => {
    expect(parseFocusEvent('a')).toBeNull();
    expect(parseFocusEvent('\x1b[A')).toBeNull(); // arrow key, not focus
  });

  it('uses the last marker when a chunk carries several', () => {
    expect(parseFocusEvent('\x1b[O\x1b[I')).toBe(true);
    expect(parseFocusEvent('\x1b[I\x1b[O')).toBe(false);
  });
});

describe('isFocusEventOnly', () => {
  it('is true only for a bare focus sequence', () => {
    expect(isFocusEventOnly('\x1b[I')).toBe(true);
    expect(isFocusEventOnly('\x1b[O')).toBe(true);
    expect(isFocusEventOnly('x\x1b[I')).toBe(false);
    expect(isFocusEventOnly('a')).toBe(false);
  });
});

describe('watchTerminalFocus', () => {
  it('enables reporting, reports changes, and cleans up', () => {
    const writes: string[] = [];
    let dataHandler: ((data: string) => void) | undefined;
    const streams = {
      stdin: {
        isTTY: true,
        on: (_event: string, handler: (data: string) => void) => {
          dataHandler = handler;
        },
        off: vi.fn()
      },
      stdout: {
        isTTY: true,
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        }
      }
    } as never;
    const onChange = vi.fn();

    const stop = watchTerminalFocus(onChange, streams);
    expect(writes[0]).toBe('\x1b[?1004h');

    dataHandler?.('\x1b[O');
    dataHandler?.('\x1b[I');
    expect(onChange.mock.calls).toEqual([[false], [true]]);

    stop();
    expect(writes.at(-1)).toBe('\x1b[?1004l');
  });

  it('is a no-op when stdout is not a TTY', () => {
    const onChange = vi.fn();
    const stop = watchTerminalFocus(onChange, {
      stdin: { isTTY: false, on: vi.fn(), off: vi.fn() },
      stdout: { isTTY: false, write: vi.fn() }
    } as never);
    stop();
    expect(onChange).not.toHaveBeenCalled();
  });
});
