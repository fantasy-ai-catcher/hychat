import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import stringWidth from 'string-width';

import {
  createChatSession,
  type ChatSessionSnapshot,
  type CreateChatSessionOptions
} from '../app/chat-session.js';
import { resolveProfileColor } from '../app/profile-colors.js';
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
import { buildRenderLines, sliceWindow } from './scroll.js';
import { isFocusEventOnly, watchTerminalFocus } from './terminal-focus.js';
import { isMouseSequence, watchTerminalMouse } from './terminal-mouse.js';

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
    shouldExit: false
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
    return watchTerminalMouse((direction) => {
      if (direction === 'up') {
        scrollUp(WHEEL_STEP);
      } else {
        scrollDown(WHEEL_STEP);
      }
    });
  }, []);

  // Jump back to the latest when switching rooms.
  const activeRoomId = (fixedState ?? snapshot.state).activeRoomId;
  useEffect(() => {
    setScrollOffset(0);
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

  async function submitLine(line: string): Promise<void> {
    if (!session) {
      return;
    }

    const trimmed = line.trim();

    if (trimmed === '') {
      setSnapshot(await session.handleLine(line));
      return;
    }

    setSnapshot(await session.handleLine(line));
  }

  useInput((value, key) => {
    if (key.ctrl && value === 'c') {
      exit();
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
  width
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
  const bottomHeight = statusHeight + 3 + inputLines;
  const chatHeight = Math.max(shellHeight - topHeight - bottomHeight, 4);

  // The chat scrolls by pre-wrapped line, so the ceiling depends on the real
  // wrapped line count, not the message count. Report it up so the offset stays
  // clamped, and derive how many rows are currently hidden below the viewport.
  const totalLines = buildRenderLines(messages, terminalWidth, !!showTimestamps).length;
  const maxOffset = Math.max(0, totalLines - chatHeight);
  const hiddenBelow = Math.min(Math.max(0, scrollOffset), maxOffset);
  if (maxOffsetRef) {
    maxOffsetRef.current = maxOffset;
  }

  if (resolveShellView(state) === 'welcome') {
    const welcomeHeight = Math.max(shellHeight - statusHeight - 2 - inputLines, 4);

    return (
      <Box flexDirection="column" height={shellHeight}>
        {WelcomeScreen({ userLabel, height: welcomeHeight })}
        <Box flexDirection="column" flexShrink={0}>
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
        showTimestamps
      })}
      <Box flexDirection="column" height={bottomHeight} flexShrink={0}>
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
};

export function MessageViewport({
  messages,
  width,
  scrollOffset = 0,
  height,
  showTimestamps
}: MessageViewportProps) {
  const innerWidth = width ?? process.stdout.columns ?? 80;
  // Pre-wrap to one row per line, then slice the window so older history is
  // reachable by scrolling instead of being dropped off the top.
  const allLines = buildRenderLines(messages, innerWidth, !!showTimestamps);
  const { lines } = sliceWindow(allLines, height, scrollOffset);

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
          ) : (
            <Box key={index} flexDirection="row">
              {line.timestamp ? (
                <Text color="gray" dimColor>
                  {line.timestamp}
                </Text>
              ) : null}
              {line.senderLabel ? (
                <Text color={resolveProfileColor(line.senderColor)}>{line.senderLabel} </Text>
              ) : null}
              <Text>{line.body}</Text>
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
