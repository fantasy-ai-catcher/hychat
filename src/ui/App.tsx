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
    () => (service ? createChatSession({ service, realtime, defaultDisplayName }) : undefined),
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
  promptLabel: string;
  input: string;
  cursorVisible: boolean;
};

function AppShell({ state, statusText, userLabel, promptLabel, input, cursorVisible }: AppShellProps) {
  const activeRoom = state.rooms.find((room) => room.id === state.activeRoomId);
  const roomId = activeRoom?.id;
  const messages = roomId ? state.messagesByRoom[roomId] ?? [] : [];
  const symbols = roomId ? state.watchlistByRoom[roomId] ?? [] : [];

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text>
          HyChat{activeRoom ? ` / ${activeRoom.name}` : ''}
          {userLabel ? ` / ${userLabel}` : ''}
        </Text>
        <Text>{state.connectionStatus}</Text>
      </Box>
      <Box flexDirection="row" gap={2}>
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
        <Box flexDirection="column" width={24}>
          <Text>stocks</Text>
          {symbols.map((symbol) => {
            const quote = state.quotesBySymbol[symbol];
            return (
              <Text key={symbol}>
                {symbol} {quote?.price ?? '-'} {quote?.changePercent ?? '-'}%
              </Text>
            );
          })}
        </Box>
      </Box>
      <Text dimColor>{statusText}</Text>
      <InputComposer promptLabel={promptLabel} input={input} cursorVisible={cursorVisible} />
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
