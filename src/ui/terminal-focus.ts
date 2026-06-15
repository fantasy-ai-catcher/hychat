// Terminal focus reporting (xterm DECSET 1004). When enabled, a terminal that
// supports it sends CSI I when its window/tab gains focus and CSI O when it
// loses focus. tmux forwards these when `focus-events on`. Terminals without
// support send nothing, so focus stays at its initial value (active) and the
// app degrades to "connected == active".

export const ENABLE_FOCUS_REPORTING = '\x1b[?1004h';
export const DISABLE_FOCUS_REPORTING = '\x1b[?1004l';

const FOCUS_IN = '\x1b[I';
const FOCUS_OUT = '\x1b[O';

// Pure: classify a raw stdin chunk as a focus change. Returns true (focus in),
// false (focus out), or null when the chunk carries no focus event. A chunk may
// also carry other bytes (e.g. a keystroke), so we scan for the markers.
export function parseFocusEvent(chunk: string): boolean | null {
  const lastIn = chunk.lastIndexOf(FOCUS_IN);
  const lastOut = chunk.lastIndexOf(FOCUS_OUT);
  if (lastIn === -1 && lastOut === -1) {
    return null;
  }
  return lastIn > lastOut;
}

// True when the chunk is exactly a focus event and nothing else — used to drop
// the sequence before it reaches the input composer.
export function isFocusEventOnly(chunk: string): boolean {
  return chunk === FOCUS_IN || chunk === FOCUS_OUT;
}

type FocusStreams = {
  stdin: Pick<NodeJS.ReadStream, 'on' | 'off'> & { isTTY?: boolean };
  stdout: Pick<NodeJS.WriteStream, 'write'> & { isTTY?: boolean };
};

// Enables focus reporting and invokes onChange(focused) on each event. Returns
// a cleanup that disables reporting and detaches the listener.
export function watchTerminalFocus(
  onChange: (focused: boolean) => void,
  streams: FocusStreams = { stdin: process.stdin, stdout: process.stdout }
): () => void {
  if (!streams.stdout.isTTY) {
    return () => {};
  }
  streams.stdout.write(ENABLE_FOCUS_REPORTING);
  const onData = (data: Buffer | string) => {
    const focused = parseFocusEvent(typeof data === 'string' ? data : data.toString('latin1'));
    if (focused !== null) {
      onChange(focused);
    }
  };
  streams.stdin.on('data', onData);
  return () => {
    streams.stdin.off('data', onData);
    streams.stdout.write(DISABLE_FOCUS_REPORTING);
  };
}
