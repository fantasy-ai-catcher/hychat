import stringWidth from 'string-width';

import { formatActivityLine, formatBeijingTime, type ChatMessage } from './state.js';
import { findMentionSpans, type MentionSpan } from './mentions.js';

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
  kind: 'text' | 'system' | 'reply';
  body?: string;
  text?: string;
  senderLabel?: string;
  senderColor?: string;
  timestamp?: string;
  // `@<name>` spans within this row's `body` (for accent highlighting).
  mentions?: MentionSpan[];
  // The message this row belongs to, so a click can map a screen row back to a
  // message (set on every row of a text message, incl. its reply-quote row).
  messageId?: string;
  // For a `kind: 'reply'` row: the quoted parent (sender + snippet) shown dim
  // above the reply body.
  replyQuote?: { name: string; snippet: string };
  // True on every row of a reply (quote + body) so a continuous "▎ " bar joins
  // them into one block. (The quote text is indented further; the body is not.)
  replyBar?: boolean;
};

// Pull the quoted-reply preview a message carries in its metadata, if any.
function replyQuoteOf(message: ChatMessage): { name: string; snippet: string } | undefined {
  const meta = message.metadata as Record<string, unknown> | undefined;
  const name = typeof meta?.replyToName === 'string' ? meta.replyToName : undefined;
  const snippet = typeof meta?.replyToSnippet === 'string' ? meta.replyToSnippet : undefined;
  if (meta?.replyTo && name !== undefined && snippet !== undefined) {
    return { name, snippet };
  }
  return undefined;
}

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

    // A reply renders a continuous "▎ " bar down its whole block (quote + body).
    // The quote text is indented further than the body, so the inset quote is
    // easy to tell from the reply while the bar groups them as one unit.
    const quote = replyQuoteOf(message);
    const barWidth = quote ? 2 : 0; // "▎ " on every row
    if (quote) {
      lines.push({ kind: 'reply', replyQuote: quote, messageId: message.id, replyBar: true });
    }

    const senderLabel = `${message.senderName ?? message.senderId}:`;
    // First row budget is reduced by the timestamp + "label " prefix and the bar.
    const prefixWidth = tsWidth + stringWidth(senderLabel) + 1;
    const rows = wrapByWidth(message.body, width - prefixWidth - barWidth, width - barWidth);
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
              messageId: message.id,
              replyBar: quote ? true : undefined
            }
          : { kind: 'text', body: row, mentions: spans, messageId: message.id, replyBar: quote ? true : undefined }
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
