import stringWidth from 'string-width';

import { formatActivityLine, formatBeijingTime, type ChatMessage } from './state.js';
import { findMentionSpans, mentionsName, type MentionSpan } from './mentions.js';

// Member names (to highlight @<name>) + my own name (to flag messages that
// mention me). Passed through so highlighting stays a pure render-time concern.
export type MentionContext = { memberNames: string[]; selfName?: string };

// One terminal row, pre-wrapped so the viewport never relies on Ink's own
// wrapping for height accounting (scroll math needs exact line counts).
//
//   kind 'text'   — a chat line. `senderLabel`/`senderColor` and `timestamp`
//                   appear on the first wrapped row only; continuation rows
//                   carry `body` alone.
//   kind 'system' — a centered, dim room-activity note. `text` already includes
//                   the "· " bullet; `timestamp` (if any) sits on the first row.
export type RenderLine = {
  kind: 'text' | 'system';
  body?: string;
  text?: string;
  senderLabel?: string;
  senderColor?: string;
  timestamp?: string;
  // `@<name>` spans within this row's `body` (for accent highlighting), and
  // whether this row's message mentions the current user (for a gutter marker).
  mentions?: MentionSpan[];
  mentionsMe?: boolean;
};

// Greedy display-width wrap. The first row gets `firstWidth` columns (the rest
// after a sender label / timestamp prefix), continuation rows get `restWidth`.
// Breaks mid-token when needed; predictable because we render exactly these
// rows rather than letting Ink re-wrap them. Always returns at least one row.
function wrapByWidth(content: string, firstWidth: number, restWidth: number): string[] {
  const rows: string[] = [];
  let current = '';
  let currentWidth = 0;
  let budget = Math.max(1, firstWidth);

  for (const char of content) {
    const charWidth = stringWidth(char);
    if (current !== '' && currentWidth + charWidth > budget) {
      rows.push(current);
      current = '';
      currentWidth = 0;
      budget = Math.max(1, restWidth);
    }
    current += char;
    currentWidth += charWidth;
  }
  rows.push(current);
  return rows;
}

// Flatten a timeline of messages into one row per terminal line, wrapped to the
// viewport width (CJK-aware). Pure: the same input always yields the same rows.
export function buildRenderLines(
  messages: ChatMessage[],
  innerWidth: number,
  showTimestamps: boolean,
  mentionContext?: MentionContext
): RenderLine[] {
  const width = Math.max(1, innerWidth);
  const memberNames = mentionContext?.memberNames ?? [];
  const lines: RenderLine[] = [];

  for (const message of messages) {
    const timestamp = showTimestamps ? formatBeijingTime(message.createdAt) : '';
    const tsPrefix = timestamp ? `${timestamp} ` : '';
    const tsWidth = stringWidth(tsPrefix);

    if (message.kind === 'system') {
      const text = `· ${formatActivityLine(message)}`;
      const rows = wrapByWidth(text, width - tsWidth, width);
      rows.forEach((row, index) => {
        lines.push({
          kind: 'system',
          text: row,
          timestamp: index === 0 && tsPrefix ? tsPrefix : undefined
        });
      });
      continue;
    }

    const senderLabel = `${message.senderName ?? message.senderId}:`;
    const mentionsMe = mentionContext ? mentionsName(message.body, mentionContext.selfName) : false;
    // A mention-of-me message renders a 1-column "▎" gutter on every row, so
    // reserve that column on every row's wrap budget too — otherwise the body
    // overflows by one column and the line count (scroll math) is off.
    const gutterWidth = mentionsMe ? 1 : 0;
    // First row budget is reduced by the timestamp + "label " prefix.
    const prefixWidth = tsWidth + stringWidth(senderLabel) + 1;
    const rows = wrapByWidth(message.body, width - prefixWidth - gutterWidth, width - gutterWidth);
    rows.forEach((row, index) => {
      const mentions =
        memberNames.length > 0 ? findMentionSpans(row, memberNames) : undefined;
      const spans = mentions && mentions.length > 0 ? mentions : undefined;
      lines.push(
        index === 0
          ? {
              kind: 'text',
              body: row,
              senderLabel,
              senderColor: message.senderColor,
              timestamp: tsPrefix || undefined,
              mentions: spans,
              mentionsMe
            }
          : { kind: 'text', body: row, mentions: spans, mentionsMe }
      );
    });
  }

  return lines;
}

export type ScrollWindow = {
  lines: RenderLine[];
  clampedOffset: number;
  maxOffset: number;
};

// Pick the visible slice of pre-wrapped lines, anchored `offset` rows up from
// the bottom (offset 0 == latest). Clamps the offset so it can't scroll past
// the top, and reports `maxOffset` so the caller can clamp its own state.
export function sliceWindow(
  lines: RenderLine[],
  viewportHeight: number,
  offset: number
): ScrollWindow {
  const height = Math.max(1, viewportHeight);
  const total = lines.length;
  const maxOffset = Math.max(0, total - height);
  const clampedOffset = Math.min(Math.max(0, Math.round(offset)), maxOffset);
  const end = total - clampedOffset;
  const start = Math.max(0, end - height);
  return { lines: lines.slice(start, end), clampedOffset, maxOffset };
}
