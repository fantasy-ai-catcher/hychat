import { describe, expect, it } from 'vitest';

import { findMentionSpans, matchesMentionPrefix, mentionsName } from './mentions.js';

describe('matchesMentionPrefix', () => {
  it('matches everyone on an empty query', () => {
    expect(matchesMentionPrefix('alice', '')).toBe(true);
  });
  it('matches a case-insensitive prefix', () => {
    expect(matchesMentionPrefix('Alice', 'al')).toBe(true);
    expect(matchesMentionPrefix('alice', 'AL')).toBe(true);
  });
  it('does not match a non-prefix', () => {
    expect(matchesMentionPrefix('bob', 'al')).toBe(false);
    expect(matchesMentionPrefix('alice', 'ice')).toBe(false); // prefix, not substring
  });
});

const members = ['alice', 'alicea', 'Cool Cat', 'bob'];

describe('findMentionSpans', () => {
  it('finds a simple mention at the start', () => {
    expect(findMentionSpans('@bob hi', members)).toEqual([{ start: 0, end: 4, name: 'bob' }]);
  });

  it('finds a mention after whitespace', () => {
    expect(findMentionSpans('hey @bob', members)).toEqual([{ start: 4, end: 8, name: 'bob' }]);
  });

  it('matches the longest member name (names with spaces, substrings)', () => {
    // "alicea" wins over "alice"; "Cool Cat" wins over "Cool".
    expect(findMentionSpans('@alicea ping', members)).toEqual([
      { start: 0, end: 7, name: 'alicea' }
    ]);
    expect(findMentionSpans('yo @Cool Cat!', members)).toEqual([
      { start: 3, end: 12, name: 'Cool Cat' }
    ]);
  });

  it('requires a non-letter/digit boundary after the name', () => {
    // member 'alice' must not match inside 'aliceb' (no member 'aliceb').
    expect(findMentionSpans('@aliceb', members.filter((n) => n !== 'alicea'))).toEqual([]);
  });

  it('does not match an in-word @ (e.g. an email)', () => {
    expect(findMentionSpans('mail me at bob@host.com', members)).toEqual([]);
  });

  it('finds multiple mentions', () => {
    const spans = findMentionSpans('@alice and @bob', members);
    expect(spans).toEqual([
      { start: 0, end: 6, name: 'alice' },
      { start: 11, end: 15, name: 'bob' }
    ]);
  });

  it('returns nothing when there are no members', () => {
    expect(findMentionSpans('@bob', [])).toEqual([]);
  });
});

describe('mentionsName', () => {
  it('is true when the text mentions the name', () => {
    expect(mentionsName('hey @alice', 'alice')).toBe(true);
  });

  it('is false otherwise / for empty name', () => {
    expect(mentionsName('hey alice', 'alice')).toBe(false);
    expect(mentionsName('@alice', undefined)).toBe(false);
    expect(mentionsName('@alice', '')).toBe(false);
  });

  it('does not match a longer name when only the short one is mine', () => {
    // text mentions "alicea"; I am "alice" -> not me.
    expect(mentionsName('@alicea', 'alice')).toBe(false);
  });
});
