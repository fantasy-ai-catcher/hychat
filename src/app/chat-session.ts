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
import {
  formatProfileColorList,
  isProfileColorName
} from './profile-colors.js';

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
  display_color?: string;
  role: 'owner' | 'member';
  created_at?: string;
};

type InviteCodeRow = {
  code: string;
  room_name?: string | null;
  used_by_display_name?: string | null;
  used_at?: string | null;
  expires_at: string;
};

type ChatServiceLike = {
  getCurrentUser: () => Promise<HychatUser | null>;
  sendOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, code: string) => Promise<void>;
  verifyOtpLink: (tokenHash: string) => Promise<void>;
  setSessionTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  getAuthEmail: () => Promise<string | null>;
  startProfile: (displayName: string, inviteCode?: string) => Promise<HychatUser>;
  updateProfileColor: (color: string) => Promise<HychatUser>;
  signOut: () => Promise<void>;
  createInviteCode: (roomId?: string) => Promise<string>;
  listInviteCodes?: () => Promise<InviteCodeRow[]>;
  revokeInviteCode?: (code: string) => Promise<unknown>;
  listRooms: () => Promise<ServiceRoomSummary[]>;
  createRoom: (name: string, userId: string) => Promise<ServiceRoomSummary>;
  inviteMember: (roomId: string, displayName: string) => Promise<unknown>;
  listMembers?: (roomId: string) => Promise<MemberRow[]>;
  listRecentMessages: (roomId: string) => Promise<ChatMessageRow[]>;
  sendTextMessage: (input: {
    roomId: string;
    senderId: string;
    body: string;
  }) => Promise<ChatMessageRow | void>;
  listWatchlist: (roomId: string) => Promise<WatchlistRow[]>;
  addWatchSymbol: (input: { roomId: string; symbol: string; addedBy: string }) => Promise<void>;
  removeWatchSymbol: (roomId: string, symbol: string) => Promise<void>;
  getQuotes: (symbols: string[], force: boolean) => Promise<unknown>;
};

type RoomSubscription = {
  unsubscribe: () => unknown;
};

type StockQuoteChangeRow = {
  canonical_symbol: string;
  price?: number | null;
  change_percent?: number | null;
};

type RealtimeLike = {
  subscribeToRoom: (
    roomId: string,
    handlers: {
      onMessage: (message: ChatMessageRow) => void;
      onWatchlistChange: () => void;
      onQuoteChange?: (quote: StockQuoteChangeRow) => void;
      onStatus?: (status: string) => void;
    }
  ) => RoomSubscription;
};

export type ChatSessionSnapshot = {
  state: AppState;
  user: HychatUser | null;
  statusText: string;
  isBusy: boolean;
  helpLines: string[];
  shouldExit: boolean;
};

export type CreateChatSessionOptions = {
  service: ChatServiceLike;
  realtime?: RealtimeLike;
  onSnapshotChange?: (snapshot: ChatSessionSnapshot) => void;
};

const helpSections = [
  {
    title: 'Start',
    commands: [
      {
        usage: '/start <email> | /start <nickname> <email> [invite-code]',
        description:
          'Log in (email only) or register (nickname + email). Sends a code to your email.'
      },
      {
        usage: '/verify <code>',
        description: 'Enter the code from your email to finish /start.'
      },
      {
        usage: '/logout confirm',
        description: 'Sign out locally. Log back in any time with /start <email>.'
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
        usage: '/join <number|room id|room name>',
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
        description:
          'Create an invite code. Inside a room the code also joins the friend to that room (room owner or admin); outside a room it is a global code (admin only).'
      },
      {
        usage: '/invite-code list',
        description: 'List the invite codes you created and whether they were used.'
      },
      {
        usage: '/invite-code revoke <code>',
        description: 'Revoke one of your unused invite codes.'
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
    title: 'Profile',
    commands: [
      {
        usage: '/color',
        description: 'Show your current profile color and the selectable palette.'
      },
      {
        usage: '/color list',
        description: 'Show all selectable profile colors.'
      },
      {
        usage: '/color set <color>',
        description: 'Set the color used for your name in chat.'
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

// Shown in the status line while a command's network request is in flight.
// Returns null for input that resolves instantly, so the status does not flash.
export function buildPendingStatusText(parsed: ParsedChatInput): string | null {
  if (parsed.type === 'message') {
    return 'Sending…';
  }

  if (parsed.type !== 'command') {
    return null;
  }

  switch (parsed.name) {
    case 'start':
      return parsed.email ? 'Signing in…' : null;
    case 'verify':
      return 'Verifying…';
    case 'logout':
      return parsed.confirmed ? 'Signing out…' : null;
    case 'rooms':
      return 'Loading rooms…';
    case 'create-room':
      return `Creating room ${parsed.nameText}…`;
    case 'join':
      return `Joining ${parsed.room}…`;
    case 'invite':
      return `Inviting ${parsed.displayName}…`;
    case 'invite-code':
      return 'Creating invite code…';
    case 'invite-code-list':
      return 'Loading invite codes…';
    case 'invite-code-revoke':
      return 'Revoking invite code…';
    case 'members':
      return 'Loading members…';
    case 'watch-add':
      return `Adding ${parsed.symbol}…`;
    case 'watch-remove':
      return `Removing ${parsed.symbol}…`;
    case 'stock':
      return `Loading ${parsed.symbol}…`;
    case 'refresh':
      return 'Refreshing quotes…';
    case 'color-set':
      return 'Saving color…';
    case 'color-show':
    case 'color-list':
    case 'help':
    case 'quit':
      return null;
  }
}

const helpLines = helpSections.flatMap((section) =>
  section.commands.map((command) => command.usage)
);

export function createChatSession(options: CreateChatSessionOptions) {
  let state = createInitialAppState();
  let user: HychatUser | null = null;
  let statusText = signedOutStatus;
  let isBusy = false;
  let shouldExit = false;
  let subscription: RoomSubscription | undefined;
  let pendingAuth: { email: string; displayName?: string; inviteCode?: string } | null = null;
  let verifiedEmail: string | null = null;

  function snapshot(): ChatSessionSnapshot {
    return { state, user, statusText, isBusy, helpLines, shouldExit };
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

  async function enterSignedInState(message: string): Promise<void> {
    await loadRooms();
    apply({ type: 'connection-changed', status: 'connected' });
    statusText = message;
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
      onQuoteChange(quote) {
        apply({
          type: 'quotes-updated',
          quotes: [
            {
              symbol: quote.canonical_symbol,
              price: quote.price ?? undefined,
              changePercent: quote.change_percent ?? undefined,
              cacheStatus: 'refreshed'
            }
          ]
        });
        emitSnapshotChange();
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
        if (!command.email) {
          statusText = startUsageStatus;
          return;
        }

        if (command.displayName) {
          const authedEmail = verifiedEmail ?? (await options.service.getAuthEmail());
          if (authedEmail === command.email) {
            user = await options.service.startProfile(command.displayName, command.inviteCode);
            await enterSignedInState(`Started as ${user.displayName} (${user.role}).`);
            return;
          }
        }

        await options.service.sendOtp(command.email);
        pendingAuth = {
          email: command.email,
          displayName: command.displayName,
          inviteCode: command.inviteCode
        };
        statusText = `Code sent to ${command.email}. Run /verify with the code or link from the email.`;
        return;
      }

      case 'verify': {
        const redirectSession = extractRedirectSession(command.code);
        const tokenHash = redirectSession ? null : extractLoginLinkToken(command.code);

        if (redirectSession) {
          await options.service.setSessionTokens(
            redirectSession.accessToken,
            redirectSession.refreshToken
          );
        } else if (tokenHash) {
          await options.service.verifyOtpLink(tokenHash);
        } else {
          if (!pendingAuth) {
            statusText = 'Run /start <email> first to request a code.';
            return;
          }
          await options.service.verifyOtp(pendingAuth.email, command.code);
        }

        verifiedEmail = pendingAuth?.email ?? (await options.service.getAuthEmail());

        user = await options.service.getCurrentUser();
        if (user) {
          pendingAuth = null;
          await enterSignedInState(`Welcome back, ${user.displayName}.`);
          return;
        }

        if (!pendingAuth?.displayName) {
          statusText =
            'Verified, but no profile for this email yet. Run /start <nickname> <email> [invite-code] to register.';
          return;
        }

        user = await options.service.startProfile(
          pendingAuth.displayName,
          pendingAuth.inviteCode
        );
        pendingAuth = null;
        await enterSignedInState(`Started as ${user.displayName} (${user.role}).`);
        return;
      }

      case 'logout':
        if (!command.confirmed) {
          statusText =
            'Sign out locally? You can log back in with /start <email>. Type /logout confirm to proceed.';
          return;
        }

        subscription?.unsubscribe();
        subscription = undefined;
        await options.service.signOut();
        user = null;
        verifiedEmail = null;
        state = createInitialAppState();
        statusText = 'Signed out.';
        return;

      case 'invite-code': {
        requireUser();
        const roomId = state.activeRoomId;
        const code = await options.service.createInviteCode(roomId);
        const roomName = roomId
          ? state.rooms.find((room) => room.id === roomId)?.name ?? roomId
          : undefined;
        statusText = roomName
          ? `Invite code: ${code} (activates a profile and joins ${roomName})`
          : `Invite code: ${code} (activates a profile; share it with one friend)`;
        return;
      }

      case 'invite-code-list': {
        requireUser();
        if (!options.service.listInviteCodes) {
          statusText = 'Listing invite codes is not supported by this service.';
          return;
        }

        const codes = await options.service.listInviteCodes();
        statusText =
          codes.length > 0
            ? codes.map(formatInviteCodeRow).join('\n')
            : 'No invite codes yet. Create one with /invite-code.';
        return;
      }

      case 'invite-code-revoke': {
        requireUser();
        if (!options.service.revokeInviteCode) {
          statusText = 'Revoking invite codes is not supported by this service.';
          return;
        }

        await options.service.revokeInviteCode(command.code);
        statusText = `Invite code ${command.code} revoked.`;
        return;
      }

      case 'rooms':
        requireUser();
        await loadRooms();
        statusText = formatRoomList(state.rooms);
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
        await loadRooms();
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
                .map(
                  (member) =>
                    `${member.role}:${member.display_name ?? member.user_id}(${member.display_color ?? 'white'})`
                )
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

      case 'color-show': {
        const currentUser = requireUser();
        statusText = `Current color: ${currentUser.displayColor}\n${formatProfileColorList()}`;
        return;
      }

      case 'color-list':
        requireUser();
        statusText = formatProfileColorList();
        return;

      case 'color-set': {
        requireUser();
        if (!isProfileColorName(command.color)) {
          statusText = `Unknown color: ${command.color}\n${formatProfileColorList()}`;
          return;
        }

        user = await options.service.updateProfileColor(command.color);
        statusText = `Color set to ${user.displayColor}.`;
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
        await enterSignedInState(`Signed in as ${user.displayName}.`);
      }

      return snapshot();
    },

    async handleLine(line: string): Promise<ChatSessionSnapshot> {
      const parsed = parseChatInput(line);
      const pendingStatusText = buildPendingStatusText(parsed);
      if (pendingStatusText) {
        statusText = pendingStatusText;
        isBusy = true;
        emitSnapshotChange();
      }

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
          const sentMessage = await options.service.sendTextMessage({
            roomId,
            senderId: currentUser.id,
            body: parsed.body
          });
          if (sentMessage) {
            apply({ type: 'message-received', message: toChatMessage(sentMessage) });
          } else {
            const messages = await options.service.listRecentMessages(roomId);
            apply({ type: 'messages-loaded', roomId, messages: messages.map(toChatMessage) });
          }
          statusText = 'Message sent.';
        } else {
          await handleCommand(parsed);
        }
      } catch (error) {
        statusText = translateServiceError(
          error instanceof Error ? error.message : 'Command failed.'
        );
      } finally {
        isBusy = false;
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
    senderColor: message.sender_display_color,
    body: message.body,
    createdAt: message.created_at
  };
}

function toRoomMemberSummary(member: MemberRow): RoomMemberSummary {
  return {
    roomId: member.room_id,
    userId: member.user_id,
    displayName: member.display_name,
    displayColor: member.display_color,
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

function formatInviteCodeRow(row: InviteCodeRow): string {
  const scope = row.room_name ? `room:${row.room_name}` : 'global';
  const usage = row.used_at
    ? `used by ${row.used_by_display_name ?? 'unknown'}`
    : 'unused';
  const expires = row.expires_at.slice(0, 10);
  return `${row.code} ${scope} ${usage} expires ${expires}`;
}

const serviceErrorMessages: Record<string, string> = {
  display_name_taken: 'That nickname is already taken. Pick another with /start <nickname>.',
  invite_code_required: 'An invite code is required: /start <nickname> <invite-code>.',
  invalid_invite_code: 'That invite code is invalid, used, or expired.',
  not_admin: 'Only the admin can create global invite codes. Inside a room you own, /invite-code creates a room invite.',
  not_room_owner: 'Only the room owner can do that.',
  invite_code_not_found: 'No unused invite code of yours matches that value.',
  profile_not_found: 'No active profile with that nickname.'
};

function translateServiceError(message: string): string {
  return serviceErrorMessages[message] ?? message;
}

// The free-tier login email contains a link instead of a code; users can
// paste the whole link into /verify and we pull the token out of it.
function extractLoginLinkToken(input: string): string | null {
  if (!input.includes('://')) {
    return null;
  }

  try {
    return new URL(input).searchParams.get('token');
  } catch {
    return null;
  }
}

// Clicking the email link consumes the token and redirects the browser to
// site_url with a ready session in the URL fragment. Accept that pasted
// redirect URL too, so a clicked link still logs the user in.
function extractRedirectSession(
  input: string
): { accessToken: string; refreshToken: string } | null {
  if (!input.includes('://')) {
    return null;
  }

  try {
    const params = new URLSearchParams(new URL(input).hash.replace(/^#/, ''));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    return accessToken && refreshToken ? { accessToken, refreshToken } : null;
  } catch {
    return null;
  }
}

const startUsageStatus =
  'Usage: /start <email> (returning) or /start <nickname> <email> [invite-code] (new).';
const signedOutStatus =
  'Use /start <email> to log in, or /start <nickname> <email> [invite-code] to register.';

function normalizeSymbol(input: string): string {
  const parsed = parseCanonicalSymbol(input);
  if (!parsed.success) {
    throw new Error(parsed.error);
  }

  return parsed.value.canonicalSymbol;
}

function resolveRoom(input: string, rooms: RoomSummary[]): RoomSummary {
  const normalized = input.toLowerCase();
  const match = rooms.find(
    (room) => room.id === input || room.name.toLowerCase() === normalized
  );

  if (match) {
    return match;
  }

  if (/^[1-9]\d*$/.test(input)) {
    const byNumber = rooms[Number(input) - 1];
    if (byNumber) {
      return byNumber;
    }
  }

  throw new Error(`Unknown room: ${input}`);
}

// StatusText renders at most 8 lines, so cap the list at 6 rooms.
function formatRoomList(rooms: RoomSummary[]): string {
  if (rooms.length === 0) {
    return 'No rooms yet. Create one with /create <room name>.';
  }

  const visible = rooms.slice(0, 6);
  const hiddenCount = rooms.length - visible.length;
  const lines = [
    `Rooms (${rooms.length}):`,
    ...visible.map((room, index) => `  ${index + 1}. ${room.name}`)
  ];
  const hint = 'Join with /join <number|room name>.';
  lines.push(hiddenCount > 0 ? `  +${hiddenCount} more. ${hint}` : hint);
  return lines.join('\n');
}
