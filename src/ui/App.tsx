import React from 'react';
import { Box, Text } from 'ink';

import type { AppState } from './state.js';

export type AppProps = {
  state: AppState;
};

export function App({ state }: AppProps) {
  const activeRoom = state.rooms.find((room) => room.id === state.activeRoomId);
  const roomId = activeRoom?.id;
  const messages = roomId ? state.messagesByRoom[roomId] ?? [] : [];
  const symbols = roomId ? state.watchlistByRoom[roomId] ?? [] : [];

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text>HyChat{activeRoom ? ` / ${activeRoom.name}` : ''}</Text>
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
      <Text dimColor>input: type /help for commands</Text>
    </Box>
  );
}
