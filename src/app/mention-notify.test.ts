import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTIFY_SETTINGS,
  describeNotifySettings,
  isNotifyChannel,
  isNotifyWhen,
  readNotifySettings,
  shouldRingForMention,
  writeNotifySettings,
  type NotifySettings
} from './mention-notify.js';

const base = {
  kind: 'text' as const,
  body: 'hey @alice look',
  senderId: 'bob',
  selfUserId: 'alice-id',
  selfName: 'alice',
  focused: false,
  settings: DEFAULT_NOTIFY_SETTINGS
};

describe('shouldRingForMention', () => {
  it('rings for an incoming text that mentions me while unfocused', () => {
    expect(shouldRingForMention(base)).toBe(true);
  });

  it('does not ring when the channel is off', () => {
    expect(shouldRingForMention({ ...base, settings: { channel: 'off', when: 'unfocused' } })).toBe(
      false
    );
  });

  it('does not ring on my own message', () => {
    expect(shouldRingForMention({ ...base, senderId: 'alice-id' })).toBe(false);
  });

  it('does not ring when the body does not mention me', () => {
    expect(shouldRingForMention({ ...base, body: 'hey @bob look' })).toBe(false);
  });

  it('does not ring for non-text messages', () => {
    expect(shouldRingForMention({ ...base, kind: 'system' })).toBe(false);
  });

  it('does not ring without a self name', () => {
    expect(shouldRingForMention({ ...base, selfName: undefined })).toBe(false);
  });

  it('respects when=unfocused: silent while focused', () => {
    expect(shouldRingForMention({ ...base, focused: true })).toBe(false);
  });

  it('respects when=always: rings even while focused', () => {
    expect(
      shouldRingForMention({ ...base, focused: true, settings: { channel: 'bell', when: 'always' } })
    ).toBe(true);
  });
});

describe('readNotifySettings / writeNotifySettings', () => {
  it('returns defaults when nothing stored', () => {
    expect(readNotifySettings(() => null)).toEqual(DEFAULT_NOTIFY_SETTINGS);
  });

  it('reads valid stored values', () => {
    const store: Record<string, string> = { 'notify.channel': 'sound', 'notify.when': 'always' };
    expect(readNotifySettings((k) => store[k] ?? null)).toEqual({ channel: 'sound', when: 'always' });
  });

  it('clamps invalid stored values to defaults', () => {
    const store: Record<string, string> = { 'notify.channel': 'boom', 'notify.when': 'meh' };
    expect(readNotifySettings((k) => store[k] ?? null)).toEqual(DEFAULT_NOTIFY_SETTINGS);
  });

  it('round-trips through write then read', () => {
    const store: Record<string, string> = {};
    const settings: NotifySettings = { channel: 'banner', when: 'always' };
    writeNotifySettings((k, v) => {
      store[k] = v;
    }, settings);
    expect(readNotifySettings((k) => store[k] ?? null)).toEqual(settings);
  });
});

describe('guards and describe', () => {
  it('isNotifyChannel / isNotifyWhen', () => {
    expect(isNotifyChannel('bell')).toBe(true);
    expect(isNotifyChannel('nope')).toBe(false);
    expect(isNotifyWhen('always')).toBe(true);
    expect(isNotifyWhen('sometimes')).toBe(false);
  });

  it('describes the current settings in one line', () => {
    expect(describeNotifySettings({ channel: 'bell', when: 'unfocused' })).toContain('bell');
    expect(describeNotifySettings({ channel: 'bell', when: 'unfocused' })).toContain('unfocused');
  });
});
