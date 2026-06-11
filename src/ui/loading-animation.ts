export const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function spinnerFrame(tick: number): string {
  return spinnerFrames[tick % spinnerFrames.length];
}

export const loadingColor = '#d97757';

export function formatBusyElapsed(startedAtMs: number, nowMs: number): string {
  return `(${Math.max(Math.floor((nowMs - startedAtMs) / 1000), 0)}s)`;
}

export type ShimmerSegment = {
  text: string;
  bright: boolean;
};

const shimmerWindowSize = 3;

// The highlight window enters from the left edge, sweeps across the text,
// exits on the right, then wraps; one full cycle is length + window ticks.
export function buildShimmerSegments(text: string, tick: number): ShimmerSegment[] {
  const characters = [...text];
  if (characters.length === 0) {
    return [];
  }

  const windowEnd = tick % (characters.length + shimmerWindowSize);
  const windowStart = windowEnd - shimmerWindowSize;
  const segments: ShimmerSegment[] = [];

  for (const [index, character] of characters.entries()) {
    const bright = index >= windowStart && index < windowEnd;
    const last = segments[segments.length - 1];
    if (last && last.bright === bright) {
      last.text += character;
    } else {
      segments.push({ text: character, bright });
    }
  }

  return segments;
}
