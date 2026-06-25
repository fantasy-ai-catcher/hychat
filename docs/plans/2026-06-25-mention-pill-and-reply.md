# @mention pill + double-click reply

Date: 2026-06-25
Branch: `feature/mention-pill-and-reply` (off `fix/react-dev-mode-oom`)

## Motivation

Two chat polish features:
1. The current `@name` highlight (cyan bold + a `▎` gutter for mentions of me)
   feels off. Make it cleaner.
2. Add replying to a specific message (quoted), like other chat apps.

## Decisions (from brainstorming)

- **@ styling:** `@other` keeps a plain accent **font color** (no background).
  `@me` (someone mentioning the current user) renders as a **light-background
  pill** on the `@me` token. Drop the `▎` mention-me gutter (the pill is enough).
- **Reply trigger:** **double-click a chat message** to reply to it. (Hover-to-
  show-a-button is impractical in a terminal — it needs mouse-motion tracking
  that is janky and breaks text selection. We already capture mouse clicks for
  the wheel, so double-click adds no new capture mode.)
- **Reply quote display:** above the reply body, a dim line `某人: 摘要…`
  (sender name + truncated original) — no `↵` arrow.
- **Storage:** reuse the existing `messages.metadata` jsonb — **no DB migration.**
  A reply stores `metadata = { replyTo, replyToName, replyToSnippet }`.

## Feasibility note (double-click)

Left-click events already arrive (DECSET 1000/1006 enabled for the wheel; we
currently keep only wheel buttons). Double-click = two left-click presses at ~the
same cell within ~400ms, detected by us. The one fragile part is mapping a click
row to a message; we control the layout so it is computable, and it degrades
gracefully (a mis-map replies to an adjacent message or nothing — never a crash).
Verified by smoke on the real terminal.

## Architecture (all client-side; no DB migration)

### Pure logic (Layer 1, strict TDD)

- `src/ui/mouse-click.ts` (or extend `terminal-mouse.ts`):
  - `parseMouseClick(chunk)` → `{ x, y } | undefined` for a left-button press
    (SGR `<0;x;yM`). (Wheel parsing stays as-is.)
  - `isDoubleClick(prev, next)` → boolean (same/adjacent cell within 400ms).
- `src/ui/reply.ts`:
  - `buildReplySnippet(message)` → `{ name, snippet }` (snippet = first ~40
    display-columns of the body, CJK-aware, with `…` if truncated).
- Message-row hit-testing lives where the layout is known (see below) as a pure
  helper `chatRowToMessageId(clickY, layout)` given the chat viewport's top row
  and the visible `RenderLine[]` (each carrying its `messageId`).

### Rendering — `src/ui/scroll.ts` + `MessageViewport`

- `RenderLine` gains `messageId?: string` (first row of each message) so a click
  row maps back to a message; and `replyQuote?: { name: string; snippet: string }`
  on the first row of a message that has `metadata.replyTo`, rendered as a dim
  line above the body.
- `MessageViewport`: render the dim reply-quote line; render `@me` token as a
  light-background pill (`backgroundColor`), `@other` as accent color only.

### Composer / App — `src/ui/App.tsx`

- App-local `replyTarget: { id, name, snippet } | null`.
- Mouse: in the input handler, feed click chunks to `parseMouseClick`; track
  last click; on `isDoubleClick`, map the click Y to a message via the chat
  layout and set `replyTarget`.
- A dim banner above the composer when `replyTarget` is set:
  `Replying to <name>: <snippet>  (Esc to cancel)`. `Esc` clears it.
- On send: if `replyTarget` set, pass `metadata` to the session; clear it.

### Session / service

- `sendTextMessage` accepts optional `metadata` and writes it to the insert
  (currently hardcodes `{}`); `listRecentMessages`/realtime already carry
  `metadata`. `toChatMessage` maps `metadata` through to `ChatMessage.metadata`.
- `chat-session` send path threads `replyTarget` → `metadata`.

## Testing

- L1 strict TDD: `parseMouseClick`, `isDoubleClick`, `buildReplySnippet`,
  `chatRowToMessageId`, mention-pill span classification.
- L2 minimal: a message with `metadata.replyTo` renders the dim quote line;
  `@me` renders with a background.
- Smoke: double-click different messages → correct one becomes the reply target;
  send → quote shows for everyone; `@me` pill shows; `@other` is color-only.

## Out of scope

- Hover / on-message buttons; keyboard reply mode; jump-to-original; threading;
  DB migration.
