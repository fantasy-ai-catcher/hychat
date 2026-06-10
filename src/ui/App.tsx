import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import {
  createChatSession,
  type ChatSessionSnapshot,
  type CreateChatSessionOptions
} from '../app/chat-session.js';
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

  return (
    <AppShell
      state={activeState}
      statusText={snapshot.statusText}
      userLabel={snapshot.user?.displayName}
      userRole={snapshot.user?.role}
      promptLabel=">"
      input={input}
      cursorVisible={cursorVisible}
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
};

function AppShell({
  state,
  statusText,
  userLabel,
  userRole,
  promptLabel,
  input,
  cursorVisible
}: AppShellProps) {
  const activeRoom = state.rooms.find((room) => room.id === state.activeRoomId);
  const roomId = activeRoom?.id;
  const messages = roomId ? state.messagesByRoom[roomId] ?? [] : [];

  return (
    <Box flexDirection="column">
      <Text>HyChat</Text>
      <Box flexDirection="column" flexGrow={1}>
        {messages.length === 0 ? (
          <Text dimColor>No messages</Text>
        ) : (
          messages.map((message) => (
            <Text key={message.id}>
              {message.senderName ?? message.senderId}: {message.body}
            </Text>
          ))
        )}
      </Box>
      <Text dimColor>{statusText}</Text>
      <InputComposer promptLabel={promptLabel} input={input} cursorVisible={cursorVisible} />
      <StatusBar state={state} userLabel={userLabel} userRole={userRole} />
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
