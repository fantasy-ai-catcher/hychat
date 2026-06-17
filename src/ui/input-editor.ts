/**
 * Pure text-field editing logic for the composer (Layer 1).
 *
 * The buffer is a string plus a cursor expressed as a code-point index, so
 * astral characters (emoji) move as a single step instead of splitting. All
 * operations are pure: `applyEditorAction` maps a buffer + action to a new
 * buffer, and the Ink layer only translates keypresses into actions.
 */

export type InputBuffer = {
  value: string;
  cursor: number;
};

export const emptyBuffer: InputBuffer = { value: '', cursor: 0 };

export type EditorAction =
  | { type: 'insert'; text: string }
  | { type: 'newline' }
  | { type: 'backspace' }
  | { type: 'deleteForward' }
  | { type: 'deleteWordBack' }
  | { type: 'killToLineStart' }
  | { type: 'killToLineEnd' }
  | { type: 'moveLeft' }
  | { type: 'moveRight' }
  | { type: 'moveWordLeft' }
  | { type: 'moveWordRight' }
  | { type: 'moveLineStart' }
  | { type: 'moveLineEnd' }
  | { type: 'moveUp' }
  | { type: 'moveDown' }
  | { type: 'clear' };

function isSpace(char: string): boolean {
  return /\s/.test(char);
}

/** Index of the start of the line containing `cursor` (after the previous \n). */
function lineStart(chars: string[], cursor: number): number {
  let index = cursor;
  while (index > 0 && chars[index - 1] !== '\n') {
    index -= 1;
  }
  return index;
}

/** Index of the end of the line containing `cursor` (the next \n, or the end). */
function lineEnd(chars: string[], cursor: number): number {
  let index = cursor;
  while (index < chars.length && chars[index] !== '\n') {
    index += 1;
  }
  return index;
}

/** Start of the previous word: skip spaces, then non-spaces, moving left. */
function prevWord(chars: string[], cursor: number): number {
  let index = cursor;
  while (index > 0 && isSpace(chars[index - 1]!)) {
    index -= 1;
  }
  while (index > 0 && !isSpace(chars[index - 1]!)) {
    index -= 1;
  }
  return index;
}

/** End of the next word: skip spaces, then non-spaces, moving right. */
function nextWord(chars: string[], cursor: number): number {
  let index = cursor;
  while (index < chars.length && isSpace(chars[index]!)) {
    index += 1;
  }
  while (index < chars.length && !isSpace(chars[index]!)) {
    index += 1;
  }
  return index;
}

function make(chars: string[], cursor: number): InputBuffer {
  return { value: chars.join(''), cursor };
}

export function applyEditorAction(buffer: InputBuffer, action: EditorAction): InputBuffer {
  const chars = [...buffer.value];
  const cursor = Math.max(0, Math.min(buffer.cursor, chars.length));

  switch (action.type) {
    case 'insert':
    case 'newline': {
      const text = action.type === 'newline' ? ['\n'] : [...action.text];
      chars.splice(cursor, 0, ...text);
      return make(chars, cursor + text.length);
    }

    case 'backspace': {
      if (cursor === 0) {
        return make(chars, cursor);
      }
      chars.splice(cursor - 1, 1);
      return make(chars, cursor - 1);
    }

    case 'deleteForward': {
      if (cursor >= chars.length) {
        return make(chars, cursor);
      }
      chars.splice(cursor, 1);
      return make(chars, cursor);
    }

    case 'deleteWordBack': {
      const target = prevWord(chars, cursor);
      chars.splice(target, cursor - target);
      return make(chars, target);
    }

    case 'killToLineStart': {
      const start = lineStart(chars, cursor);
      chars.splice(start, cursor - start);
      return make(chars, start);
    }

    case 'killToLineEnd': {
      const end = lineEnd(chars, cursor);
      chars.splice(cursor, end - cursor);
      return make(chars, cursor);
    }

    case 'moveLeft':
      return make(chars, Math.max(0, cursor - 1));

    case 'moveRight':
      return make(chars, Math.min(chars.length, cursor + 1));

    case 'moveWordLeft':
      return make(chars, prevWord(chars, cursor));

    case 'moveWordRight':
      return make(chars, nextWord(chars, cursor));

    case 'moveLineStart':
      return make(chars, lineStart(chars, cursor));

    case 'moveLineEnd':
      return make(chars, lineEnd(chars, cursor));

    case 'moveUp': {
      const start = lineStart(chars, cursor);
      if (start === 0) {
        return make(chars, 0);
      }
      const column = cursor - start;
      const prevEnd = start - 1;
      const prevStart = lineStart(chars, prevEnd);
      return make(chars, prevStart + Math.min(column, prevEnd - prevStart));
    }

    case 'moveDown': {
      const end = lineEnd(chars, cursor);
      if (end === chars.length) {
        return make(chars, chars.length);
      }
      const column = cursor - lineStart(chars, cursor);
      const nextStart = end + 1;
      const nextEnd = lineEnd(chars, nextStart);
      return make(chars, nextStart + Math.min(column, nextEnd - nextStart));
    }

    case 'clear':
      return { value: '', cursor: 0 };

    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
