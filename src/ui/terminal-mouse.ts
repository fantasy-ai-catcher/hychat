// Terminal mouse reporting (xterm DECSET 1000 normal tracking + 1006 SGR
// extended coordinates). When enabled, the terminal reports button events —
// including the scroll wheel — as `CSI < b ; col ; row (M|m)`. We only care
// about the wheel (button 64 = up, 65 = down); clicks are ignored.
//
// Cost: while this is on the terminal hands mouse events to the app, so native
// click-drag text selection is captured. Users hold Option (iTerm2/Ghostty) or
// Shift to select/copy. Mirrors terminal-focus.ts (DECSET 1004) in shape.

export const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1006h';
export const DISABLE_MOUSE = '\x1b[?1006l\x1b[?1000l';

export type ScrollDirection = 'up' | 'down';

// ESC is optional because Ink may hand the parsed value to useInput without it,
// the same way focus events arrive as either "\x1b[I" or "[I".
const SGR_MOUSE_GLOBAL = /\x1b?\[<(\d+);\d+;\d+[Mm]/g;
const SGR_MOUSE_ONLY = /^(?:\x1b?\[<\d+;\d+;\d+[Mm])+$/;

const WHEEL_UP = 64;
const WHEEL_DOWN = 65;

// Pure: classify a raw stdin chunk as a wheel scroll. A chunk can batch several
// events, so the last wheel event wins. Returns null when there is no wheel.
export function parseMouseScroll(chunk: string): ScrollDirection | null {
  SGR_MOUSE_GLOBAL.lastIndex = 0;
  let result: ScrollDirection | null = null;
  let match: RegExpExecArray | null;
  while ((match = SGR_MOUSE_GLOBAL.exec(chunk)) !== null) {
    const button = Number(match[1]);
    if (button === WHEEL_UP) {
      result = 'up';
    } else if (button === WHEEL_DOWN) {
      result = 'down';
    }
  }
  return result;
}

// True when the chunk is nothing but mouse sequences — used to drop the bytes
// before they reach the input composer.
export function isMouseSequence(chunk: string): boolean {
  return SGR_MOUSE_ONLY.test(chunk);
}

export type MouseClick = { x: number; y: number };

const LEFT_BUTTON = 0;

// Pure: classify a chunk as a left-button press (SGR `<0;col;rowM`). Returns the
// 1-based terminal cell, or null. Last click in the chunk wins. We match the
// press ("M"), not the release ("m"), so one physical click reports once.
export function parseMouseClick(chunk: string): MouseClick | null {
  const re = /\x1b?\[<(\d+);(\d+);(\d+)([Mm])/g;
  let result: MouseClick | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(chunk)) !== null) {
    if (Number(match[1]) === LEFT_BUTTON && match[4] === 'M') {
      result = { x: Number(match[2]), y: Number(match[3]) };
    }
  }
  return result;
}

export type ClickStamp = MouseClick & { t: number };
const DOUBLE_CLICK_MS = 400;

// A second left-click within 400ms and ~the same cell as the previous one.
export function isDoubleClick(prev: ClickStamp | null, next: ClickStamp): boolean {
  if (!prev) {
    return false;
  }
  return (
    next.t - prev.t <= DOUBLE_CLICK_MS &&
    Math.abs(next.x - prev.x) <= 1 &&
    Math.abs(next.y - prev.y) <= 1
  );
}

type MouseStreams = {
  stdin: Pick<NodeJS.ReadStream, 'on' | 'off'> & { isTTY?: boolean };
  stdout: Pick<NodeJS.WriteStream, 'write'> & { isTTY?: boolean };
};

// Enables mouse reporting and invokes onScroll(direction) on each wheel event.
// Returns a cleanup that disables reporting and detaches the listener.
export function watchTerminalMouse(
  onScroll: (direction: ScrollDirection) => void,
  streams: MouseStreams = { stdin: process.stdin, stdout: process.stdout },
  onClick?: (click: MouseClick) => void
): () => void {
  if (!streams.stdout.isTTY) {
    return () => {};
  }
  streams.stdout.write(ENABLE_MOUSE);
  const onData = (data: Buffer | string) => {
    const chunk = typeof data === 'string' ? data : data.toString('latin1');
    const direction = parseMouseScroll(chunk);
    if (direction !== null) {
      onScroll(direction);
    }
    if (onClick) {
      const click = parseMouseClick(chunk);
      if (click) {
        onClick(click);
      }
    }
  };
  streams.stdin.on('data', onData);
  return () => {
    streams.stdin.off('data', onData);
    streams.stdout.write(DISABLE_MOUSE);
  };
}
