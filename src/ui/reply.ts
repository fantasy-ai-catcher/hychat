import stringWidth from 'string-width';

export type ReplyQuote = { name: string; snippet: string };

type ReplyableMessage = { senderName?: string; senderId: string; body: string };

const MAX_SNIPPET_COLUMNS = 40;

// Build the quoted-reply preview stored in a reply's metadata and shown above
// it: the parent's sender name + a single-line, display-width-truncated body.
export function buildReplySnippet(message: ReplyableMessage): ReplyQuote {
  const name = message.senderName ?? message.senderId;
  const oneLine = message.body.replace(/\s+/g, ' ').trim();

  if (stringWidth(oneLine) <= MAX_SNIPPET_COLUMNS) {
    return { name, snippet: oneLine };
  }

  let snippet = '';
  let width = 0;
  for (const char of oneLine) {
    const next = width + stringWidth(char);
    if (next > MAX_SNIPPET_COLUMNS) {
      break;
    }
    snippet += char;
    width = next;
  }
  return { name, snippet: `${snippet}…` };
}
