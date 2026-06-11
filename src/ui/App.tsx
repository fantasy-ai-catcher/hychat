import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import {
  createChatSession,
  type ChatSessionSnapshot,
  type CreateChatSessionOptions
} from '../app/chat-session.js';
import { resolveProfileColor } from '../app/profile-colors.js';
import type { AppState } from './state.js';
import { buildWelcomeLines, createInitialAppState, resolveShellView } from './state.js';

export type AppProps = {
  state?: AppState;
  service?: CreateChatSessionOptions['service'];
  realtime?: CreateChatSessionOptions['realtime'];
  defaultDisplayName?: string;
  autoStartDisplayName?: string;
  autoStartInviteCode?: string;
};

function createSnapshot(state: AppState): ChatSessionSnapshot {
  return {
    state,
    user: null,
    statusText: 'Use /start <nickname> [invite-code] to start.',
    helpLines: [],
    shouldExit: false
  };
}

export function App({
  state: fixedState,
  service,
  realtime,
  defaultDisplayName,
  autoStartDisplayName,
  autoStartInviteCode
}: AppProps) {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [cursorVisible, setCursorVisible] = useState(true);
  const [snapshot, setSnapshot] = useState<ChatSessionSnapshot>(() =>
    createSnapshot(fixedState ?? createInitialAppState())
  );
  const session = useMemo(
    () =>
      service
        ? createChatSession({
            service,
            realtime,
            defaultDisplayName,
            autoStartDisplayName,
            autoStartInviteCode,
            onSnapshotChange: setSnapshot
          })
        : undefined,
    [service, realtime, defaultDisplayName, autoStartDisplayName, autoStartInviteCode]
  );

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

    if (key.return) {
      const submitted = input;
      setInput('');
      void submitLine(submitted);
      return;
    }

    if (key.backspace || key.delete) {
      setInput((current) => current.slice(0, -1));
      return;
    }

    if (!key.ctrl && value) {
      setInput((current) => current + value);
    }
  });

  const activeState = fixedState ?? snapshot.state;
  const terminalRows = process.stdout.rows;

  return (
    <AppShell
      state={activeState}
      statusText={snapshot.statusText}
      userLabel={snapshot.user?.displayName}
      userRole={snapshot.user?.role}
      promptLabel=">"
      input={input}
      cursorVisible={cursorVisible}
      height={terminalRows}
    />
  );
}

type AppShellProps = {
  state: AppState;
  statusText: string;
  userLabel?: string;
  userRole?: string;
  promptLabel: string;
  input: string;
  cursorVisible: boolean;
  height?: number;
};

export function AppShell({
  state,
  statusText,
  userLabel,
  userRole,
  promptLabel,
  input,
  cursorVisible,
  height
}: AppShellProps) {
  const activeRoom = state.rooms.find((room) => room.id === state.activeRoomId);
  const roomId = activeRoom?.id;
  const messages = roomId ? state.messagesByRoom[roomId] ?? [] : [];
  const shellHeight = Math.max(height ?? process.stdout.rows ?? 24, 12);
  const topHeight = 5;
  const statusHeight = getStatusHeight(statusText);
  const bottomHeight = statusHeight + 4;
  const chatHeight = Math.max(shellHeight - topHeight - bottomHeight, 4);

  if (resolveShellView(state) === 'welcome') {
    const welcomeHeight = Math.max(shellHeight - statusHeight - 3, 4);

    return (
      <Box flexDirection="column" height={shellHeight}>
        {WelcomeScreen({ userLabel, height: welcomeHeight })}
        <Box flexDirection="column" flexShrink={0}>
          <StatusText text={statusText} />
          <InputComposer promptLabel={promptLabel} input={input} cursorVisible={cursorVisible} />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={shellHeight}>
      {TopInfoPanel({ state, userLabel, userRole, height: topHeight })}
      {MessageViewport({ messages: messages.slice(-chatHeight), height: chatHeight })}
      <Box flexDirection="column" height={bottomHeight} flexShrink={0}>
        <StatusText text={statusText} />
        <InputComposer promptLabel={promptLabel} input={input} cursorVisible={cursorVisible} />
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
  height?: number;
};

export function TopInfoPanel({ state, userLabel, userRole, height }: TopInfoPanelProps) {
  const activeRoom = state.rooms.find((room) => room.id === state.activeRoomId);
  const roomId = activeRoom?.id;
  const members = roomId ? state.membersByRoom[roomId] ?? [] : [];
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
            {visibleMembers.map((member, index) => (
              <React.Fragment key={member.userId}>
                {index > 0 ? <Text>, </Text> : null}
                <Text color={resolveProfileColor(member.displayColor)}>
                  {member.displayName ?? member.userId}
                </Text>
                <Text>
                  ({member.role}, {member.displayColor ?? 'white'})
                </Text>
              </React.Fragment>
            ))}
            {hiddenMemberCount > 0 ? <Text dimColor> +{hiddenMemberCount} more</Text> : null}
          </>
        ) : (
          '-'
        )}
      </Text>
      <Text>
        Stocks:{' '}
        {symbols.length > 0
          ? symbols
              .map((symbol) => {
                const quote = state.quotesBySymbol[symbol];
                const price = quote?.price === undefined ? '-' : quote.price;
                return `${symbol} ${price} ${formatQuoteChange(quote?.changePercent)}`;
              })
              .join(' | ')
          : '-'}
      </Text>
    </Box>
  );
}

export type MessageViewportProps = {
  messages: NonNullable<AppState['messagesByRoom'][string]>;
  height: number;
};

export function MessageViewport({ messages, height }: MessageViewportProps) {
  return (
    <Box flexDirection="column" height={height} flexGrow={1} overflow="hidden">
      {messages.length === 0 ? (
        <Text dimColor>No messages</Text>
      ) : (
        messages.map((message) => (
          <Box key={message.id} flexDirection="row">
            <Text color={resolveProfileColor(message.senderColor)}>
              {message.senderName ?? message.senderId}:
            </Text>
            <Text> {message.body}</Text>
          </Box>
        ))
      )}
    </Box>
  );
}

export function StatusText({ text }: { text: string }) {
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

export function StatusBar({ state, userLabel, userRole }: StatusBarProps) {
  const activeRoom = state.rooms.find((room) => room.id === state.activeRoomId);
  const roomId = activeRoom?.id;
  const members = roomId ? state.membersByRoom[roomId] ?? [] : [];
  const symbols = roomId ? state.watchlistByRoom[roomId] ?? [] : [];
  const memberSummary = summarizeItems(
    members.map((member) => member.displayName ?? member.userId),
    2
  );
  const stockSummary = summarizeItems(
    symbols.map((symbol) => {
      const quote = state.quotesBySymbol[symbol];
      return `${symbol} ${formatQuoteChange(quote?.changePercent)}`;
    }),
    1
  );

  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text dimColor>
        {userLabel ?? '-'} {userRole ?? '-'} | room {activeRoom?.name ?? '-'} |{' '}
        {state.connectionStatus} | members {memberSummary} | stocks {stockSummary}
      </Text>
    </Box>
  );
}

export type InputComposerProps = {
  promptLabel: string;
  input: string;
  cursorVisible: boolean;
};

export function InputComposer({ promptLabel, input, cursorVisible }: InputComposerProps) {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexShrink={0}>
      <Text color="cyan">{promptLabel}</Text>
      <Text> {input}</Text>
      <Text color="cyan">{cursorVisible ? '|' : ' '}</Text>
    </Box>
  );
}

function formatQuoteChange(changePercent: number | undefined): string {
  if (changePercent === undefined) {
    return '-';
  }

  return `${changePercent > 0 ? '+' : ''}${changePercent}%`;
}

function summarizeItems(items: string[], visibleCount: number): string {
  if (items.length === 0) {
    return '-';
  }

  const visible = items.slice(0, visibleCount).join(', ');
  const hiddenCount = items.length - visibleCount;
  return hiddenCount > 0 ? `${visible} +${hiddenCount}` : visible;
}

function getStatusHeight(text: string): number {
  return Math.min(Math.max(text.split('\n').length, 1), 8);
}
