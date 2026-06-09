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
};

type PromptMode =
  | { kind: 'normal' }
  | { kind: 'login-email' }
  | { kind: 'signup-email' }
  | { kind: 'login-password'; email: string }
  | { kind: 'signup-password'; email: string };

function createSnapshot(state: AppState): ChatSessionSnapshot {
  return {
    state,
    user: null,
    statusText: 'Use /login or /signup to start.',
    helpLines: [],
    shouldExit: false
  };
}

export function App({ state: fixedState, service, realtime }: AppProps) {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [promptMode, setPromptMode] = useState<PromptMode>({ kind: 'normal' });
  const [snapshot, setSnapshot] = useState<ChatSessionSnapshot>(() =>
    createSnapshot(fixedState ?? createInitialAppState())
  );
  const session = useMemo(
    () => (service ? createChatSession({ service, realtime }) : undefined),
    [service, realtime]
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

  async function submitLine(line: string): Promise<void> {
    if (!session) {
      return;
    }

    const trimmed = line.trim();

    if (promptMode.kind === 'login-email' || promptMode.kind === 'signup-email') {
      const prefix = promptMode.kind === 'login-email' ? 'login' : 'signup';
      setPromptMode({ kind: `${prefix}-password`, email: trimmed } as PromptMode);
      setSnapshot((current) => ({ ...current, statusText: 'Password:' }));
      return;
    }

    if (promptMode.kind === 'login-password' || promptMode.kind === 'signup-password') {
      const command = promptMode.kind === 'login-password' ? 'login' : 'signup';
      setPromptMode({ kind: 'normal' });
      setSnapshot(await session.handleLine(`/${command} ${promptMode.email} ${line}`));
      return;
    }

    if (trimmed === '/login') {
      setPromptMode({ kind: 'login-email' });
      setSnapshot((current) => ({ ...current, statusText: 'Email:' }));
      return;
    }

    if (trimmed === '/signup') {
      setPromptMode({ kind: 'signup-email' });
      setSnapshot((current) => ({ ...current, statusText: 'Email:' }));
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
  const promptLabel = getPromptLabel(promptMode);
  const renderedInput =
    promptMode.kind === 'login-password' || promptMode.kind === 'signup-password'
      ? '*'.repeat(input.length)
      : input;

  return (
    <AppShell
      state={activeState}
      statusText={snapshot.statusText}
      userLabel={snapshot.user?.email ?? snapshot.user?.id}
      promptLabel={promptLabel}
      input={renderedInput}
    />
  );
}

type AppShellProps = {
  state: AppState;
  statusText: string;
  userLabel?: string;
  promptLabel: string;
  input: string;
};

function AppShell({ state, statusText, userLabel, promptLabel, input }: AppShellProps) {
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
                {message.senderId}: {message.body}
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
      <InputComposer promptLabel={promptLabel} input={input} />
    </Box>
  );
}

export type InputComposerProps = {
  promptLabel: string;
  input: string;
};

export function InputComposer({ promptLabel, input }: InputComposerProps) {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexShrink={0}>
      <Text color="cyan">{promptLabel}</Text>
      <Text> {input}</Text>
    </Box>
  );
}

function getPromptLabel(promptMode: PromptMode): string {
  switch (promptMode.kind) {
    case 'login-email':
    case 'signup-email':
      return 'email>';
    case 'login-password':
    case 'signup-password':
      return 'password>';
    case 'normal':
      return '>';
  }
}
