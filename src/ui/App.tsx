import React, { useEffect, useMemo, useState } from 'react';
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
  formatActivityLine,
  formatBeijingTime,
  layoutMemberGrid,
  mergeChatTimeline,
  resolveShellView
} from './state.js';
import { isFocusEventOnly, watchTerminalFocus } from './terminal-focus.js';

export type AppProps = {
  state?: AppState;
  service?: CreateChatSessionOptions['service'];
  realtime?: CreateChatSessionOptions['realtime'];
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

export function App({ state: fixedState, service, realtime }: AppProps) {
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
            onSnapshotChange: setSnapshot
          })
        : undefined,
    [service, realtime]
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
  const [showStocks, setShowStocks] = useState(true);
  const [showMembers, setShowMembers] = useState(true);

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

    // Ctrl+S / Ctrl+P show/hide the Stocks / Members sections of the top panel.
    // (Ctrl+M is unusable here — it is the same byte as Enter.)
    const toggle = resolveTopPanelToggle(value, key);
    if (toggle === 'stocks') {
      setShowStocks((current) => !current);
      return;
    }
    if (toggle === 'members') {
      setShowMembers((current) => !current);
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
      showStocks={showStocks}
      showMembers={showMembers}
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
  showStocks?: boolean;
  showMembers?: boolean;
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
  showStocks = true,
  showMembers = true,
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
  const topHeight = topPanelHeight({ watchlist, memberGrid, showStocks, showMembers });
  const statusHeight = getStatusHeight(statusText);
  // The composer is 2 border rows plus one row per input line, so multiline
  // input grows the bottom region (and shrinks the chat) instead of overflowing.
  const inputLines = input.split('\n').length;
  const bottomHeight = statusHeight + 3 + inputLines;
  const chatHeight = Math.max(shellHeight - topHeight - bottomHeight, 4);

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
      {TopInfoPanel({
        state,
        userLabel,
        userRole,
        currentUserId,
        currentUserActive,
        showStocks,
        showMembers,
        terminalWidth,
        height: topHeight
      })}
      {MessageViewport({
        messages: messages.slice(-chatHeight),
        height: chatHeight,
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
        <StatusBar state={state} userLabel={userLabel} userRole={userRole} />
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

// ● focused tab, ◐ connected but unfocused, ○ disconnected/offline.
function memberDot(status: MemberView['status']): string {
  return status === 'active' ? '●' : status === 'online' ? '◐' : '○';
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
          {userLabel ?? '-'} {userRole ?? '-'} {state.connectionStatus}
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
                    <Text color={accent} dimColor={offline} wrap="truncate">
                      {memberDot(member.status)} {member.displayName ?? member.userId}
                    </Text>
                    {member.typing ? <Text color="cyanBright"> ✎</Text> : null}
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
  showTimestamps?: boolean;
  height: number;
};

export function MessageViewport({ messages, height, showTimestamps }: MessageViewportProps) {
  return (
    <Box flexDirection="column" height={height} flexGrow={1} overflow="hidden">
      {messages.length === 0 ? (
        <Text dimColor>No messages</Text>
      ) : (
        messages.map((message) => (
          <Box
            key={message.id}
            flexDirection="row"
            // Room-activity notes sit centered, set apart from left-aligned chat.
            justifyContent={message.kind === 'system' ? 'center' : 'flex-start'}
          >
            {showTimestamps && (
              <Text color="gray" dimColor>
                {formatBeijingTime(message.createdAt)}{' '}
              </Text>
            )}
            {message.kind === 'system' ? (
              // Room-activity line (joined/left/watchlist change): a dim note,
              // visually distinct from chat. See formatActivityLine.
              <Text dimColor>· {formatActivityLine(message)}</Text>
            ) : (
              <>
                <Text color={resolveProfileColor(message.senderColor)}>
                  {message.senderName ?? message.senderId}:
                </Text>
                <Text> {message.body}</Text>
              </>
            )}
          </Box>
        ))
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
};

// Bottom bar is just identity + room + connection. Members and stocks live in
// the top panel, so they are intentionally not repeated here.
export function StatusBar({ state, userLabel, userRole }: StatusBarProps) {
  const activeRoom = state.rooms.find((room) => room.id === state.activeRoomId);

  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text dimColor>
        {userLabel ?? '-'} {userRole ?? '-'} | room {activeRoom?.name ?? '-'} |{' '}
        {state.connectionStatus}
      </Text>
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
 * Map a keypress to a top-panel section toggle: Ctrl+S → stocks, Ctrl+P →
 * members. Returns undefined for everything else. Ctrl+M is intentionally not
 * used — it is the same byte (CR) as Enter and can't be told apart from submit.
 */
export function resolveTopPanelToggle(
  value: string,
  key: InputKey
): 'stocks' | 'members' | undefined {
  if (!key.ctrl) {
    return undefined;
  }
  if (value === 's') {
    return 'stocks';
  }
  if (value === 'p') {
    return 'members';
  }
  return undefined;
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
