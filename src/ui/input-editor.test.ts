import { describe, expect, it } from 'vitest';

import {
  applyEditorAction,
  emptyBuffer,
  type InputBuffer
} from './input-editor.js';

function buf(value: string, cursor: number): InputBuffer {
  return { value, cursor };
}

describe('applyEditorAction', () => {
  it('starts empty', () => {
    expect(emptyBuffer).toEqual({ value: '', cursor: 0 });
  });

  describe('insert', () => {
    it('inserts at the cursor and advances it', () => {
      expect(applyEditorAction(buf('ac', 1), { type: 'insert', text: 'b' })).toEqual(
        buf('abc', 2)
      );
    });

    it('inserts multi-character text (paste) as one block', () => {
      expect(applyEditorAction(buf('', 0), { type: 'insert', text: 'hello' })).toEqual(
        buf('hello', 5)
      );
    });

    it('counts emoji as a single cursor step', () => {
      const next = applyEditorAction(buf('', 0), { type: 'insert', text: '😀' });
      expect(next).toEqual(buf('😀', 1));
      expect(applyEditorAction(next, { type: 'insert', text: 'x' })).toEqual(buf('😀x', 2));
    });
  });

  describe('newline', () => {
    it('inserts a newline at the cursor', () => {
      expect(applyEditorAction(buf('ab', 1), { type: 'newline' })).toEqual(buf('a\nb', 2));
    });
  });

  describe('backspace', () => {
    it('removes the character before the cursor', () => {
      expect(applyEditorAction(buf('abc', 2), { type: 'backspace' })).toEqual(buf('ac', 1));
    });

    it('is a no-op at the start', () => {
      expect(applyEditorAction(buf('abc', 0), { type: 'backspace' })).toEqual(buf('abc', 0));
    });
  });

  describe('deleteForward', () => {
    it('removes the character at the cursor', () => {
      expect(applyEditorAction(buf('abc', 1), { type: 'deleteForward' })).toEqual(buf('ac', 1));
    });

    it('is a no-op at the end', () => {
      expect(applyEditorAction(buf('abc', 3), { type: 'deleteForward' })).toEqual(buf('abc', 3));
    });
  });

  describe('deleteWordBack', () => {
    it('deletes the word before the cursor', () => {
      expect(applyEditorAction(buf('foo bar', 7), { type: 'deleteWordBack' })).toEqual(
        buf('foo ', 4)
      );
    });

    it('eats trailing spaces then the word', () => {
      expect(applyEditorAction(buf('foo bar   ', 10), { type: 'deleteWordBack' })).toEqual(
        buf('foo ', 4)
      );
    });

    it('only deletes within the current edit, leaving text after the cursor', () => {
      expect(applyEditorAction(buf('foo bar baz', 7), { type: 'deleteWordBack' })).toEqual(
        buf('foo  baz', 4)
      );
    });
  });

  describe('killToLineStart (Ctrl+U)', () => {
    it('clears a single line up to the cursor', () => {
      expect(applyEditorAction(buf('hello world', 11), { type: 'killToLineStart' })).toEqual(
        buf('', 0)
      );
    });

    it('only kills back to the start of the current line', () => {
      expect(applyEditorAction(buf('a\nbcd', 5), { type: 'killToLineStart' })).toEqual(
        buf('a\n', 2)
      );
    });
  });

  describe('killToLineEnd (Ctrl+K)', () => {
    it('removes from the cursor to the end of the line', () => {
      expect(applyEditorAction(buf('hello world', 5), { type: 'killToLineEnd' })).toEqual(
        buf('hello', 5)
      );
    });

    it('stops at the newline', () => {
      expect(applyEditorAction(buf('ab\ncd', 1), { type: 'killToLineEnd' })).toEqual(
        buf('a\ncd', 1)
      );
    });
  });

  describe('horizontal movement', () => {
    it('moves left and right within bounds', () => {
      expect(applyEditorAction(buf('ab', 1), { type: 'moveLeft' })).toEqual(buf('ab', 0));
      expect(applyEditorAction(buf('ab', 0), { type: 'moveLeft' })).toEqual(buf('ab', 0));
      expect(applyEditorAction(buf('ab', 1), { type: 'moveRight' })).toEqual(buf('ab', 2));
      expect(applyEditorAction(buf('ab', 2), { type: 'moveRight' })).toEqual(buf('ab', 2));
    });

    it('jumps to line start and end', () => {
      expect(applyEditorAction(buf('a\nbcd', 4), { type: 'moveLineStart' })).toEqual(
        buf('a\nbcd', 2)
      );
      expect(applyEditorAction(buf('a\nbcd', 2), { type: 'moveLineEnd' })).toEqual(
        buf('a\nbcd', 5)
      );
    });
  });

  describe('word movement', () => {
    it('moves left by word', () => {
      expect(applyEditorAction(buf('foo bar', 7), { type: 'moveWordLeft' })).toEqual(
        buf('foo bar', 4)
      );
      expect(applyEditorAction(buf('foo bar', 4), { type: 'moveWordLeft' })).toEqual(
        buf('foo bar', 0)
      );
    });

    it('moves right by word to the end of the next word', () => {
      expect(applyEditorAction(buf('foo bar', 0), { type: 'moveWordRight' })).toEqual(
        buf('foo bar', 3)
      );
      expect(applyEditorAction(buf('foo bar', 3), { type: 'moveWordRight' })).toEqual(
        buf('foo bar', 7)
      );
    });
  });

  describe('vertical movement', () => {
    it('moves up keeping the column', () => {
      expect(applyEditorAction(buf('abcd\nefgh', 7), { type: 'moveUp' })).toEqual(
        buf('abcd\nefgh', 2)
      );
    });

    it('clamps the column to a shorter line above', () => {
      expect(applyEditorAction(buf('ab\nefgh', 6), { type: 'moveUp' })).toEqual(
        buf('ab\nefgh', 2)
      );
    });

    it('goes to buffer start when already on the first line', () => {
      expect(applyEditorAction(buf('abc\ndef', 2), { type: 'moveUp' })).toEqual(
        buf('abc\ndef', 0)
      );
    });

    it('moves down keeping the column', () => {
      expect(applyEditorAction(buf('abcd\nefgh', 2), { type: 'moveDown' })).toEqual(
        buf('abcd\nefgh', 7)
      );
    });

    it('goes to buffer end when already on the last line', () => {
      expect(applyEditorAction(buf('abc\ndef', 5), { type: 'moveDown' })).toEqual(
        buf('abc\ndef', 7)
      );
    });
  });

  describe('clear', () => {
    it('resets the buffer', () => {
      expect(applyEditorAction(buf('abc', 2), { type: 'clear' })).toEqual(emptyBuffer);
    });
  });
});
