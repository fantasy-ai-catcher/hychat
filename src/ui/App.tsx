import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import stringWidth from 'string-width';

import {
  createChatSession,
  type ChatSessionSnapshot,
  type CreateChatSessionOptions
} from '../app/chat-session.js';
import { DEFAULT_PROFILE_COLOR, resolveProfileColor } from '../app/profile-colors.js';
import {
  buildWatchlistTable,
  type WatchlistDirection,
  type WatchlistQuote,
  type WatchlistTable
} from '../stocks/format.js';
import {
  applyEditorAction,
  emptyBuffer,
  type EditorAction
} from './input-editor.js';
import {
  buildShimmerSegments,
  formatBusyElapsed,
  loadingColor,
  spinnerFrame
} from './loading-animation.js';
import type { AppState, MemberGridLayout, MemberView } from './state.js';
import {
  buildWelcomeLines,
  computeMemberStatuses,
  createInitialAppState,
  describeConnectionStatus,
  layoutMemberGrid,
  mergeChatTimeline,
  resolveShellView
} from './state.js';
import {
  colorPickerColumns,
  colorPickerHeight,
  movePickerSelection,
  pickerColorNames,
  pickerGridRows,
  type PickerDirection
} from './color-picker.js';
import { moveItem, type ReorderDirection } from './reorder.js';
import { buildRenderLines, sliceWindow, type MentionContext } from './scroll.js';
import type { MentionSpan } from './mentions.js';
import { isFocusEventOnly, watchTerminalFocus } from './terminal-focus.js';
import {
  isDoubleClick,
  isMouseSequence,
  watchTerminalMouse,
  type ClickStamp
} from './terminal-mouse.js';
import { buildReplySnippet } from './reply.js';

// Rows the mouse wheel scrolls per notch.
const WHEEL_STEP = 3;

export type AppProps = {
  state?: AppState;
  service?: CreateChatSessionOptions['service'];
  realtime?: CreateChatSessionOptions['realtime'];
  showPresenceActivity?: boolean;
};

function createSnapshot(state: AppState): ChatSessionSnapshot {
  return {
    state,
    user: null,
    statusText:
      'Use /start <email> to log in, or /start <email> <invite-code> to register.',
    isBusy: false,
    helpLines: [],
    shouldExit: false,
    colorPickerOpen: false,
    watchReorderOpen: false
  };
}

export function App({ state: fixedState, service, realtime, showPresenceActivity }: AppProps) {
  const { exit } = useApp();
  const [buffer, setBuffer] = useState(emptyBuffer);
  const input = buffer.value;
  const [cursorVisible, setCursorVisible] = useState(true);
  const [focused, setFocused] = useState(true);
  const [snapshot, setSnapshot] = useState<ChatSessionSnapshot>(() =>
    createSnapshot(fixedState ?? createInitialAppState())
  );
  const session = useMemo(
    () =>
      service
        ? createChatSession({
            service,
            realtime,
            showPresenceActivity,
            onSnapshotChange: setSnapshot
          })
        : undefined,
    [service, realtime, showPresenceActivity]
  );

  useEffect(() => {
    return watchTerminalFocus((isFocused) => {
      setFocused(isFocused);
      session?.notifyFocus(isFocused);
    });
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let cancelled = false;
    void session.initialize().then((nextSnapshot) => {
      if (!cancelled) {
        setSnapshot(nextSnapshot);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (snapshot.shouldExit) {
      exit();
    }
  }, [exit, snapshot.shouldExit]);

  // Blink the input caret. Safe now that the app runs React in production mode
  // (see src/index.ts) — dev-mode React leaked memory on every re-render.
  useEffect(() => {
    const timer = setInterval(() => {
      setCursorVisible((current) => !current);
    }, 500);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const [busyTick, setBusyTick] = useState(0);
  const [busyStartedAt, setBusyStartedAt] = useState<number | undefined>();
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  // Rows scrolled up from the latest message (0 == pinned to the bottom).
  const [scrollOffset, setScrollOffset] = useState(0);
  const [pickerIndex, setPickerIndex] = useState(0);

  // AppShell knows the real wrapped-line count, so it writes the scroll ceiling
  // here during render; the handlers clamp against it so we never scroll past
  // the top of the history.
  const maxOffsetRef = useRef(0);
  const scrollUp = (step: number) =>
    setScrollOffset((current) => Math.min(maxOffsetRef.current, current + step));
  const scrollDown = (step: number) =>
    setScrollOffset((current) => Math.max(0, current - step));

  // Mouse wheel scrolls the chat history. Enabling reporting captures native
  // text selection, so users hold Option/Shift to select (see terminal-mouse).
  useEffect(() => {
    return watchTerminalMouse(
      (direction) => {
        if (direction === 'up') {
          scrollUp(WHEEL_STEP);
        } else {
          scrollDown(WHEEL_STEP);
        }
      },
      { stdin: process.stdin, stdout: process.stdout },
      (click) => {
        const stamp: ClickStamp = { ...click, x: click.x, y: click.y, t: Date.now() };
        const isDouble = isDoubleClick(lastClickRef.current, stamp);
        lastClickRef.current = stamp;
        if (!isDouble) {
          return;
        }
        const messageId = clickMapRef.current.get(click.y);
        if (!messageId) {
          return;
        }
        const state = activeStateRef.current;
        const roomId = state.activeRoomId;
        const message = roomId
          ? (state.messagesByRoom[roomId] ?? []).find((m) => m.id === messageId)
          : undefined;
        if (message && message.kind === 'text') {
          const { name, snippet } = buildReplySnippet(message);
          setReplyTarget({ id: message.id, name, snippet });
          // Prefill the composer with a mention of the person being replied to.
          setBuffer((current) => applyEditorAction(current, { type: 'insert', text: `@${name} ` }));
        }
      }
    );
  }, []);

  // Jump back to the latest when switching rooms, and close the mention picker
  // so it can't linger into a different room's member list.
  const activeRoomId = (fixedState ?? snapshot.state).activeRoomId;
  useEffect(() => {
    setScrollOffset(0);
    setMentionOpen(false);
    setReplyTarget(null);
  }, [activeRoomId]);

  useEffect(() => {
    if (!snapshot.isBusy) {
      setBusyStartedAt(undefined);
      return;
    }

    setBusyTick(0);
    setBusyStartedAt(Date.now());
    const timer = setInterval(() => {
      setBusyTick((current) => current + 1);
    }, 80);

    return () => {
      clearInterval(timer);
    };
  }, [snapshot.isBusy]);

  const colorPickerOpen = snapshot.colorPickerOpen;
  useEffect(() => {
    if (colorPickerOpen) {
      const names = pickerColorNames();
      const currentName = snapshot.user?.displayColor ?? DEFAULT_PROFILE_COLOR;
      const found = names.indexOf(currentName);
      setPickerIndex(found >= 0 ? found : 0);
    }
  }, [colorPickerOpen, snapshot.user?.displayColor]);

  // Watchlist reorder mode: snapshot the current order into local state when it
  // opens, then mutate that working copy until the user saves (Enter) or cancels.
  const [reorderItems, setReorderItems] = useState<WatchlistQuote[]>([]);
  const [reorderIndex, setReorderIndex] = useState(0);
  const [reorderGrabbed, setReorderGrabbed] = useState(false);

  // Reply: double-clicking a chat message sets it as the reply target, shown in
  // a banner above the composer until you send (Enter) or cancel (Esc).
  const [replyTarget, setReplyTarget] = useState<{ id: string; name: string; snippet: string } | null>(
    null
  );
  // MessageViewport writes screen-row -> messageId here each render; a click maps
  // its row through this. The latest active state is kept in a ref so the (once-
  // created) mouse handler can resolve the clicked message without stale closure.
  const clickMapRef = useRef(new Map<number, string>());
  const lastClickRef = useRef<ClickStamp | null>(null);
  const activeStateRef = useRef(fixedState ?? snapshot.state);
  activeStateRef.current = fixedState ?? snapshot.state;

  // @mention picker (composer-local; opened by typing `@` at a word boundary).
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionMembers = selectMembers(
    fixedState ?? snapshot.state,
    (fixedState ?? snapshot.state).activeRoomId,
    snapshot.user?.id,
    focused
  );
  const watchReorderOpen = snapshot.watchReorderOpen;
  useEffect(() => {
    if (watchReorderOpen) {
      const roomId = (fixedState ?? snapshot.state).activeRoomId;
      setReorderItems(selectWatchlistQuotes(snapshot.state, roomId));
      setReorderIndex(0);
      setReorderGrabbed(false);
    }
  }, [watchReorderOpen, fixedState, snapshot.state]);

  async function submitLine(line: string): Promise<void> {
    if (!session) {
      return;
    }

    const trimmed = line.trim();

    if (trimmed === '') {
      setSnapshot(await session.handleLine(line));
      return;
    }

    // Attach the reply target (if any) as the message's metadata, then clear it.
    const reply = replyTarget
      ? { replyTo: replyTarget.id, replyToName: replyTarget.name, replyToSnippet: replyTarget.snippet }
      : undefined;
    if (reply && !trimmed.startsWith('/')) {
      setReplyTarget(null);
    }
    setSnapshot(await session.handleLine(line, reply && !trimmed.startsWith('/') ? reply : undefined));
  }

  useInput((value, key) => {
    if (snapshot.colorPickerOpen) {
      if (key.ctrl && value === 'c') {
        exit();
        return;
      }
      if (key.escape) {
        session?.closeColorPicker();
        return;
      }
      if (key.return) {
        const names = pickerColorNames();
        void session?.pickColor(names[pickerIndex] ?? DEFAULT_PROFILE_COLOR);
        return;
      }
      const direction: PickerDirection | undefined = key.upArrow
        ? 'up'
        : key.downArrow
          ? 'down'
          : key.leftArrow
            ? 'left'
            : key.rightArrow
              ? 'right'
              : undefined;
      if (direction) {
        const count = pickerColorNames().length;
        const columns = colorPickerColumns(process.stdout.columns ?? 80);
        setPickerIndex((current) => movePickerSelection(current, direction, count, columns));
      }
      return; // picker swallows all other keys
    }

    if (snapshot.watchReorderOpen) {
      if (key.ctrl && value === 'c') {
        exit();
        return;
      }
      if (key.escape) {
        session?.closeWatchReorder();
        return;
      }
      if (key.return) {
        void session?.reorderWatchlist(reorderItems.map((item) => item.symbol));
        return;
      }
      if (value === ' ') {
        setReorderGrabbed((grabbed) => !grabbed);
        return;
      }
      const reorderDir: ReorderDirection | undefined = key.upArrow
        ? 'up'
        : key.downArrow
          ? 'down'
          : undefined;
      if (reorderDir) {
        const count = reorderItems.length;
        if (reorderGrabbed) {
          setReorderItems((items) => moveItem(items, reorderIndex, reorderDir));
        }
        setReorderIndex((current) =>
          reorderDir === 'up' ? Math.max(0, current - 1) : Math.min(count - 1, current + 1)
        );
      }
      return; // reorder swallows all other keys
    }

    if (mentionOpen) {
      if (key.ctrl && value === 'c') {
        exit();
        return;
      }
      if (key.escape) {
        setMentionOpen(false);
        setBuffer((current) => applyEditorAction(current, { type: 'insert', text: '@' }));
        return;
      }
      if (key.return || key.tab) {
        const name = mentionMembers[mentionIndex]?.displayName ?? mentionMembers[mentionIndex]?.userId;
        setMentionOpen(false);
        if (name) {
          setBuffer((current) => applyEditorAction(current, { type: 'insert', text: `@${name} ` }));
        }
        return;
      }
      if (key.upArrow) {
        setMentionIndex((current) => Math.max(0, current - 1));
        return;
      }
      if (key.downArrow) {
        setMentionIndex((current) => Math.min(mentionMembers.length - 1, current + 1));
        return;
      }
      return; // mention picker swallows all other keys
    }

    if (key.ctrl && value === 'c') {
      exit();
      return;
    }

    // Esc cancels a pending reply (when nothing modal is open).
    if (key.escape && replyTarget) {
      setReplyTarget(null);
      return;
    }

    // Ctrl+T toggles per-message timestamps. Using Ctrl avoids clashing with a
    // literal 't' in the input (the typing branch below only fires when !ctrl).
    if (key.ctrl && value === 't') {
      setShowTimestamps((current) => !current);
      return;
    }

    // Ctrl+S shows/hides the whole top panel (members + stocks).
    if (isPanelToggle(value, key)) {
      setShowPanel((current) => !current);
      return;
    }

    // Mouse-wheel escape sequences also reach stdin; the terminal-mouse watcher
    // handles scrolling, so never let the bytes enter the input.
    if (isMouseSequence(value)) {
      return;
    }

    // PageUp/PageDown scroll the chat history a screenful at a time.
    if (key.pageUp) {
      scrollUp(scrollPage());
      return;
    }
    if (key.pageDown) {
      scrollDown(scrollPage());
      return;
    }

    // Focus-reporting escape sequences (CSI I / CSI O) also reach stdin; the
    // terminal-focus watcher handles them, so never let them enter the input.
    if (isFocusEventOnly(value) || value === '[I' || value === '[O') {
      return;
    }

    // Enter submits the whole buffer; Shift+Tab inserts a newline instead.
    if (key.return) {
      const submitted = buffer.value;
      setBuffer(emptyBuffer);
      setScrollOffset(0);
      void submitLine(submitted);
      return;
    }

    // Typing `@` at a word boundary (start or after whitespace), in a room with
    // members, opens the mention picker instead of inserting the character.
    if (value === '@' && !key.ctrl && !key.meta && mentionMembers.length > 0) {
      const chars = [...buffer.value];
      const before = buffer.cursor > 0 ? chars[buffer.cursor - 1] : undefined;
      if (before === undefined || /\s/.test(before)) {
        setMentionIndex(0);
        setMentionOpen(true);
        return;
      }
    }

    const action = resolveEditorAction(value, key);
    if (!action) {
      return;
    }

    setBuffer((current) => applyEditorAction(current, action));

    // Typing a real character (not a command) signals presence to the room.
    if (
      action.type === 'insert' &&
      session &&
      !action.text.startsWith('/') &&
      !buffer.value.startsWith('/')
    ) {
      session.notifyTyping();
    }
  });

  const activeState = fixedState ?? snapshot.state;
  const terminalRows = process.stdout.rows;
  const terminalColumns = process.stdout.columns;

  // On /quit (or Ctrl+C) render an empty frame so Ink erases the whole UI on
  // this render, before the exit effect unmounts. Otherwise Ink persists its
  // last frame, freezing a stale "connecting…" status bar in the scrollback.
  if (snapshot.shouldExit) {
    return null;
  }

  return (
    <AppShell
      state={activeState}
      statusText={snapshot.statusText}
      busy={snapshot.isBusy}
      busyTick={busyTick}
      busyElapsed={
        busyStartedAt === undefined ? undefined : formatBusyElapsed(busyStartedAt, Date.now())
      }
      userLabel={snapshot.user?.displayName}
      userRole={snapshot.user?.role}
      currentUserId={snapshot.user?.id}
      currentUserActive={focused}
      promptLabel=">"
      input={input}
      cursor={buffer.cursor}
      cursorVisible={cursorVisible}
      showTimestamps={showTimestamps}
      showPanel={showPanel}
      scrollOffset={scrollOffset}
      maxOffsetRef={maxOffsetRef}
      height={terminalRows}
      width={terminalColumns}
      colorPickerOpen={snapshot.colorPickerOpen}
      pickerIndex={pickerIndex}
      pickerCurrentColor={snapshot.user?.displayColor}
      watchReorderOpen={snapshot.watchReorderOpen}
      reorderItems={reorderItems}
      reorderIndex={reorderIndex}
      reorderGrabbed={reorderGrabbed}
      mentionOpen={mentionOpen}
      mentionMembers={mentionMembers}
      mentionIndex={mentionIndex}
      selfName={snapshot.user?.displayName}
      replyTarget={replyTarget}
      clickMapRef={clickMapRef}
    />
  );
}

type AppShellProps = {
  state: AppState;
  statusText: string;
  busy?: boolean;
  busyTick?: number;
  busyElapsed?: string;
  userLabel?: string;
  userRole?: string;
  currentUserId?: string;
  currentUserActive?: boolean;
  promptLabel: string;
  input: string;
  cursor?: number;
  cursorVisible: boolean;
  showTimestamps?: boolean;
  showPanel?: boolean;
  scrollOffset?: number;
  // Written during render with the current scroll ceiling so App can clamp.
  maxOffsetRef?: { current: number };
  height?: number;
  width?: number;
  // The color picker pops up above the input composer when open; the chat
  // shrinks by the picker's height to make room.
  colorPickerOpen?: boolean;
  pickerIndex?: number;
  pickerCurrentColor?: string;
  // The watchlist reorder panel pops up above the input composer when open.
  watchReorderOpen?: boolean;
  reorderItems?: WatchlistQuote[];
  reorderIndex?: number;
  reorderGrabbed?: boolean;
  // @mention picker + the data needed to highlight mentions in the chat.
  mentionOpen?: boolean;
  mentionMembers?: MemberView[];
  mentionIndex?: number;
  selfName?: string;
  replyTarget?: { id: string; name: string; snippet: string } | null;
  clickMapRef?: { current: Map<number, string> };
};

export function AppShell({
  state,
  statusText,
  busy,
  busyTick,
  busyElapsed,
  userLabel,
  userRole,
  currentUserId,
  currentUserActive,
  promptLabel,
  input,
  cursor,
  cursorVisible,
  showTimestamps,
  showPanel = true,
  scrollOffset = 0,
  maxOffsetRef,
  height,
  width,
  colorPickerOpen = false,
  pickerIndex = 0,
  pickerCurrentColor,
  watchReorderOpen = false,
  reorderItems = [],
  reorderIndex = 0,
  reorderGrabbed = false,
  mentionOpen = false,
  mentionMembers = [],
  mentionIndex = 0,
  selfName,
  replyTarget,
  clickMapRef
}: AppShellProps) {
  const activeRoom = state.rooms.find((room) => room.id === state.activeRoomId);
  const roomId = activeRoom?.id;
  const messages = roomId
    ? mergeChatTimeline(state.messagesByRoom[roomId] ?? [], state.activityByRoom[roomId] ?? [])
    : [];
  const shellHeight = Math.max(height ?? process.stdout.rows ?? 24, 12);
  const terminalWidth = width ?? process.stdout.columns ?? 80;
  const watchlist = buildWatchlistTable(selectWatchlistQuotes(state, roomId));
  const memberGrid = layoutMemberGrid(selectMembers(state, roomId, currentUserId, currentUserActive), terminalWidth);
  const topHeight = showPanel
    ? topPanelHeight({ watchlist, memberGrid, showStocks: true, showMembers: true })
    : 0;
  const statusHeight = getStatusHeight(statusText);
  // The composer is 2 border rows plus one row per input line, so multiline
  // input grows the bottom region (and shrinks the chat) instead of overflowing.
  const inputLines = input.split('\n').length;
  // The color picker pops up just above the input composer; reserve its height
  // in the bottom region so the chat shrinks rather than overflowing.
  const pickerHeight = colorPickerOpen ? colorPickerHeight(terminalWidth) : 0;
  // The reorder panel is a vertical list: one row per stock plus 4 rows of
  // chrome (top+bottom border, title, hint).
  const reorderHeight = watchReorderOpen ? reorderItems.length + 4 : 0;
  const mentionHeight = mentionOpen ? mentionMembers.length + 4 : 0;
  const replyBannerHeight = replyTarget ? 1 : 0;
  const bottomHeight =
    statusHeight + 3 + inputLines + pickerHeight + reorderHeight + mentionHeight + replyBannerHeight;
  // Highlight @<name> tokens (any room member) and mark messages that mention me.
  // Reuse the member list already computed for the picker rather than re-deriving.
  const mentionContext: MentionContext = {
    memberNames: mentionMembers.map((member) => member.displayName ?? member.userId),
    selfName
  };
  const chatHeight = Math.max(shellHeight - topHeight - bottomHeight, 4);

  // The chat scrolls by pre-wrapped line, so the ceiling depends on the real
  // wrapped line count, not the message count. Report it up so the offset stays
  // clamped, and derive how many rows are currently hidden below the viewport.
  const totalLines = buildRenderLines(messages, terminalWidth, !!showTimestamps, mentionContext).length;
  const maxOffset = Math.max(0, totalLines - chatHeight);
  const hiddenBelow = Math.min(Math.max(0, scrollOffset), maxOffset);
  if (maxOffsetRef) {
    maxOffsetRef.current = maxOffset;
  }

  if (resolveShellView(state) === 'welcome') {
    const welcomeHeight = Math.max(shellHeight - statusHeight - 2 - inputLines - pickerHeight, 4);

    return (
      <Box flexDirection="column" height={shellHeight}>
        {WelcomeScreen({ userLabel, height: welcomeHeight })}
        <Box flexDirection="column" flexShrink={0}>
          {colorPickerOpen ? (
            <ColorPicker index={pickerIndex} terminalWidth={terminalWidth} currentColor={pickerCurrentColor} />
          ) : null}
          <StatusText text={statusText} busy={busy} busyTick={busyTick} busyElapsed={busyElapsed} />
          <InputComposer
            promptLabel={promptLabel}
            input={input}
            cursor={cursor}
            cursorVisible={cursorVisible}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={shellHeight}>
      {showPanel
        ? TopInfoPanel({
            state,
            userLabel,
            userRole,
            currentUserId,
            currentUserActive,
            terminalWidth,
            height: topHeight
          })
        : null}
      {MessageViewport({
        messages,
        width: terminalWidth,
        height: chatHeight,
        scrollOffset,
        showTimestamps,
        mentionContext,
        topRow: topHeight,
        clickMapRef
      })}
      <Box flexDirection="column" height={bottomHeight} flexShrink={0}>
        {colorPickerOpen ? (
          <ColorPicker index={pickerIndex} terminalWidth={terminalWidth} currentColor={pickerCurrentColor} />
        ) : null}
        {watchReorderOpen ? (
          <WatchReorder items={reorderItems} index={reorderIndex} grabbed={reorderGrabbed} />
        ) : null}
        {mentionOpen ? (
          <MentionPicker members={mentionMembers} index={mentionIndex} />
        ) : null}
        {replyTarget ? (
          <Text dimColor>
            ↳ Replying to {replyTarget.name}: {replyTarget.snippet}  (Esc to cancel)
          </Text>
        ) : null}
        <StatusText text={statusText} busy={busy} busyTick={busyTick} busyElapsed={busyElapsed} />
        <InputComposer
          promptLabel={promptLabel}
          input={input}
          cursor={cursor}
          cursorVisible={cursorVisible}
        />
        <StatusBar
          state={state}
          userLabel={userLabel}
          userRole={userRole}
          scrolledLines={hiddenBelow}
        />
      </Box>
    </Box>
  );
}

export type WelcomeScreenProps = {
  userLabel?: string;
  height: number;
};

export function WelcomeScreen({ userLabel, height }: WelcomeScreenProps) {
  return (
    <Box
      flexDirection="column"
      height={height}
      flexGrow={1}
      overflow="hidden"
      paddingX={2}
      paddingTop={1}
    >
      <Text bold color="cyan">
        HyChat
      </Text>
      <Text> </Text>
      {buildWelcomeLines(userLabel).map((line, index) => (
        <Text key={`${index}:${line}`} dimColor={line.startsWith('Type ')}>
          {line === '' ? ' ' : line}
        </Text>
      ))}
    </Box>
  );
}

// Pulls a room's watched symbols + their latest quotes into the pure table
// builder's input shape. Shared by AppShell (to size the header) and
// TopInfoPanel (to render it).
function selectWatchlistQuotes(
  state: AppState,
  roomId: string | undefined
): WatchlistQuote[] {
  if (!roomId) {
    return [];
  }
  const symbols = state.watchlistByRoom[roomId] ?? [];
  return symbols.map((symbol) => {
    const quote = state.quotesBySymbol[symbol];
    return {
      symbol,
      name: quote?.name,
      price: quote?.price,
      changePercent: quote?.changePercent
    };
  });
}

// Projects a room's persistent members onto live presence/typing. Shared by
// AppShell (to size the header) and TopInfoPanel (to render it).
function selectMembers(
  state: AppState,
  roomId: string | undefined,
  currentUserId: string | undefined,
  currentUserActive: boolean | undefined
): MemberView[] {
  if (!roomId) {
    return [];
  }
  return computeMemberStatuses(
    state.membersByRoom[roomId] ?? [],
    state.onlineByRoom[roomId] ?? [],
    state.activeByRoom[roomId] ?? [],
    state.typingByRoom[roomId] ?? [],
    { currentUserId, currentUserActive }
  );
}

export type TopPanelHeightInput = {
  watchlist: WatchlistTable;
  memberGrid: MemberGridLayout;
  showStocks: boolean;
  showMembers: boolean;
};

// Header box height = border (2) + title (1) + member lines + stock lines.
// Each section collapses to 0 lines when hidden. The members section is one
// "Members: -" line when empty, otherwise a "Members" label plus one line per
// grid row. The stocks section is one "Stocks: -" line when empty, otherwise a
// "Stocks" label plus one line per visible row plus an optional "+N more" line.
function topPanelHeight({
  watchlist,
  memberGrid,
  showStocks,
  showMembers
}: TopPanelHeightInput): number {
  const memberCount = memberGrid.rows.reduce((sum, row) => sum + row.length, 0);
  const memberLines = !showMembers ? 0 : memberCount === 0 ? 1 : 1 + memberGrid.rows.length;
  const stockLines = !showStocks
    ? 0
    : watchlist.rows.length === 0
      ? 1
      : 1 + watchlist.rows.length + (watchlist.hiddenCount > 0 ? 1 : 0);
  return 3 + memberLines + stockLines;
}

function directionColor(direction: WatchlistDirection): 'green' | 'red' | undefined {
  if (direction === 'up') {
    return 'green';
  }
  if (direction === 'down') {
    return 'red';
  }
  return undefined;
}

export type TopInfoPanelProps = {
  state: AppState;
  userLabel?: string;
  userRole?: string;
  currentUserId?: string;
  currentUserActive?: boolean;
  showStocks?: boolean;
  showMembers?: boolean;
  terminalWidth?: number;
  height?: number;
};

// ● focused tab, ◉ connected but unfocused, ○ disconnected/offline. The trio is
// weight-matched on purpose — the half-circle ◐ rendered larger than ●/○ in
// many fonts and looked uneven in the column.
function memberDot(status: MemberView['status']): string {
  return status === 'active' ? '●' : status === 'online' ? '◉' : '○';
}

// Cap a single member cell so one long name can't stretch the whole grid.
const maxMemberCellWidth = 24;

export type ColorPickerProps = {
  index: number;
  terminalWidth?: number;
  currentColor?: string;
};

export function ColorPicker({
  index,
  terminalWidth = process.stdout.columns ?? 80,
  currentColor
}: ColorPickerProps) {
  const names = pickerColorNames();
  const columns = colorPickerColumns(terminalWidth);
  const rows = pickerGridRows(
    names.map((name, cellIndex) => ({ name, cellIndex })),
    columns
  );

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>Pick a color</Text>
      <Text dimColor>↑↓←→ to move · Enter to select · Esc to cancel</Text>
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex}>
          {row.map((cell) => {
            const selected = cell.cellIndex === index;
            const isDefault = cell.name === DEFAULT_PROFILE_COLOR;
            const label = isDefault ? 'default' : cell.name;
            const current = cell.name === currentColor ? '*' : ' ';
            return (
              <Box key={cell.name} width={12} flexShrink={0}>
                <Text
                  color={isDefault ? undefined : resolveProfileColor(cell.name)}
                  inverse={selected}
                  bold={selected}
                >
                  {selected ? '▸' : ' '}
                  {current}
                  {label}
                </Text>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

export type WatchReorderProps = {
  items: WatchlistQuote[];
  index: number;
  grabbed: boolean;
};

export function WatchReorder({ items, index, grabbed }: WatchReorderProps) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>Reorder watchlist</Text>
      <Text dimColor>↑↓ move · Space grab/drop · Enter save · Esc cancel</Text>
      {items.map((item, rowIndex) => {
        const selected = rowIndex === index;
        const isGrabbed = selected && grabbed;
        const marker = isGrabbed ? '»' : selected ? '▸' : ' ';
        const label = item.name?.trim() || item.symbol;
        return (
          <Box key={item.symbol}>
            <Text inverse={selected} bold={selected} color={isGrabbed ? 'cyanBright' : undefined}>
              {marker} {label}  {item.symbol}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export type MentionPickerProps = {
  members: MemberView[];
  index: number;
};

export function MentionPicker({ members, index }: MentionPickerProps) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>Mention someone</Text>
      <Text dimColor>↑↓ to move · Enter to insert · Esc to cancel</Text>
      {members.map((member, rowIndex) => {
        const selected = rowIndex === index;
        const name = member.displayName ?? member.userId;
        return (
          <Box key={member.userId}>
            <Text
              color={selected ? undefined : resolveProfileColor(member.displayColor)}
              inverse={selected}
              bold={selected}
            >
              {selected ? '▸' : ' '} @{name}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function TopInfoPanel({
  state,
  userLabel,
  userRole,
  currentUserId,
  currentUserActive,
  showStocks = true,
  showMembers = true,
  terminalWidth = process.stdout.columns ?? 80,
  height
}: TopInfoPanelProps) {
  const activeRoom = state.rooms.find((room) => room.id === state.activeRoomId);
  const roomId = activeRoom?.id;
  const connectionView = describeConnectionStatus(state.connectionStatus);
  const members = selectMembers(state, roomId, currentUserId, currentUserActive);
  const memberGrid = layoutMemberGrid(members, terminalWidth);
  // One shared cell width keeps every grid column aligned across rows.
  const memberCellWidth = Math.min(
    Math.max(0, ...members.map((member) => stringWidth(`${memberDot(member.status)} ${member.displayName ?? member.userId}`))),
    maxMemberCellWidth
  );
  const watchlist = buildWatchlistTable(selectWatchlistQuotes(state, roomId));

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      height={height}
      flexShrink={0}
    >
      <Text bold>
        HyChat {activeRoom ? `# ${activeRoom.name}` : 'No room'}{' '}
        <Text dimColor>
          {userLabel ?? '-'} {userRole ?? '-'}{' '}
        </Text>
        <Text
          color={connectionView.color}
          dimColor={connectionView.dim}
          bold={connectionView.bold}
        >
          {connectionView.label}
        </Text>
      </Text>
      {!showMembers ? null : members.length === 0 ? (
        <Text>Members: -</Text>
      ) : (
        <Box flexDirection="column">
          <Text>Members</Text>
          {memberGrid.rows.map((row, rowIndex) => (
            <Box key={rowIndex} paddingLeft={2}>
              {row.map((member) => {
                const offline = member.status === 'offline';
                const accent = offline ? undefined : resolveProfileColor(member.displayColor);
                return (
                  <Box key={member.userId} width={memberCellWidth} flexShrink={0} marginRight={2}>
                    {/* Name shrinks to make room for the typing mark INSIDE the
                        fixed cell width, so a typing member can't overflow the
                        cell and wrap the whole grid (the mark's emoji width is
                        absorbed automatically rather than guessed). */}
                    <Box flexShrink={1} minWidth={0}>
                      <Text color={accent} dimColor={offline} wrap="truncate">
                        {memberDot(member.status)} {member.displayName ?? member.userId}
                      </Text>
                    </Box>
                    {member.typing ? (
                      <Box flexShrink={0}>
                        <Text color="cyanBright"> ✎</Text>
                      </Box>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      )}
      {!showStocks ? null : watchlist.rows.length === 0 ? (
        <Text>Stocks: -</Text>
      ) : (
        <Box flexDirection="column">
          <Text>Stocks</Text>
          {watchlist.rows.map((row) => (
            <Box key={row.key} paddingLeft={2}>
              <Box width={watchlist.labelWidth} flexShrink={0} marginRight={2}>
                <Text wrap="truncate">{row.label}</Text>
              </Box>
              <Box width={watchlist.symbolWidth} flexShrink={0} marginRight={2}>
                <Text dimColor>{row.symbol}</Text>
              </Box>
              <Box
                width={watchlist.priceWidth}
                flexShrink={0}
                marginRight={2}
                justifyContent="flex-end"
              >
                <Text dimColor>{row.price}</Text>
              </Box>
              <Box width={watchlist.percentWidth} flexShrink={0} justifyContent="flex-end">
                <Text color={directionColor(row.direction)}>{row.percent}</Text>
              </Box>
            </Box>
          ))}
          {watchlist.hiddenCount > 0 ? (
            <Text dimColor>{`  +${watchlist.hiddenCount} more`}</Text>
          ) : null}
        </Box>
      )}
    </Box>
  );
}

export type MessageViewportProps = {
  messages: NonNullable<AppState['messagesByRoom'][string]>;
  width?: number;
  scrollOffset?: number;
  showTimestamps?: boolean;
  height: number;
  mentionContext?: MentionContext;
  // 0-based screen row of the viewport's first line; with clickMapRef it lets a
  // mouse click map a screen row back to the message rendered there.
  topRow?: number;
  clickMapRef?: { current: Map<number, string> };
};

// Split a row body into plain / `@<name>` segments. A mention of me renders as a
// light-background pill; mentions of others are just font-colored.
function renderMentionBody(
  body: string,
  spans: MentionSpan[] | undefined,
  selfName?: string
): React.ReactNode {
  if (!spans || spans.length === 0) {
    return body;
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, index) => {
    if (span.start > cursor) {
      parts.push(body.slice(cursor, span.start));
    }
    const token = body.slice(span.start, span.end);
    const isMe = selfName !== undefined && span.name === selfName;
    parts.push(
      isMe ? (
        <Text key={index} backgroundColor="#3b5b8c" color="whiteBright">
          {token}
        </Text>
      ) : (
        <Text key={index} color="cyan">
          {token}
        </Text>
      )
    );
    cursor = span.end;
  });
  if (cursor < body.length) {
    parts.push(body.slice(cursor));
  }
  return parts;
}

export function MessageViewport({
  messages,
  width,
  scrollOffset = 0,
  height,
  showTimestamps,
  mentionContext,
  topRow = 0,
  clickMapRef
}: MessageViewportProps) {
  const innerWidth = width ?? process.stdout.columns ?? 80;
  // Pre-wrap to one row per line, then slice the window so older history is
  // reachable by scrolling instead of being dropped off the top.
  const allLines = buildRenderLines(messages, innerWidth, !!showTimestamps, mentionContext);
  const { lines } = sliceWindow(allLines, height, scrollOffset);

  // Record which message sits on each visible screen row (1-based, as the
  // terminal reports clicks) so a double-click can find the message it hit.
  if (clickMapRef) {
    clickMapRef.current = new Map();
    lines.forEach((line, index) => {
      if (line.messageId) {
        clickMapRef.current.set(topRow + index + 1, line.messageId);
      }
    });
  }

  return (
    <Box flexDirection="column" height={height} flexGrow={1} overflow="hidden">
      {lines.length === 0 ? (
        <Text dimColor>No messages</Text>
      ) : (
        lines.map((line, index) =>
          line.kind === 'system' ? (
            // Room-activity note (joined/left/watchlist change): centered + dim.
            <Box key={index} justifyContent="center">
              <Text dimColor>
                {line.timestamp ?? ''}
                {line.text}
              </Text>
            </Box>
          ) : line.kind === 'reply' ? (
            // Quote row of a reply: a "▎ " bar in the replier's profile color
            // (so stacked replies don't blur into one gray bar), then the dim
            // quote text right after it (no `name:` colon, so it isn't a re-sent
            // line). The body row below shares the same bar.
            <Box key={index} flexDirection="row">
              <Text color={resolveProfileColor(line.senderColor)}>▎ </Text>
              <Text dimColor>
                {line.replyQuote?.name} {line.replyQuote?.snippet}
              </Text>
            </Box>
          ) : (
            <Box key={index} flexDirection="row">
              {/* Reply body rows share the same colored "▎ " bar; text right after. */}
              {line.replyBar ? (
                <Text color={resolveProfileColor(line.senderColor)}>▎ </Text>
              ) : null}
              {line.timestamp ? (
                <Text color="gray" dimColor>
                  {line.timestamp}
                </Text>
              ) : null}
              {line.senderLabel ? (
                <Text color={resolveProfileColor(line.senderColor)}>{line.senderLabel} </Text>
              ) : null}
              <Text>{renderMentionBody(line.body ?? '', line.mentions, mentionContext?.selfName)}</Text>
            </Box>
          )
        )
      )}
    </Box>
  );
}

export type StatusTextProps = {
  text: string;
  busy?: boolean;
  busyTick?: number;
  busyElapsed?: string;
};

export function StatusText({ text, busy, busyTick, busyElapsed }: StatusTextProps) {
  if (busy) {
    const tick = busyTick ?? 0;
    return (
      <Box height={1} overflow="hidden" flexShrink={0}>
        <Text>
          <Text color={loadingColor}>{spinnerFrame(tick)} </Text>
          {buildShimmerSegments(text.split('\n')[0], tick).map((segment, index) => (
            <Text key={`${index}:${segment.text}`} color={loadingColor} dimColor={!segment.bright}>
              {segment.text}
            </Text>
          ))}
          {busyElapsed ? <Text dimColor> {busyElapsed}</Text> : null}
        </Text>
      </Box>
    );
  }

  const lines = text.split('\n').slice(0, getStatusHeight(text));
  return (
    <Box flexDirection="column" height={lines.length} overflow="hidden" flexShrink={0}>
      {lines.map((line, index) => (
        <Text key={`${index}:${line}`} dimColor>
          {line}
        </Text>
      ))}
    </Box>
  );
}

export type StatusBarProps = {
  state: AppState;
  userLabel?: string;
  userRole?: string;
  scrolledLines?: number;
};

// Bottom bar is just identity + room + connection. Members and stocks live in
// the top panel, so they are intentionally not repeated here. When the history
// is scrolled up, it also shows how to jump back to the latest.
export function StatusBar({ state, userLabel, userRole, scrolledLines = 0 }: StatusBarProps) {
  const activeRoom = state.rooms.find((room) => room.id === state.activeRoomId);
  const connection = describeConnectionStatus(state.connectionStatus);

  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text dimColor>
        {userLabel ?? '-'} {userRole ?? '-'} | room {activeRoom?.name ?? '-'} |{' '}
      </Text>
      <Text color={connection.color} dimColor={connection.dim} bold={connection.bold}>
        {connection.label}
      </Text>
      {scrolledLines > 0 ? (
        <Text color="yellow"> ↑ {scrolledLines} more · PageDown/Enter for latest</Text>
      ) : null}
    </Box>
  );
}

export type InputComposerProps = {
  promptLabel: string;
  input: string;
  cursor?: number;
  cursorVisible: boolean;
};

export function InputComposer({ promptLabel, input, cursor, cursorVisible }: InputComposerProps) {
  const chars = [...input];
  const caret = Math.max(0, Math.min(cursor ?? chars.length, chars.length));
  const lines = splitCharLines(chars);
  const { line: caretLine, column: caretColumn } = locateCaret(lines, caret);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} flexShrink={0}>
      {lines.map((lineChars, index) => {
        // First line carries the prompt; continuation lines align under it.
        const prefix = index === 0 ? `${promptLabel} ` : '  ';
        const hasCaret = index === caretLine;
        const before = hasCaret ? lineChars.slice(0, caretColumn).join('') : lineChars.join('');
        const atChar = hasCaret
          ? caretColumn < lineChars.length
            ? lineChars[caretColumn]
            : ' '
          : '';
        const after = hasCaret ? lineChars.slice(caretColumn + 1).join('') : '';

        return (
          <Text key={index}>
            <Text color="cyan">{prefix}</Text>
            {before}
            {hasCaret ? <Text inverse={cursorVisible}>{atChar}</Text> : null}
            {after}
          </Text>
        );
      })}
    </Box>
  );
}

/** Split a code-point array into per-line code-point arrays on '\n'. */
function splitCharLines(chars: string[]): string[][] {
  const lines: string[][] = [[]];
  for (const char of chars) {
    if (char === '\n') {
      lines.push([]);
    } else {
      lines[lines.length - 1]!.push(char);
    }
  }
  return lines;
}

/** Map a code-point caret index to its (line, column) across split lines. */
function locateCaret(lines: string[][], caret: number): { line: number; column: number } {
  let remaining = caret;
  for (let line = 0; line < lines.length; line += 1) {
    if (remaining <= lines[line]!.length) {
      return { line, column: remaining };
    }
    remaining -= lines[line]!.length + 1; // +1 for the newline
  }
  const last = lines.length - 1;
  return { line: last, column: lines[last]!.length };
}

type InputKey = Parameters<Parameters<typeof useInput>[0]>[1];

/**
 * True when the keypress is Ctrl+S, which shows/hides the whole top panel.
 * Ctrl+M is intentionally avoided — it is the same byte (CR) as Enter and can't
 * be told apart from submit.
 */
export function isPanelToggle(value: string, key: InputKey): boolean {
  return Boolean(key.ctrl) && value === 's';
}

// PageUp/PageDown move a screenful of chat rows at a time.
function scrollPage(): number {
  return Math.max(1, (process.stdout.rows ?? 24) - 8);
}

/**
 * Translate a keypress into a pure editor action (readline/Emacs conventions).
 * Returns undefined for keys the composer ignores. `key.return` is handled by
 * the caller (it submits rather than edits). Terminals can't report Cmd, so
 * Ctrl/Option stand in; Mac Backspace/Delete both delete the char before the
 * cursor since they're indistinguishable from forward-delete here.
 */
export function resolveEditorAction(value: string, key: InputKey): EditorAction | undefined {
  if (key.tab) {
    // Shift+Tab inserts a newline; a plain Tab is ignored.
    return key.shift ? { type: 'newline' } : undefined;
  }

  if (key.leftArrow) {
    return { type: key.meta ? 'moveWordLeft' : 'moveLeft' };
  }
  if (key.rightArrow) {
    return { type: key.meta ? 'moveWordRight' : 'moveRight' };
  }
  if (key.upArrow) {
    return { type: 'moveUp' };
  }
  if (key.downArrow) {
    return { type: 'moveDown' };
  }
  if (key.home) {
    return { type: 'moveLineStart' };
  }
  if (key.end) {
    return { type: 'moveLineEnd' };
  }

  if (key.backspace || key.delete) {
    return { type: key.meta ? 'deleteWordBack' : 'backspace' };
  }

  if (key.ctrl) {
    switch (value) {
      case 'a':
        return { type: 'moveLineStart' };
      case 'e':
        return { type: 'moveLineEnd' };
      case 'b':
        return { type: 'moveLeft' };
      case 'f':
        return { type: 'moveRight' };
      case 'u':
        return { type: 'killToLineStart' };
      case 'k':
        return { type: 'killToLineEnd' };
      case 'w':
        return { type: 'deleteWordBack' };
      case 'd':
        return { type: 'deleteForward' };
      default:
        return undefined;
    }
  }

  if (key.meta || !value) {
    return undefined;
  }

  return { type: 'insert', text: value };
}


function getStatusHeight(text: string): number {
  return Math.min(Math.max(text.split('\n').length, 1), 8);
}
