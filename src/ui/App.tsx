import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import {
  createChatSession,
  type ChatSessionSnapshot,
  type CreateChatSessionOptions
} from '../app/chat-session.js';
import { resolveProfileColor } from '../app/profile-colors.js';
import {
  formatQuoteChangePercent,
  formatQuotePrice,
  quoteChangeColor
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
import type { AppState, MemberView } from './state.js';
import {
  buildWelcomeLines,
  computeMemberStatuses,
  createInitialAppState,
  formatActivityLine,
  formatBeijingTime,
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
      height={terminalRows}
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
  height?: number;
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
  height
}: AppShellProps) {
  const activeRoom = state.rooms.find((room) => room.id === state.activeRoomId);
  const roomId = activeRoom?.id;
  const messages = roomId
    ? mergeChatTimeline(state.messagesByRoom[roomId] ?? [], state.activityByRoom[roomId] ?? [])
    : [];
  const shellHeight = Math.max(height ?? process.stdout.rows ?? 24, 12);
  const topHeight = 5;
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
      {TopInfoPanel({ state, userLabel, userRole, currentUserId, currentUserActive, height: topHeight })}
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

export type TopInfoPanelProps = {
  state: AppState;
  userLabel?: string;
  userRole?: string;
  currentUserId?: string;
  currentUserActive?: boolean;
  height?: number;
};

export function TopInfoPanel({
  state,
  userLabel,
  userRole,
  currentUserId,
  currentUserActive,
  height
}: TopInfoPanelProps) {
  const activeRoom = state.rooms.find((room) => room.id === state.activeRoomId);
  const roomId = activeRoom?.id;
  const members = roomId
    ? computeMemberStatuses(
        state.membersByRoom[roomId] ?? [],
        state.onlineByRoom[roomId] ?? [],
        state.activeByRoom[roomId] ?? [],
        state.typingByRoom[roomId] ?? [],
        { currentUserId, currentUserActive }
      )
    : [];
  const visibleMembers = members.slice(0, 3);
  const hiddenMemberCount = members.length - visibleMembers.length;
  const symbols = roomId ? state.watchlistByRoom[roomId] ?? [] : [];

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
      <Text>
        Members:{' '}
        {members.length > 0 ? (
          <>
            {visibleMembers.map((member, index) => {
              const offline = member.status === 'offline';
              // ● focused tab, ◐ connected but unfocused, ○ disconnected.
              const dot = member.status === 'active' ? '●' : member.status === 'online' ? '◐' : '○';
              const accent = offline ? undefined : resolveProfileColor(member.displayColor);
              return (
                <React.Fragment key={member.userId}>
                  {index > 0 ? <Text>{'  '}</Text> : null}
                  <Text color={accent} dimColor={offline}>
                    {dot}{' '}
                  </Text>
                  <Text color={accent} dimColor={offline}>
                    {member.displayName ?? member.userId}
                  </Text>
                  {member.typing ? <Text color="cyanBright"> ✎</Text> : null}
                </React.Fragment>
              );
            })}
            {hiddenMemberCount > 0 ? <Text dimColor> +{hiddenMemberCount} more</Text> : null}
          </>
        ) : (
          '-'
        )}
      </Text>
      <Text>
        Stocks:{' '}
        {symbols.length > 0 ? (
          symbols.map((symbol, index) => {
            const quote = state.quotesBySymbol[symbol];
            return (
              <React.Fragment key={symbol}>
                {index > 0 ? <Text dimColor> | </Text> : null}
                <Text>
                  {symbol} {formatQuotePrice(quote?.price)}{' '}
                </Text>
                <Text color={quoteChangeColor(quote?.changePercent)}>
                  {formatQuoteChangePercent(quote?.changePercent)}
                </Text>
              </React.Fragment>
            );
          })
        ) : (
          '-'
        )}
      </Text>
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
