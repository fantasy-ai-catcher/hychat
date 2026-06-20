export type RoomSummary = {
  id: string;
  name: string;
  memberCount?: number;
  isMember?: boolean;
};

// `text` is a chat line typed by a user; `system` is a room-activity line
// (joined/left/added a stock/…) written server-side. New activity types only
// add a new `kind === 'system'` row — see formatActivityLine.
export type ChatMessageKind = 'text' | 'system';

export type ChatMessage = {
  id: string;
  roomId: string;
  senderId: string;
  senderName?: string;
  senderColor?: string;
  kind: ChatMessageKind;
  body: string;
  // Structured event payload for system messages (e.g. { event, symbol }). Kept
  // generic so a future renderer can special-case a type without a schema change.
  metadata?: Record<string, unknown>;
  createdAt: string;
};

// Render a system/activity message as one line. The actor is `senderName` and
// the predicate ("joined the room", "added AAPL.US") is composed in `body`, so a
// new activity type needs no client change here. This is the single place to
// branch on `metadata.event` if a type ever needs custom wording.
export function formatActivityLine(message: ChatMessage): string {
  const name = message.senderName ?? message.senderId;
  return message.body ? `${name} ${message.body}` : name;
}

// Diff two presence snapshots (online user ids) into who just arrived and who
// just left, excluding the current user (we never announce our own coming/going
// to ourselves). Pure, so the chat session can turn the ids into activity lines.
export function computePresenceTransitions(
  previous: string[],
  current: string[],
  selfId?: string
): { arrivedUserIds: string[]; leftUserIds: string[] } {
  const before = new Set(previous);
  const after = new Set(current);
  return {
    arrivedUserIds: current.filter((id) => id !== selfId && !before.has(id)),
    leftUserIds: previous.filter((id) => id !== selfId && !after.has(id))
  };
}

// Interleave persistent chat/system messages with ephemeral activity lines
// (presence online/offline) into one time-ordered timeline for the viewport.
// Stable sort by timestamp; ties keep messages ahead of activity.
export function mergeChatTimeline(
  messages: ChatMessage[],
  activity: ChatMessage[]
): ChatMessage[] {
  if (activity.length === 0) {
    return messages;
  }
  return [...messages, ...activity].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

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
  // Ephemeral, client-only activity lines (presence online/offline) per room.
  // Not loaded from the DB and not persisted; cleared on leave. Merged with
  // messages for display via mergeChatTimeline.
  activityByRoom: Record<string, ChatMessage[]>;
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
  | { type: 'activity-added'; roomId: string; activity: ChatMessage }
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
    activityByRoom: {},
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

// Beijing time has a fixed UTC+8 offset (no DST), so the Asia/Shanghai zone
// renders the same wall clock for everyone regardless of the machine's locale.
// hourCycle 'h23' keeps midnight as 00, not 24.
const beijingTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

// Format an ISO timestamp (as supabase-js returns it) as Beijing "MM-DD HH:MM".
// Returns '' for anything that does not parse, so callers can render nothing
// rather than "Invalid Date". Assemble from parts so the order is fixed
// regardless of the formatter's locale conventions.
export function formatBeijingTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = beijingTimeFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

// Ephemeral presence activity lines are kept only for display; cap the per-room
// history so repeated online/offline churn can't grow state unbounded.
const activityHistoryLimit = 50;

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
      const { [action.roomId]: _activity, ...activityByRoom } = state.activityByRoom;
      return {
        ...state,
        activeRoomId: state.activeRoomId === action.roomId ? undefined : state.activeRoomId,
        onlineByRoom,
        activeByRoom,
        typingByRoom,
        activityByRoom
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
    case 'activity-added': {
      const current = state.activityByRoom[action.roomId] ?? [];
      return {
        ...state,
        activityByRoom: {
          ...state.activityByRoom,
          // Cap the ephemeral log so a chatty presence churn can't grow it without
          // bound; only the most recent lines matter.
          [action.roomId]: [...current, action.activity].slice(-activityHistoryLimit)
        }
      };
    }
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
