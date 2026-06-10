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
        <InfoPanel state={state} userLabel={userLabel} userRole={userRole} />
      </Box>
      <Text dimColor>{statusText}</Text>
      <InputComposer promptLabel={promptLabel} input={input} cursorVisible={cursorVisible} />
    </Box>
  );
}

export type InfoPanelProps = {
  state: AppState;
  userLabel?: string;
  userRole?: string;
};

export function InfoPanel({ state, userLabel, userRole }: InfoPanelProps) {
  const activeRoom = state.rooms.find((room) => room.id === state.activeRoomId);
  const roomId = activeRoom?.id;
  const members = roomId ? state.membersByRoom[roomId] ?? [] : [];
  const symbols = roomId ? state.watchlistByRoom[roomId] ?? [] : [];

  return (
    <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1} width={34}>
      <Text color="cyan">Session</Text>
      <Text>account  {userLabel ?? '-'}</Text>
      <Text>role     {userRole ?? '-'}</Text>
      <Text>room     {activeRoom?.name ?? '-'}</Text>
      <Text>status   {state.connectionStatus}</Text>
      <Text color="cyan">Members</Text>
      {members.length === 0 ? (
        <Text dimColor>-</Text>
      ) : (
        members.map((member) => (
          <Text key={member.userId}>
            {member.displayName ?? member.userId}  {member.role}
          </Text>
        ))
      )}
      <Text color="cyan">Stocks</Text>
      {symbols.length === 0 ? (
        <Text dimColor>-</Text>
      ) : (
        symbols.map((symbol) => {
          const quote = state.quotesBySymbol[symbol];
          return (
            <Text key={symbol}>
              {symbol}  {quote?.price ?? '-'}  {formatQuoteChange(quote?.changePercent)}
            </Text>
          );
        })
      )}
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
