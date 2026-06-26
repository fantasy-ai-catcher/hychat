import type { NotifyChannel } from './mention-notify.js';

// C0 control code. Inside tmux a raw BEL triggers tmux's own bell-action, so we
// emit it unwrapped just like a terminal would.
export const BELL = '\x07';

// A pleasant, always-present macOS system sound. Played via `afplay`.
export const MACOS_NOTIFY_SOUND = '/System/Library/Sounds/Glass.aiff';

// iTerm2 desktop notification (OSC 9). The terminal shows a banner and plays the
// OS notification sound.
export function iterm2NotifySequence(message: string): string {
  return `\x1b]9;${message}${BELL}`;
}

// Ghostty desktop notification (OSC 777, the urxvt/kitty-style `notify` form).
export function ghosttyNotifySequence(title: string, message: string): string {
  return `\x1b]777;notify;${title};${message}${BELL}`;
}

export type TerminalProgram = 'iterm2' | 'ghostty' | 'other';

// Identify the host terminal from its env so we can pick a notification protocol
// it actually understands. Apple Terminal and unknowns get 'other' (bell only).
export function detectTerminalProgram(env: Record<string, string | undefined>): TerminalProgram {
  const program = (env.TERM_PROGRAM ?? '').toLowerCase();
  if (program === 'iterm.app') {
    return 'iterm2';
  }
  if (program === 'ghostty' || env.GHOSTTY_RESOURCES_DIR) {
    return 'ghostty';
  }
  return 'other';
}

// The desktop-notification escape sequence for the current terminal, or the bell
// when the terminal has no notification protocol we know.
export function bannerSequence(
  env: Record<string, string | undefined>,
  title: string,
  message: string
): string {
  switch (detectTerminalProgram(env)) {
    case 'iterm2':
      return iterm2NotifySequence(message);
    case 'ghostty':
      return ghosttyNotifySequence(title, message);
    default:
      return BELL;
  }
}

const BANNER_TITLE = 'HyChat';

export type Notifier = { ring: (channel: NotifyChannel, message: string) => void };

type SpawnLike = (
  command: string,
  args: string[],
  options: { stdio: 'ignore'; detached: boolean }
) => { unref?: () => void };

// The imperative shell: turns a channel choice into an actual sound. All effects
// (stdout write, child process) are injected so the decision layer stays pure
// and tests can assert behavior without a real terminal.
export function createTerminalNotifier(deps: {
  stdout?: { write: (data: string) => void };
  spawn?: SpawnLike;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}): Notifier {
  const stdout = deps.stdout ?? process.stdout;
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;

  const bell = () => stdout.write(BELL);

  return {
    ring(channel, message) {
      switch (channel) {
        case 'off':
          return;
        case 'bell':
          bell();
          return;
        case 'banner':
          stdout.write(bannerSequence(env, BANNER_TITLE, message));
          return;
        case 'sound': {
          if (platform !== 'darwin' || !deps.spawn) {
            bell();
            return;
          }
          // Fire and forget; a missing afplay must never crash the TUI.
          try {
            const child = deps.spawn('afplay', [MACOS_NOTIFY_SOUND], {
              stdio: 'ignore',
              detached: true
            });
            child.unref?.();
          } catch {
            bell();
          }
          return;
        }
      }
    }
  };
}
