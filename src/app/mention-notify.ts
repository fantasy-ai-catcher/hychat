import { mentionsName } from '../ui/mentions.js';

// How an @mention is announced. 'bell' writes the terminal BEL; 'sound' plays a
// macOS system sound; 'banner' emits a terminal desktop-notification sequence
// (iTerm2/Ghostty), falling back to the bell elsewhere; 'off' is silent.
export type NotifyChannel = 'off' | 'bell' | 'sound' | 'banner';
// When the notification fires. 'unfocused' stays quiet while you are actively
// looking at HyChat; 'always' rings on every mention.
export type NotifyWhen = 'always' | 'unfocused';
export type NotifySettings = { channel: NotifyChannel; when: NotifyWhen };

export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = { channel: 'bell', when: 'unfocused' };

export const NOTIFY_CHANNELS: NotifyChannel[] = ['off', 'bell', 'sound', 'banner'];
export const NOTIFY_WHENS: NotifyWhen[] = ['always', 'unfocused'];

const CHANNEL_KEY = 'notify.channel';
const WHEN_KEY = 'notify.when';

export function isNotifyChannel(value: string): value is NotifyChannel {
  return (NOTIFY_CHANNELS as string[]).includes(value);
}

export function isNotifyWhen(value: string): value is NotifyWhen {
  return (NOTIFY_WHENS as string[]).includes(value);
}

// Pure decision: should an incoming message ring the local user? Keeps every
// suppression rule (off, own message, no mention, focus gate, message kind) in
// one testable place so the imperative shell only has to play the sound.
export function shouldRingForMention(input: {
  kind: string;
  body: string;
  senderId: string;
  selfUserId: string | undefined;
  selfName: string | undefined;
  focused: boolean;
  settings: NotifySettings;
}): boolean {
  const { kind, body, senderId, selfUserId, selfName, focused, settings } = input;
  if (settings.channel === 'off') {
    return false;
  }
  if (kind !== 'text') {
    return false;
  }
  if (!selfName) {
    return false;
  }
  if (selfUserId !== undefined && senderId === selfUserId) {
    return false;
  }
  if (!mentionsName(body, selfName)) {
    return false;
  }
  if (settings.when === 'unfocused' && focused) {
    return false;
  }
  return true;
}

// Read settings from any key/value getter, clamping anything unrecognized back
// to the defaults so a hand-edited prefs file can never wedge the app.
export function readNotifySettings(get: (key: string) => string | null): NotifySettings {
  const channel = get(CHANNEL_KEY);
  const when = get(WHEN_KEY);
  return {
    channel: channel && isNotifyChannel(channel) ? channel : DEFAULT_NOTIFY_SETTINGS.channel,
    when: when && isNotifyWhen(when) ? when : DEFAULT_NOTIFY_SETTINGS.when
  };
}

export function writeNotifySettings(
  set: (key: string, value: string) => void,
  settings: NotifySettings
): void {
  set(CHANNEL_KEY, settings.channel);
  set(WHEN_KEY, settings.when);
}

export function describeNotifySettings(settings: NotifySettings): string {
  return `Notifications: ${settings.channel} (when ${settings.when}).`;
}
