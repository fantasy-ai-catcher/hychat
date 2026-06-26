# HyChat

Node.js terminal chat for a small private friend group. HyChat has room chat
with @mentions, replies, and sound notifications, shared stock watchlists, and
real-time quotes for US, Hong Kong, China A-share, and Japan symbols.

## Current Scope

Implemented:

1. TypeScript CLI project with Vitest.
2. Runtime env validation.
3. Interactive Ink terminal UI with slash commands.
4. Canonical stock symbols such as `AAPL.US`, `0700.HK`, `600519.CN`, `7203.JP`.
5. Supabase schema migration with RLS and explicit Data API grants.
6. Supabase email-OTP Auth with invite codes and local session persistence. Your identity is your email; your display name is a separate, changeable label.
7. Stock quote Edge Function with a current-quote cache and keyless quotes (Tencent for US/HK/CN, Yahoo for JP), plus US pre-/after-hours and Hong Kong real-time overlays. Quotes refresh on a server-side schedule while a room is in use.
8. Open rooms: create rooms, discover all rooms with member counts, self-join any room, member listing, message history, and realtime message/watchlist updates.
9. Shared room watchlist with manual reordering and quote refresh.
10. `@mentions` with an autocomplete picker; a highlighted pill when you are mentioned; double-click a message to reply with a quoted preview.
11. Configurable @mention notifications (terminal bell, macOS sound, or desktop banner), saved per machine.
12. Per-member profile colors, presence/typing/focus indicators, and scrollback with mouse wheel and keyboard.

## Install (friends)

```bash
brew install fantasy-ai-catcher/tap/hychat
hychat
```

No configuration needed — the Supabase connection is baked in. You need an
invite code from the admin to register: `/start <your-email> <invite-code>`,
then `/verify <code-from-email>`. Update with `brew upgrade hychat`.

Maintainer release steps live in [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).

## Requirements (development)

1. Node.js 22 or newer.
2. pnpm 10.
3. Supabase CLI for local database and Edge Function work.
4. A Supabase project or local Supabase stack.

## Setup

```bash
pnpm install
```

The app ships with a baked-in Supabase connection (see `src/config/env.ts`), so
`pnpm dev` runs without any `.env`. Only create one to point at a *different*
Supabase project for development:

```bash
cp .env.example .env
```

```text
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
STOCK_PROVIDER=yahoo_finance
STOCK_QUOTE_CACHE_TTL_SECONDS=60
```

Stock quotes use keyless public endpoints (Tencent, Yahoo, Sina), so no provider
API key is required. Optionally tune the Edge Function cache TTL:

```bash
supabase secrets set STOCK_QUOTE_CACHE_TTL_SECONDS=60
```

Supabase automatically injects `SUPABASE_URL` and service credentials for deployed functions. Do not place a service role key in terminal client env files.

## Development Commands

```bash
pnpm test -- --run
pnpm typecheck
pnpm build
pnpm dev
```

### Local multi-account testing

Each `--profile <name>` keeps its own session file under
`~/.hychat/sessions/<name>/`, so you can run several accounts at once:

```bash
hychat --profile alice
hychat --profile bob
```

To skip the email/OTP dance entirely, pre-log-in test accounts with the
service-role key (read from `SUPABASE_SERVICE_ROLE_KEY`, or fetched via the
linked Supabase CLI). This creates confirmed `<name>@hychat.test` users, gives
each a profile, and writes a ready session into the profile file:

```bash
pnpm dev:login            # sets up alice and bob
pnpm dev:login carol dave # or name your own
pnpm dev --profile alice  # launches already signed in
```

`pnpm dev:tmux` does both at once: pre-logs-in alice and bob and opens a tmux
session with the two clients side by side (Ctrl-b ← / → to switch panes,
Ctrl-b z to zoom, Ctrl-b d to detach, `tmux attach` to return).

## Terminal Commands

```text
Start
  /start <email> [invite-code]   Log in, or register with an invite code.
  /verify <code or pasted link>  Finish /start with the emailed code or link.
  /logout confirm                Sign out locally (asks for confirm).
  /quit                          Exit HyChat.

Rooms
  /create <room name>            Create a room and join it.
  /rooms                         List every room with member counts; (joined) marks yours.
  /join <number|room id|name>    Join any room and enter it. No invite needed.
  /leave                         Leave the current room.

Members & invites
  /invite-code                   Create a registration code for a friend (admin only).
  /invite-code list              List the codes you created and whether they were used.
  /invite-code revoke <code>     Revoke one of your unused codes.
  /members                       List members in the current room.

Stocks
  /watch add <symbol>            Add a stock to the room watchlist.
  /watch remove <symbol>         Remove a stock from the room watchlist.
  /watch reorder                 Reorder the watchlist (↑↓ move, Space grab, Enter save).
  /stock <symbol>                Load the latest quote for one stock.
  /refresh [symbol]              Refresh all watched quotes, or just one.

Profile
  /name <new name>               Change your display name (alias: /nick).
  /color                         Show your color and the palette.
  /color list                    Pick a color in an interactive grid.
  /color set <color>             Set your name color directly.

Notifications
  /notify                        Show how you are alerted on @mentions.
  /notify off|bell|sound|banner  Choose the alert: silent, terminal bell, macOS sound, banner.
  /notify when always|unfocused  Ring on every mention, or only when the window is unfocused.
  /notify test                   Play your current notification once.

Help
  /help                          Show all commands.
```

### Chat interactions (no slash)

- **@mention** — type `@` to open a member picker; keep typing to filter by name
  prefix, `↑`/`↓` to move, `Enter` to insert. When someone @mentions you, your
  name shows as a highlighted pill and you get a notification (see `/notify`).
- **Reply** — double-click a message to reply to it; a quoted preview is shown
  above your message and the composer is prefilled with `@them`. `Esc` cancels.
- **Scroll** — mouse wheel or `PageUp`/`PageDown` to move through history; press
  `Enter` on an empty input to jump back to the latest message.
- **Toggles** — `Ctrl+T` shows/hides per-message timestamps; `Ctrl+S` shows/hides
  the top panel (members + stocks).

Log in or register with `/start <email>`; a brand-new account needs an invite
code (`/start <email> <invite-code>`). HyChat emails you a code or link — finish
with `/verify <code or pasted link>`. The very first account ever created
becomes the admin. Your display name defaults to the part of your email before
`@`; change it any time with `/name <new name>`. Display names are just labels —
they do not have to be unique and are never tied to your login.

Rooms are open to everyone in the circle: `/rooms` lists every room with its
member count (and marks the ones you are in), and `/join <number|name>` joins
any of them — no invitation needed. There is no "invite someone into a room"
step.

Invite codes are only for account registration. `/invite-code` (admin only)
creates a global code you hand to a new friend so they can `/start <email>
<code>`; once in, they pick rooms themselves. Use `/invite-code list` and
`/invite-code revoke <code>` to manage codes you issued.

Your identity is your email login; the local session file at
`~/.hychat/session.json` (or `~/.hychat/sessions/<profile>/session.json`) caches
it. Your `/notify` preference is saved next to it in `prefs.json` (per machine,
per profile — it is never stored in Supabase). `/logout` warns and requires
`/logout confirm`; log back in any time with `/start <email>`.

Use `/members` inside a room to list every member with their role and selected profile color.

## Supabase

Schema, RLS policies, and RPCs live in `supabase/migrations/`; the newest
migration is the source of truth. The schema creates these tables:

1. `profiles`
2. `rooms`
3. `room_members`
4. `messages`
5. `room_watchlist`
6. `stock_quotes`
7. `invite_codes`

All public app tables enable RLS. Tables exposed through the Data API include explicit `GRANT` statements for `authenticated`. Private membership and profile helper functions live in the non-exposed `private` schema to avoid RLS recursion in policies. A logged-in user cannot create rooms or send messages until their `profiles.status` is `active`.

## Stock Quotes

Providers (all keyless): Tencent (`qt.gtimg.cn`) for US, Hong Kong, and China
A-shares; Yahoo Finance (`v7/finance/quote`) for Japan. Two Sina overlays add
US pre-/after-hours prices and Hong Kong real-time prices (Tencent's HK feed is
~15 minutes delayed). The Edge Function routes each symbol to the right source
and falls back only if a leg fails. Symbols cover US (`AAPL.US`), Hong Kong
(`0700.HK`), China A-shares (`600519.CN`), and Japan (`7203.JP`).

While a room is in use, a server-side `pg_cron` job refreshes its watchlist on a
schedule and broadcasts the quotes to everyone in the room; the cron skips work
when no room is active.

HyChat stores only the current quote cache:

```text
stock_quotes.canonical_symbol primary key
```

There is no quote history table. Refreshes overwrite the same row. Default TTL is 60 seconds.

Supported canonical symbol examples:

```text
AAPL.US
TSLA.US
0700.HK
9988.HK
600519.CN
000001.CN
```

## Tests

The test suite includes:

1. Env parsing.
2. Command parsing.
3. Session persistence and chat session command execution.
4. Symbol parsing and cache policy.
5. Static Supabase SQL checks.
6. Repository and service query construction.
7. Edge quote resolver behavior.
8. Realtime subscription wiring.
9. UI state reducer and App composition.

Run all:

```bash
pnpm test -- --run
pnpm typecheck
pnpm build
```
