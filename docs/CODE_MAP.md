# Code map

Per-file feature index. Use it to find which file owns a feature instead of
reading code to locate it, then open that file directly. Paths are relative to
the repo root. `[L1/L2/L3]` mark the test layers from `CLAUDE.md`
(L1 pure/strict-TDD, L2 Ink UI, L3 Supabase boundary).

Keep this in sync: when you add, remove, rename, or move a feature/module,
update this file in the same change. A stale map is a bug.

```text
src/
├── index.ts                  process entry point; calls runCli
├── cli.ts                    CLI parsing (--profile, doctor, --version), .env load,
│                             and wiring (Supabase client → service → realtime → Ink App)
├── types.ts                  shared scalar type aliases (UUID, ISODateTime)
├── config/
│   └── env.ts                runtime env schema / validation (zod)
├── chat/
│   └── commands.ts           [L1] slash-command parsing → typed ParsedChatInput
│                             (/start /verify /name /join /leave /rooms /invite-code /watch /stock /color …)
├── app/
│   ├── chat-session.ts       [L1] session orchestration: login/verify flow, command
│   │                         handling, pending-status + help text, service interface;
│   │                         presence heartbeat timer (touchPresence while in a room)
│   ├── hychat-service.ts     [L3] all Supabase calls: auth/OTP, ensureProfile/setDisplayName,
│   │                         rooms (listRoomsWithCounts/createRoom/joinRoom/leaveRoom), messages,
│   │                         members, invite codes, quotes, touchPresence (heartbeat_presence RPC)
│   ├── session-storage.ts    local session file persistence + --profile paths
│   ├── profile-colors.ts     [L1] color palette + helpers
│   └── realtime-adapter.ts   thin wrapper over supabase/realtime
├── ui/
│   ├── App.tsx               [L2] Ink render: App / AppShell / InputComposer / StatusText;
│   │                         MessageViewport renders text vs kind='system' activity lines;
│   │                         Ctrl+T toggles per-message Beijing-time timestamps;
│   │                         resolveEditorAction maps keypresses -> editor actions
│   ├── input-editor.ts       [L1] pure composer editing: InputBuffer {value,cursor},
│   │                         applyEditorAction (cursor move/word ops/kill/newline,
│   │                         readline-style, code-point aware)
│   ├── state.ts              [L1] UI state types, reducer, welcome lines,
│   │                         computeMemberStatuses (active/online/offline + typing projection),
│   │                         formatBeijingTime (ISO -> Asia/Shanghai "MM-DD HH:MM"),
│   │                         formatActivityLine (kind='system' room-activity line text),
│   │                         computePresenceTransitions (online/offline diff -> joined/left),
│   │                         mergeChatTimeline (messages + ephemeral activityByRoom by time)
│   ├── terminal-focus.ts     [L1/L2] xterm focus reporting (DECSET 1004): enable/parse
│   │                         CSI I/O so the app knows if its tab is focused
│   └── loading-animation.ts  [L1] spinner frames + busy-elapsed timer
├── supabase/
│   ├── client.ts             Supabase client factory
│   └── realtime.ts           realtime topic helpers + subscribeToRoomRealtime
│                             (postgres_changes for messages / watchlist / members;
│                             presence for online/offline + broadcast for typing / focus /
│                             quotes — batched server quote push, one msg per room per tick)
└── stocks/
    ├── symbols.ts            [L1] canonical symbol parsing (AAPL.US, 0700.HK, 600519.CN, 7203.JP)
    ├── format.ts             [L1] quote display formatting (price/percent/color + /stock status line)
    ├── cache.ts              [L1] quote cache TTL policy
    └── provider.ts           stock provider adapter contract / types

supabase/
├── config.toml               local/project config; refresh-active-quotes has verify_jwt=false
├── migrations/               schema, RLS, RPCs (identity, invite codes, open rooms,
│                             room_watchlist add/remove system-message trigger, …);
│                             room enter/leave activity is client-side presence, not a DB trigger;
│                             room_presence + heartbeat_presence / active_rooms_with_symbols RPCs,
│                             yahoo_auth crumb cache, watchlist cap trigger, pg_cron 10s refresh job;
│                             newest migration is the source of truth
└── functions/
    ├── get-stock-quotes/
    │   └── index.ts          quote Edge Function (JWT + active-profile check), /stock + /refresh
    ├── refresh-active-quotes/
    │   └── index.ts          cron-triggered Edge Function (x-cron-secret auth): batch-refreshes
    │                         present rooms' watchlists, broadcasts each room its quotes
    └── _shared/stocks/       shared logic for both functions
                              (yahoo.ts: Yahoo v7 batch quote + cookie/crumb auth, US/HK/CN/JP;
                              cache.ts: batched TTL/backoff resolveStockQuotes;
                              store.ts: stock_quotes cache + yahoo_auth crumb store)

scripts/
├── dev-login.mjs             pre-log-in test accounts (no email/OTP) into --profile files
├── dev-tmux.sh               pnpm dev:tmux — two logged-in clients side by side in tmux
├── build.mjs                 build
└── build-homebrew-release.mjs  homebrew release packaging

docs/
├── CODE_MAP.md               this file
├── PRD.md                    product requirements
├── TECHNICAL_DESIGN.md       architecture & database schema
└── plans/                    dated per-change plans (historical; not rewritten)
```
