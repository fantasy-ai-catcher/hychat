import { describe, expect, it } from 'vitest';

import { buildRenderLines, sliceWindow } from './scroll.js';
import type { ChatMessage } from './state.js';

function text(id: string, body: string, createdAt = '2026-06-20T00:00:00Z'): ChatMessage {
  return { id, roomId: 'r', senderId: 'u', senderName: 'alice', kind: 'text', body, createdAt };
}

describe('buildRenderLines', () => {
  it('emits one line per short message', () => {
    const lines = buildRenderLines([text('1', 'hi'), text('2', 'yo')], 80, false);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: 'text', senderLabel: 'alice:', body: 'hi' });
  });

  it('wraps a long body across rows, sender label only on the first row', () => {
    const lines = buildRenderLines([text('1', 'abcdefghij')], 8, false);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].senderLabel).toBe('alice:');
    // Continuation rows carry body only, no repeated sender label.
    expect(lines[1].senderLabel).toBeUndefined();
    expect(lines.map((line) => line.body).join('')).toBe('abcdefghij');
  });

  it('counts CJK width so wide glyphs wrap sooner', () => {
    // width 6 holds two wide glyphs (4 cols) after a 0-width-budget first line;
    // the point is that wrapping accounts for display width, not code points.
    const lines = buildRenderLines([{ ...text('1', '你好世界'), senderName: undefined, senderId: 'u' }], 6, false);
    expect(lines.length).toBeGreaterThan(1);
  });

  it('renders system messages as centered dim text with a bullet', () => {
    const system: ChatMessage = {
      id: 's',
      roomId: 'r',
      senderId: 'u',
      senderName: 'bob',
      kind: 'system',
      body: 'joined the room',
      createdAt: '2026-06-20T00:00:00Z'
    };
    const lines = buildRenderLines([system], 80, false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'system', text: '· bob joined the room' });
  });

  it('prefixes the first row with a timestamp when enabled', () => {
    const lines = buildRenderLines([text('1', 'hi')], 80, true);
    expect(lines[0].timestamp).toMatch(/\d\d:\d\d $/);
  });
});

describe('sliceWindow', () => {
  const lines = Array.from({ length: 10 }, (_, i) => ({ kind: 'text' as const, body: String(i) }));

  it('shows the tail when offset is 0', () => {
    const win = sliceWindow(lines, 3, 0);
    expect(win.lines.map((l) => l.body)).toEqual(['7', '8', '9']);
    expect(win.clampedOffset).toBe(0);
    expect(win.maxOffset).toBe(7);
  });

  it('moves the window up by the offset', () => {
    const win = sliceWindow(lines, 3, 2);
    expect(win.lines.map((l) => l.body)).toEqual(['5', '6', '7']);
    expect(win.clampedOffset).toBe(2);
  });

  it('clamps the offset to the top', () => {
    const win = sliceWindow(lines, 3, 999);
    expect(win.lines.map((l) => l.body)).toEqual(['0', '1', '2']);
    expect(win.clampedOffset).toBe(7);
  });

  it('returns everything when the viewport is taller than the content', () => {
    const win = sliceWindow(lines, 50, 0);
    expect(win.lines).toHaveLength(10);
    expect(win.maxOffset).toBe(0);
  });
});
