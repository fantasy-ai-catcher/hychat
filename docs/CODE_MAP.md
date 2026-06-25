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
│   │                         presence heartbeat timer (touchPresence while in a room);
│   │                         colorPickerOpen state + pickColor/closeColorPicker methods
│   │                         (/color list opens the picker);
│   │                         watchReorderOpen state + reorderWatchlist/closeWatchReorder
│   │                         (/watch reorder opens the reorder panel)
│   ├── hychat-service.ts     [L3] all Supabase calls: auth/OTP, ensureProfile/setDisplayName,
│   │                         rooms (listRoomsWithCounts/createRoom/joinRoom/leaveRoom), messages,
│   │                         members, invite codes, quotes, touchPresence (heartbeat_presence RPC)
│   ├── update-check.ts       [L1] startup version gate: fetch latest GitHub release,
│   │                         compare semver, block launch + print `brew update && brew
│   │                         upgrade hychat` when outdated or check fails
│   │                         (HYCHAT_SKIP_UPDATE_CHECK bypass; runUpdateGate is the shell)
│   ├── session-storage.ts    local session file persistence + --profile paths
│   ├── profile-colors.ts     [L1] muted color palette + helpers
│   └── realtime-adapter.ts   thin wrapper over supabase/realtime
├── ui/
│   ├── App.tsx               [L2] Ink render: App / AppShell / InputComposer / StatusText;
│   │                         TopInfoPanel header (members grid + stocks table w/ symbol column);
│   │                         ColorPicker overlay (opened by `/color list`; arrow keys move, Enter
│   │                         selects, Esc cancels); WatchReorder overlay (opened by `/watch reorder`;
│   │                         ↑↓ move, Space grab/drop, Enter save, Esc cancel) — both pop up above
│   │                         the input box;
│   │                         MessageViewport pre-wraps + windows scrollback (buildRenderLines/
│   │                         sliceWindow); mouse wheel + PageUp/PageDown scroll, Enter jumps to latest;
│   │                         Ctrl+T toggles timestamps, Ctrl+S toggles the whole top panel (isPanelToggle);
│   │                         resolveEditorAction maps keypresses -> editor actions
│   ├── scroll.ts             [L1] chat scrollback math: buildRenderLines (flatten messages to one
│   │                         CJK-aware wrapped row each) + sliceWindow (visible slice by scroll offset)
│   ├── color-picker.ts       [L1] pure color-picker grid logic: pickerColorNames +
│   │                         colorPickerColumns + movePickerSelection (arrow-key grid nav, clamped) +
│   │                         pickerGridRows
│   ├── reorder.ts            [L1] pure moveItem(list,index,up|down) — clamped swap for the
│   │                         watchlist reorder panel
│   ├── terminal-mouse.ts     [L1/L2] xterm mouse reporting (DECSET 1000/1006): enable/parse SGR wheel
│   │                         events (button 64/65) so the wheel scrolls chat; isMouseSequence drops bytes
│   ├── input-editor.ts       [L1] pure composer editing: InputBuffer {value,cursor},
│   │                         applyEditorAction (cursor move/word ops/kill/newline,
│   │                         readline-style, code-point aware)
│   ├── state.ts              [L1] UI state types, reducer (member panel color stays in
│   │                         step with each member's latest message snapshot +
│   │                         member-color-changed for own /color set), welcome lines,
│   │                         computeMemberStatuses (active/online/offline + typing projection),
│   │                         memberGridColumns/layoutMemberGrid (header members 1/2/3-col grid),
│   │                         formatBeijingTime (ISO -> Asia/Shanghai "MM-DD HH:MM"),
│   │                         formatActivityLine (kind='system' room-activity line text),
│   │                         computePresenceTransitions (online/offline diff -> joined/left),
│   │                         mergeChatTimeline (messages + ephemeral activityByRoom by time),
│   │                         describeConnectionStatus (dim when connected, bold yellow/red when degraded)
│   ├── terminal-focus.ts     [L1/L2] xterm focus reporting (DECSET 1004): enable/parse
│   │                         CSI I/O so the app knows if its tab is focused
│   └── loading-animation.ts  [L1] spinner frames + busy-elapsed timer
├── supabase/
│   ├── client.ts             Supabase client factory
│   └── realtime.ts           realtime topic helpers + subscribeToRoomRealtime
│                             (postgres_changes for messages / watchlist / members;
│                             presence for online/offline + broadcast for typing / focus /
│                             quotes — batched server quote push, one msg per room per tick;
│                             self-heals: rebuilds + re-tracks a channel that drops into
│                             CHANNEL_ERROR/TIMED_OUT, reconnectDelayMs backoff)
└── stocks/
    ├── symbols.ts            [L1] canonical symbol parsing (AAPL.US, 0700.HK, 600519.CN, 7203.JP)
    ├── format.ts             [L1] quote display formatting (price/percent/color + /stock status line;
    │                         buildWatchlistTable: header table rows (name + symbol-code column)
    │                         + CJK-aware column widths)
    ├── cache.ts              [L1] quote cache TTL policy
    └── provider.ts           stock provider adapter contract / types

supabase/
├── config.toml               local/project config; refresh-active-quotes has verify_jwt=false
├── migrations/               schema, RLS, RPCs (identity, invite codes, open rooms,
│                             room_watchlist add/remove system-message trigger, …);
│                             room enter/leave activity is client-side presence, not a DB trigger;
│                             room_presence + heartbeat_presence / active_rooms_with_symbols RPCs,
│                             yahoo_auth crumb cache, watchlist cap trigger, pg_cron 10s refresh job
│                             (cron skips invoking the edge function when no room is active);
│                             profiles/messages display_color CHECK + update_profile_color RPC
│                             validate the muted palette (must match src/app/profile-colors.ts);
│                             room_watchlist.sort_order + reorder_watchlist RPC (member-gated)
│                             back the shared manual watchlist order;
│                             newest migration is the source of truth
└── functions/
    ├── get-stock-quotes/
    │   └── index.ts          quote Edge Function (JWT + active-profile check), /stock + /refresh
    ├── refresh-active-quotes/
    │   └── index.ts          cron-triggered Edge Function (x-cron-secret auth): batch-refreshes
    │                         present rooms' watchlists, broadcasts each room its quotes
    └── _shared/stocks/       shared logic for both functions
                              (tencent-provider.ts: qt.gtimg.cn provider for US/HK/CN —
                              toTencentSymbol + parseTencentQuotes (price/change%/name per
                              market; English US name from field 46) + GBK fetch shell;
                              routing-provider.ts: splitByMarket + createRoutingProvider
                              (US/HK/CN -> Tencent, JP -> Yahoo; throws only if every leg fails);
                              sina-extended.ts: US pre/post overlay — usMarketSession +
                              parseSinaExtended + createExtendedHoursProvider (wraps the Tencent
                              leg, swaps US price/change to Sina hq.sinajs.cn extended values
                              during pre/post, pass-through otherwise);
                              sina-hk.ts: HK real-time overlay — toSinaHkSymbol +
                              parseSinaHkRealtime + createSinaHkProvider (swaps HK price/change to
                              Sina rt_hk real-time values, keeps Tencent's name; Tencent HK is
                              ~15min delayed);
                              yahoo.ts: Yahoo v7 batch quote + cookie/crumb auth, JP-only now;
                              cache.ts: batched TTL/backoff resolveStockQuotes (display name
                              comes straight from each provider quote);
                              store.ts: stock_quotes cache + yahoo_auth crumb store)

scripts/
├── dev-login.mjs             pre-log-in test accounts (no email/OTP) into --profile files
├── dev-tmux.sh               pnpm dev:tmux — two logged-in clients side by side in tmux
├── build.mjs                 build
├── build-homebrew-release.mjs  homebrew release packaging (tarball + filled formula)
└── release.mjs               one-command release: version bump + changelog roll +
                              pack + tag + GitHub release + tap update (--dry-run)

docs/
├── CODE_MAP.md               this file
├── PRD.md                    product requirements
├── TECHNICAL_DESIGN.md       architecture & database schema
├── DISTRIBUTION.md           Homebrew distribution + release steps (tap, baked-in config)
└── plans/                    dated per-change plans (historical; not rewritten)
```
