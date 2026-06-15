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

// Three presence levels:
//   active  — connected and the terminal tab is focused
//   online  — connected but the tab is unfocused (or focus is undetectable)
//   offline — a member with no live connection
export type MemberStatus = 'active' | 'online' | 'offline';

export type MemberView = RoomMemberSummary & {
  status: MemberStatus;
  typing: boolean;
};

export type ComputeMemberStatusesContext = {
  // The current user is connected by definition while in the room, so they
  // never wait on the presence round-trip (which can lag several seconds).
  currentUserId?: string;
  // The current user's own terminal focus, known locally without a round-trip.
  currentUserActive?: boolean;
};

// Pure projection of the persistent member list onto live presence + typing.
export function computeMemberStatuses(
  members: RoomMemberSummary[],
  onlineUserIds: string[],
  activeUserIds: string[],
  typingUserIds: string[],
  context: ComputeMemberStatusesContext = {}
): MemberView[] {
  const online = new Set(onlineUserIds);
  const active = new Set(activeUserIds);
  if (context.currentUserId) {
    online.add(context.currentUserId);
    if (context.currentUserActive) {
      active.add(context.currentUserId);
    } else {
      active.delete(context.currentUserId);
    }
  }
  const typing = new Set(typingUserIds);
  return members.map((member) => {
    const isOnline = online.has(member.userId);
    const status: MemberStatus = !isOnline
      ? 'offline'
      : active.has(member.userId)
        ? 'active'
        : 'online';
    return {
      ...member,
      status,
      typing: isOnline && typing.has(member.userId)
    };
  });
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
  activeByRoom: Record<string, string[]>;
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
  | { type: 'focus-changed'; roomId: string; userId: string; active: boolean }
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
    activeByRoom: {},
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
      const { [action.roomId]: _active, ...activeByRoom } = state.activeByRoom;
      const { [action.roomId]: _typing, ...typingByRoom } = state.typingByRoom;
      return {
        ...state,
        activeRoomId: state.activeRoomId === action.roomId ? undefined : state.activeRoomId,
        onlineByRoom,
        activeByRoom,
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
    case 'presence-synced': {
      const online = new Set(action.userIds);
      return {
        ...state,
        onlineByRoom: {
          ...state.onlineByRoom,
          [action.roomId]: action.userIds
        },
        // Drop active marks for anyone no longer connected.
        activeByRoom: {
          ...state.activeByRoom,
          [action.roomId]: (state.activeByRoom[action.roomId] ?? []).filter((id) =>
            online.has(id)
          )
        }
      };
    }
    case 'focus-changed': {
      const current = state.activeByRoom[action.roomId] ?? [];
      const next = action.active
        ? current.includes(action.userId)
          ? current
          : [...current, action.userId]
        : current.filter((id) => id !== action.userId);
      if (next === current) {
        return state;
      }
      return {
        ...state,
        activeByRoom: { ...state.activeByRoom, [action.roomId]: next }
      };
    }
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
