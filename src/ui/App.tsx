import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import {
  createChatSession,
  type ChatSessionSnapshot,
  type CreateChatSessionOptions
} from '../app/chat-session.js';
import { resolveProfileColor } from '../app/profile-colors.js';
import type { AppState } from './state.js';
import { createInitialAppState } from './state.js';

export type AppProps = {
  state?: AppState;
  service?: CreateChatSessionOptions['service'];
  realtime?: CreateChatSessionOptions['realtime'];
  defaultDisplayName?: string;
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

export function App({ state: fixedState, service, realtime, defaultDisplayName }: AppProps) {
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
            onSnapshotChange: setSnapshot
          })
        : undefined,
    [service, realtime, defaultDisplayName]
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
  const topHeight = roomId ? 5 : 3;
  const bottomHeight = 5;
  const chatHeight = Math.max(shellHeight - topHeight - bottomHeight, 4);

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
        {members.length > 0
          ? members.map((member) => member.displayName ?? member.userId).join(', ')
          : '-'}
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
  const firstLine = text.split('\n')[0] ?? '';
  return (
    <Box height={1} overflow="hidden" flexShrink={0}>
      <Text dimColor>{firstLine}</Text>
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
