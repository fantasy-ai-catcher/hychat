import { describe, expect, it } from 'vitest';

import { buildReplySnippet } from './reply.js';

describe('buildReplySnippet', () => {
  it('uses the sender name and the body, untruncated when short', () => {
    expect(buildReplySnippet({ senderName: 'alice', senderId: 'u1', body: 'hi there' })).toEqual({
      name: 'alice',
      snippet: 'hi there'
    });
  });

  it('falls back to the sender id when there is no name', () => {
    expect(buildReplySnippet({ senderId: 'u1', body: 'yo' }).name).toBe('u1');
  });

  it('collapses newlines to spaces', () => {
    expect(buildReplySnippet({ senderName: 'a', senderId: 'u', body: 'line1\nline2' }).snippet).toBe(
      'line1 line2'
    );
  });

  it('truncates to ~40 display columns with an ellipsis (CJK-aware)', () => {
    const long = 'x'.repeat(60);
    const s = buildReplySnippet({ senderName: 'a', senderId: 'u', body: long }).snippet;
    expect(s.endsWith('…')).toBe(true);
    expect(s.length).toBeLessThan(long.length);

    // 30 CJK chars = 60 display columns -> truncated near 40 columns (~20 chars).
    const cjk = '茅'.repeat(30);
    const sc = buildReplySnippet({ senderName: 'a', senderId: 'u', body: cjk }).snippet;
    expect(sc.endsWith('…')).toBe(true);
    expect([...sc].length).toBeLessThan(25);
  });
});
