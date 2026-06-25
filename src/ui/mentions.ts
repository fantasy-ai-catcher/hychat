export type MentionSpan = { start: number; end: number; name: string };

// A char that ends a mention: end-of-text or anything that is not a letter or
// digit (whitespace, punctuation). Lets "@Cool Cat!" match "Cool Cat".
function endsMention(char: string | undefined): boolean {
  return char === undefined || /[^\p{L}\p{N}]/u.test(char);
}

// Find `@<member name>` runs in `text`. The `@` must be at the start or right
// after whitespace (so an in-word `@`, e.g. an email, never matches), and the
// matched name must end on a non letter/digit boundary. Member names are tried
// longest-first so "Cool Cat" beats "Cool" and "@alicea" does not match "alice".
export function findMentionSpans(text: string, memberNames: string[]): MentionSpan[] {
  const names = memberNames
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length);
  const spans: MentionSpan[] = [];

  let index = 0;
  while (index < text.length) {
    if (text[index] === '@') {
      const before = index === 0 ? undefined : text[index - 1];
      if (before === undefined || /\s/.test(before)) {
        let matched: string | undefined;
        for (const name of names) {
          if (text.startsWith(name, index + 1) && endsMention(text[index + 1 + name.length])) {
            matched = name;
            break; // names are longest-first, so the first hit is the longest
          }
        }
        if (matched) {
          const end = index + 1 + matched.length;
          spans.push({ start: index, end, name: matched });
          index = end;
          continue;
        }
      }
    }
    index += 1;
  }

  return spans;
}

// Whether `text` @-mentions exactly `name`.
export function mentionsName(text: string, name: string | undefined): boolean {
  if (!name) {
    return false;
  }
  return findMentionSpans(text, [name]).some((span) => span.name === name);
}
