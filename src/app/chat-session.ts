import { parseChatInput, type ParsedChatInput } from '../chat/commands.js';
import { parseCanonicalSymbol } from '../stocks/symbols.js';
import {
  createInitialAppState,
  reducer,
  type AppState,
  type ChatMessage,
  type QuoteSummary,
  type RoomMemberSummary,
  type RoomSummary
} from '../ui/state.js';
import type {
  ChatMessageRow,
  HychatUser,
  RoomSummary as ServiceRoomSummary,
  WatchlistRow
} from './hychat-service.js';

type QuoteApiResult = {
  quotes?: Array<{
    symbol: string;
    price?: number;
    changePercent?: number;
    cacheStatus?: QuoteSummary['cacheStatus'];
  }>;
  failed?: Array<{ symbol: string; reason: string }>;
};

type MemberRow = {
  room_id: string;
  user_id: string;
  display_name?: string;
  role: 'owner' | 'member';
  created_at?: string;
};

type ChatServiceLike = {
  getCurrentUser: () => Promise<HychatUser | null>;
  startProfile: (displayName: string, inviteCode?: string) => Promise<HychatUser>;
  signOut: () => Promise<void>;
  createInviteCode: () => Promise<string>;
  listRooms: () => Promise<ServiceRoomSummary[]>;
  createRoom: (name: string, userId: string) => Promise<ServiceRoomSummary>;
  inviteMember: (roomId: string, displayName: string) => Promise<unknown>;
  listMembers?: (roomId: string) => Promise<MemberRow[]>;
  listRecentMessages: (roomId: string) => Promise<ChatMessageRow[]>;
  sendTextMessage: (input: { roomId: string; senderId: string; body: string }) => Promise<void>;
  listWatchlist: (roomId: string) => Promise<WatchlistRow[]>;
  addWatchSymbol: (input: { roomId: string; symbol: string; addedBy: string }) => Promise<void>;
  removeWatchSymbol: (roomId: string, symbol: string) => Promise<void>;
  getQuotes: (symbols: string[], force: boolean) => Promise<unknown>;
};

type RoomSubscription = {
  unsubscribe: () => unknown;
};

type RealtimeLike = {
  subscribeToRoom: (
    roomId: string,
    handlers: {
      onMessage: (message: ChatMessageRow) => void;
      onWatchlistChange: () => void;
      onStatus?: (status: string) => void;
    }
  ) => RoomSubscription;
};

export type ChatSessionSnapshot = {
  state: AppState;
  user: HychatUser | null;
  statusText: string;
  helpLines: string[];
  shouldExit: boolean;
};

export type CreateChatSessionOptions = {
  service: ChatServiceLike;
  realtime?: RealtimeLike;
  defaultDisplayName?: string;
  onSnapshotChange?: (snapshot: ChatSessionSnapshot) => void;
};

const helpSections = [
  {
    title: 'Start',
    commands: [
      {
        usage: '/start [nickname] [invite-code]',
        description: 'Activate this terminal user. The first active profile becomes admin.'
      },
      {
        usage: '/logout',
        description: 'Sign out and clear the local session.'
      },
      {
        usage: '/quit',
        description: 'Exit HyChat.'
      }
    ]
  },
  {
    title: 'Rooms',
    commands: [
      {
        usage: '/create <room name>',
        description: 'Create a room and join it.'
      },
      {
        usage: '/rooms',
        description: 'Reload the rooms you can access.'
      },
      {
        usage: '/join <room id|room name>',
        description: 'Join an existing room by id or name.'
      }
    ]
  },
  {
    title: 'Members',
    commands: [
      {
        usage: '/invite <nickname>',
        description: 'Invite an active profile into the current room.'
      },
      {
        usage: '/invite-code',
        description: 'Create a friend invite code. Admin only.'
      },
      {
        usage: '/members',
        description: 'List members in the current room.'
      }
    ]
  },
  {
    title: 'Stocks',
    commands: [
      {
        usage: '/watch add <symbol>',
        description: 'Add a stock to the current room watchlist.'
      },
      {
        usage: '/watch remove <symbol>',
        description: 'Remove a stock from the current room watchlist.'
      },
      {
        usage: '/stock <symbol>',
        description: 'Load the latest quote for one stock.'
      },
      {
        usage: '/refresh [symbol]',
        description: 'Refresh watched stock quotes, or one symbol when provided.'
      }
    ]
  },
  {
    title: 'Help',
    commands: [
      {
        usage: '/help',
        description: 'Show command usage, parameters, and descriptions.'
      }
    ]
  }
];

const helpText = formatHelpText(helpSections);

const helpLines = helpSections.flatMap((section) =>
  section.commands.map((command) => command.usage)
);

export function createChatSession(options: CreateChatSessionOptions) {
  let state = createInitialAppState();
  let user: HychatUser | null = null;
  let statusText = getSignedOutStatus(options.defaultDisplayName);
  let shouldExit = false;
  let subscription: RoomSubscription | undefined;

  function snapshot(): ChatSessionSnapshot {
    return { state, user, statusText, helpLines, shouldExit };
  }

  function emitSnapshotChange(): void {
    options.onSnapshotChange?.(snapshot());
  }

  function apply(action: Parameters<typeof reducer>[1]): void {
    state = reducer(state, action);
  }

  async function loadRooms(): Promise<void> {
    const rooms = await options.service.listRooms();
    apply({ type: 'rooms-loaded', rooms: rooms.map(toRoomSummary) });
  }

  async function loadRoomData(roomId: string): Promise<void> {
    const [messages, watchlist, members] = await Promise.all([
      options.service.listRecentMessages(roomId),
      options.service.listWatchlist(roomId),
      options.service.listMembers ? options.service.listMembers(roomId) : Promise.resolve([])
    ]);
    apply({ type: 'messages-loaded', roomId, messages: messages.map(toChatMessage) });
    apply({ type: 'members-loaded', roomId, members: members.map(toRoomMemberSummary) });
    apply({
      type: 'watchlist-updated',
      roomId,
      symbols: watchlist.map((item) => item.canonical_symbol)
    });

    const symbols = watchlist.map((item) => item.canonical_symbol);
    if (symbols.length > 0) {
      await refreshQuotes(symbols, false);
    }
  }

  async function refreshQuotes(symbols: string[], force: boolean): Promise<void> {
    const result = (await options.service.getQuotes(symbols, force)) as QuoteApiResult;
    const quotes = (result.quotes ?? []).map(toQuoteSummary);
    if (quotes.length > 0) {
      apply({ type: 'quotes-updated', quotes });
    }

    if (result.failed?.length) {
      statusText = `Stock refresh warning: ${result.failed
        .map((item) => `${item.symbol} ${item.reason}`)
        .join(', ')}`;
    }
  }

  async function joinRoom(roomId: string): Promise<void> {
    subscription?.unsubscribe();
    apply({ type: 'room-joined', roomId });
    await loadRoomData(roomId);

    subscription = options.realtime?.subscribeToRoom(roomId, {
      onMessage(message) {
        apply({ type: 'message-received', message: toChatMessage(message) });
        emitSnapshotChange();
      },
      onWatchlistChange() {
        void loadRoomData(roomId).then(emitSnapshotChange);
      },
      onStatus(status) {
        apply({ type: 'connection-changed', status: status === 'SUBSCRIBED' ? 'connected' : 'connecting' });
        emitSnapshotChange();
      }
    });
  }

  function requireUser(): HychatUser {
    if (!user) {
      throw new Error('Please /start first.');
    }

    return user;
  }

  function requireActiveRoom(): string {
    if (!state.activeRoomId) {
      throw new Error('Join a room first with /join or create one with /create.');
    }

    return state.activeRoomId;
  }

  async function handleCommand(command: Exclude<ParsedChatInput, { type: 'message' | 'empty' | 'error' }>) {
    switch (command.name) {
      case 'start': {
        const displayName = command.displayName ?? options.defaultDisplayName;
        if (!displayName) {
          statusText = 'Usage: /start <nickname> [invite-code]';
          return;
        }

        user = await options.service.startProfile(displayName, command.inviteCode);
        await loadRooms();
        apply({ type: 'connection-changed', status: 'connected' });
        statusText = `Started as ${user.displayName} (${user.role}).`;
        return;
      }

      case 'logout':
        subscription?.unsubscribe();
        subscription = undefined;
        await options.service.signOut();
        user = null;
        state = createInitialAppState();
        statusText = 'Signed out.';
        return;

      case 'invite-code': {
        requireUser();
        const code = await options.service.createInviteCode();
        statusText = `Invite code: ${code}`;
        return;
      }

      case 'rooms':
        requireUser();
        await loadRooms();
        statusText = 'Rooms refreshed.';
        return;

      case 'create-room': {
        const currentUser = requireUser();
        const room = await options.service.createRoom(command.nameText, currentUser.id);
        await loadRooms();
        await joinRoom(room.id);
        statusText = `Joined ${room.name}.`;
        return;
      }

      case 'join': {
        requireUser();
        const room = resolveRoom(command.room, state.rooms);
        await joinRoom(room.id);
        statusText = `Joined ${room.name}.`;
        return;
      }

      case 'invite': {
        requireUser();
        const roomId = requireActiveRoom();
        await options.service.inviteMember(roomId, command.displayName);
        statusText = `Invited ${command.displayName}.`;
        return;
      }

      case 'members': {
        requireUser();
        const roomId = requireActiveRoom();
        const members = options.service.listMembers
          ? await options.service.listMembers(roomId)
          : [];
        apply({ type: 'members-loaded', roomId, members: members.map(toRoomMemberSummary) });
        statusText =
          members.length > 0
            ? members
                .map((member) => `${member.role}:${member.display_name ?? member.user_id}`)
                .join(' ')
            : 'Members can be invited with /invite <nickname>.';
        return;
      }

      case 'watch-add': {
        const currentUser = requireUser();
        const roomId = requireActiveRoom();
        const symbol = normalizeSymbol(command.symbol);
        await options.service.addWatchSymbol({
          roomId,
          symbol,
          addedBy: currentUser.id
        });
        await loadRoomData(roomId);
        statusText = `Watching ${symbol}.`;
        return;
      }

      case 'watch-remove': {
        requireUser();
        const roomId = requireActiveRoom();
        const symbol = normalizeSymbol(command.symbol);
        await options.service.removeWatchSymbol(roomId, symbol);
        await loadRoomData(roomId);
        statusText = `Removed ${symbol}.`;
        return;
      }

      case 'stock': {
        requireUser();
        const symbol = normalizeSymbol(command.symbol);
        await refreshQuotes([symbol], false);
        statusText = `Stock loaded: ${symbol}.`;
        return;
      }

      case 'refresh': {
        requireUser();
        const roomId = state.activeRoomId;
        const symbols = command.symbol
          ? [normalizeSymbol(command.symbol)]
          : roomId
            ? state.watchlistByRoom[roomId] ?? []
            : [];
        if (symbols.length === 0) {
          statusText = 'No symbols to refresh.';
          return;
        }

        await refreshQuotes(symbols, true);
        statusText = `Refreshed ${symbols.join(', ')}.`;
        return;
      }

      case 'help':
        statusText = helpText;
        return;

      case 'quit':
        shouldExit = true;
        subscription?.unsubscribe();
        statusText = 'Bye.';
        return;
    }
  }

  return {
    async initialize(): Promise<ChatSessionSnapshot> {
      user = await options.service.getCurrentUser();
      if (user) {
        await loadRooms();
        apply({ type: 'connection-changed', status: 'connected' });
        statusText = `Signed in as ${user.displayName}.`;
      }

      return snapshot();
    },

    async handleLine(line: string): Promise<ChatSessionSnapshot> {
      const parsed = parseChatInput(line);
      try {
        if (parsed.type === 'empty') {
          return snapshot();
        }

        if (parsed.type === 'error') {
          statusText = parsed.message;
          return snapshot();
        }

        if (parsed.type === 'message') {
          const currentUser = requireUser();
          const roomId = requireActiveRoom();
          await options.service.sendTextMessage({
            roomId,
            senderId: currentUser.id,
            body: parsed.body
          });
          await loadRoomData(roomId);
          statusText = 'Message sent.';
          return snapshot();
        }

        await handleCommand(parsed);
      } catch (error) {
        statusText = error instanceof Error ? error.message : 'Command failed.';
      }

      return snapshot();
    }
  };
}

type HelpSection = {
  title: string;
  commands: Array<{
    usage: string;
    description: string;
  }>;
};

function formatHelpText(sections: HelpSection[]): string {
  return sections
    .map((section) => {
      const commands = section.commands
        .map((command) => `${command.usage}\n  ${command.description}`)
        .join('\n');
      return `${section.title}\n${commands}`;
    })
    .join('\n\n');
}

function toRoomSummary(room: ServiceRoomSummary): RoomSummary {
  return { id: room.id, name: room.name };
}

function toChatMessage(message: ChatMessageRow): ChatMessage {
  return {
    id: message.id,
    roomId: message.room_id,
    senderId: message.sender_id,
    senderName: message.sender_display_name ?? message.sender_id,
    body: message.body,
    createdAt: message.created_at
  };
}

function toRoomMemberSummary(member: MemberRow): RoomMemberSummary {
  return {
    roomId: member.room_id,
    userId: member.user_id,
    displayName: member.display_name,
    role: member.role
  };
}

function toQuoteSummary(quote: NonNullable<QuoteApiResult['quotes']>[number]): QuoteSummary {
  return {
    symbol: quote.symbol,
    price: quote.price,
    changePercent: quote.changePercent,
    cacheStatus: quote.cacheStatus ?? 'refreshed'
  };
}

function getSignedOutStatus(defaultDisplayName: string | undefined): string {
  return defaultDisplayName
    ? `Use /start to start as ${defaultDisplayName}, or /start <nickname> <invite-code>.`
    : 'Use /start <nickname> [invite-code] to start.';
}

function normalizeSymbol(input: string): string {
  const parsed = parseCanonicalSymbol(input);
  if (!parsed.success) {
    throw new Error(parsed.error);
  }

  return parsed.value.canonicalSymbol;
}

function resolveRoom(input: string, rooms: RoomSummary[]): RoomSummary;
function resolveRoom(input: string, rooms: RoomSummary[]): RoomSummary {
  const normalized = input.toLowerCase();
  const match = rooms.find(
    (room) => room.id === input || room.name.toLowerCase() === normalized
  );

  if (!match) {
    throw new Error(`Unknown room: ${input}`);
  }

  return match;
}
