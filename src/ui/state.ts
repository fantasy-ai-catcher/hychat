export type RoomSummary = {
  id: string;
  name: string;
  memberCount?: number;
  isMember?: boolean;
};

export type ChatMessage = {
  id: string;
  roomId: string;
  senderId: string;
  senderName?: string;
  senderColor?: string;
  body: string;
  createdAt: string;
};

export type RoomMemberSummary = {
  roomId: string;
  userId: string;
  displayName?: string;
  displayColor?: string;
  role: 'owner' | 'member';
};

// Phase 1 distinguishes connected (online) from a member who has no live
// connection (offline). Phase 2 will split online into active (terminal tab
// focused) vs online (unfocused).
export type MemberStatus = 'online' | 'offline';

export type MemberView = RoomMemberSummary & {
  status: MemberStatus;
  typing: boolean;
};

// Pure projection of the persistent member list onto live presence + typing.
// A member present in the realtime presence set is online; everyone else is a
// member who is currently disconnected (offline). The current user is online
// by definition while in the room, so they never wait on the presence
// round-trip (which can lag several seconds).
export function computeMemberStatuses(
  members: RoomMemberSummary[],
  onlineUserIds: string[],
  typingUserIds: string[],
  currentUserId?: string
): MemberView[] {
  const online = new Set(onlineUserIds);
  if (currentUserId) {
    online.add(currentUserId);
  }
  const typing = new Set(typingUserIds);
  return members.map((member) => ({
    ...member,
    status: online.has(member.userId) ? 'online' : 'offline',
    typing: online.has(member.userId) && typing.has(member.userId)
  }));
}

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
  membersByRoom: Record<string, RoomMemberSummary[]>;
  onlineByRoom: Record<string, string[]>;
  typingByRoom: Record<string, string[]>;
  watchlistByRoom: Record<string, string[]>;
  quotesBySymbol: Record<string, QuoteSummary>;
  connectionStatus: ConnectionStatus;
};

export type AppAction =
  | { type: 'rooms-loaded'; rooms: RoomSummary[] }
  | { type: 'room-joined'; roomId: string }
  | { type: 'room-left'; roomId: string }
  | { type: 'messages-loaded'; roomId: string; messages: ChatMessage[] }
  | { type: 'members-loaded'; roomId: string; members: RoomMemberSummary[] }
  | { type: 'presence-synced'; roomId: string; userIds: string[] }
  | { type: 'typing-started'; roomId: string; userId: string }
  | { type: 'typing-stopped'; roomId: string; userId: string }
  | { type: 'message-received'; message: ChatMessage }
  | { type: 'watchlist-updated'; roomId: string; symbols: string[] }
  | { type: 'quotes-updated'; quotes: QuoteSummary[] }
  | { type: 'connection-changed'; status: ConnectionStatus };

export function createInitialAppState(): AppState {
  return {
    rooms: [],
    messagesByRoom: {},
    membersByRoom: {},
    onlineByRoom: {},
    typingByRoom: {},
    watchlistByRoom: {},
    quotesBySymbol: {},
    connectionStatus: 'idle'
  };
}

export type ShellView = 'welcome' | 'chat';

export function resolveShellView(state: Pick<AppState, 'activeRoomId'>): ShellView {
  return state.activeRoomId ? 'chat' : 'welcome';
}

export function buildWelcomeLines(userDisplayName?: string): string[] {
  if (userDisplayName === undefined) {
    return [
      'Get started:',
      '  1. /start <email> [invite-code]        log in or register',
      '  2. /verify <code or pasted link>       from the email you get',
      '  3. /create <room name> or /join <room> chat',
      '',
      'New here? You need an invite code from a friend.',
      'Change your name any time with /name <new name>. Type /help for all commands.'
    ];
  }

  return [
    `Hi ${userDisplayName}! You are not in a room yet.`,
    '  /rooms                 list rooms',
    '  /create <room name>    create a room',
    '  /join <room>           enter a room',
    '',
    'Type /help for all commands.'
  ];
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'rooms-loaded':
      return { ...state, rooms: action.rooms };
    case 'room-joined':
      return { ...state, activeRoomId: action.roomId };
    case 'room-left': {
      const { [action.roomId]: _online, ...onlineByRoom } = state.onlineByRoom;
      const { [action.roomId]: _typing, ...typingByRoom } = state.typingByRoom;
      return {
        ...state,
        activeRoomId: state.activeRoomId === action.roomId ? undefined : state.activeRoomId,
        onlineByRoom,
        typingByRoom
      };
    }
    case 'messages-loaded':
      return {
        ...state,
        messagesByRoom: {
          ...state.messagesByRoom,
          [action.roomId]: action.messages
        }
      };
    case 'members-loaded':
      return {
        ...state,
        membersByRoom: {
          ...state.membersByRoom,
          [action.roomId]: action.members
        }
      };
    case 'presence-synced':
      return {
        ...state,
        onlineByRoom: {
          ...state.onlineByRoom,
          [action.roomId]: action.userIds
        }
      };
    case 'typing-started': {
      const current = state.typingByRoom[action.roomId] ?? [];
      if (current.includes(action.userId)) {
        return state;
      }
      return {
        ...state,
        typingByRoom: {
          ...state.typingByRoom,
          [action.roomId]: [...current, action.userId]
        }
      };
    }
    case 'typing-stopped': {
      const current = state.typingByRoom[action.roomId] ?? [];
      if (!current.includes(action.userId)) {
        return state;
      }
      return {
        ...state,
        typingByRoom: {
          ...state.typingByRoom,
          [action.roomId]: current.filter((id) => id !== action.userId)
        }
      };
    }
    case 'message-received':
      if (
        (state.messagesByRoom[action.message.roomId] ?? []).some(
          (message) => message.id === action.message.id
        )
      ) {
        return state;
      }

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
