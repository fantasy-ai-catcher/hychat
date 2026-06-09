export type RoomSummary = {
  id: string;
  name: string;
};

export type ChatMessage = {
  id: string;
  roomId: string;
  senderId: string;
  senderName?: string;
  body: string;
  createdAt: string;
};

export type QuoteSummary = {
  symbol: string;
  price?: number;
  changePercent?: number;
  cacheStatus: 'hit' | 'refreshed' | 'stale';
};

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

export type AppState = {
  rooms: RoomSummary[];
  activeRoomId?: string;
  messagesByRoom: Record<string, ChatMessage[]>;
  watchlistByRoom: Record<string, string[]>;
  quotesBySymbol: Record<string, QuoteSummary>;
  connectionStatus: ConnectionStatus;
};

export type AppAction =
  | { type: 'rooms-loaded'; rooms: RoomSummary[] }
  | { type: 'room-joined'; roomId: string }
  | { type: 'messages-loaded'; roomId: string; messages: ChatMessage[] }
  | { type: 'message-received'; message: ChatMessage }
  | { type: 'watchlist-updated'; roomId: string; symbols: string[] }
  | { type: 'quotes-updated'; quotes: QuoteSummary[] }
  | { type: 'connection-changed'; status: ConnectionStatus };

export function createInitialAppState(): AppState {
  return {
    rooms: [],
    messagesByRoom: {},
    watchlistByRoom: {},
    quotesBySymbol: {},
    connectionStatus: 'idle'
  };
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'rooms-loaded':
      return { ...state, rooms: action.rooms };
    case 'room-joined':
      return { ...state, activeRoomId: action.roomId };
    case 'messages-loaded':
      return {
        ...state,
        messagesByRoom: {
          ...state.messagesByRoom,
          [action.roomId]: action.messages
        }
      };
    case 'message-received':
      return {
        ...state,
        messagesByRoom: {
          ...state.messagesByRoom,
          [action.message.roomId]: [
            ...(state.messagesByRoom[action.message.roomId] ?? []),
            action.message
          ]
        }
      };
    case 'watchlist-updated':
      return {
        ...state,
        watchlistByRoom: {
          ...state.watchlistByRoom,
          [action.roomId]: action.symbols
        }
      };
    case 'quotes-updated':
      return {
        ...state,
        quotesBySymbol: {
          ...state.quotesBySymbol,
          ...Object.fromEntries(action.quotes.map((quote) => [quote.symbol, quote]))
        }
      };
    case 'connection-changed':
      return { ...state, connectionStatus: action.status };
  }
}
