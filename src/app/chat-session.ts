import { parseChatInput, type ParsedChatInput } from '../chat/commands.js';
import { parseCanonicalSymbol } from '../stocks/symbols.js';
import {
  computeMemberStatuses,
  computePresenceTransitions,
  createInitialAppState,
  reducer,
  type AppState,
  type ChatMessage,
  type MemberView,
  type QuoteSummary,
  type RoomMemberSummary,
  type RoomSummary
} from '../ui/state.js';
import type {
  ChatMessageRow,
  HychatUser,
  RoomSummary as ServiceRoomSummary,
  RoomWithCountRow,
  WatchlistRow
} from './hychat-service.js';
import {
  formatProfileColorList,
  isProfileColorName
} from './profile-colors.js';
import {
  DEFAULT_NOTIFY_SETTINGS,
  describeNotifySettings,
  readNotifySettings,
  shouldRingForMention,
  writeNotifySettings,
  type NotifySettings
} from './mention-notify.js';
import type { Notifier } from './notify-sound.js';

type QuoteApiResult = {
  quotes?: Array<{
    symbol: string;
    name?: string;
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
  ensureProfile: (inviteCode?: string) => Promise<HychatUser>;
  setDisplayName: (displayName: string) => Promise<HychatUser>;
  updateProfileColor: (color: string) => Promise<HychatUser>;
  signOut: () => Promise<void>;
  createInviteCode: () => Promise<string>;
  listInviteCodes?: () => Promise<InviteCodeRow[]>;
  revokeInviteCode?: (code: string) => Promise<unknown>;
  listRoomsWithCounts: () => Promise<RoomWithCountRow[]>;
  createRoom: (name: string, userId: string) => Promise<ServiceRoomSummary>;
  joinRoom: (roomId: string) => Promise<void>;
  leaveRoom?: (roomId: string) => Promise<void>;
  listMembers?: (roomId: string) => Promise<MemberRow[]>;
  listRecentMessages: (roomId: string) => Promise<ChatMessageRow[]>;
  sendTextMessage: (input: {
    roomId: string;
    senderId: string;
    body: string;
    metadata?: Record<string, unknown>;
  }) => Promise<ChatMessageRow | void>;
  listWatchlist: (roomId: string) => Promise<WatchlistRow[]>;
  addWatchSymbol: (input: { roomId: string; symbol: string; addedBy: string }) => Promise<void>;
  removeWatchSymbol: (roomId: string, symbol: string) => Promise<void>;
  reorderWatchlist?: (roomId: string, orderedSymbols: string[]) => Promise<void>;
  getQuotes: (symbols: string[], force: boolean) => Promise<unknown>;
  // Heartbeats keep the room "present" so the server-side scheduled refresh
  // knows to fetch its watchlist. Optional so tests can omit it.
  touchPresence?: (roomId: string) => Promise<void>;
};

type RoomSubscription = {
  unsubscribe: () => unknown;
  sendTyping?: () => void;
  sendFocus?: (active: boolean) => void;
};

type BroadcastQuoteRow = {
  symbol: string;
  name?: string | null;
  price?: number | null;
  changePercent?: number | null;
  cacheStatus?: string;
};

type RealtimeLike = {
  subscribeToRoom: (
    roomId: string,
    handlers: {
      userId?: string;
      onMessage: (message: ChatMessageRow) => void;
      onWatchlistChange: () => void;
      onMembersChange?: () => void;
      onPresenceChange?: (onlineUserIds: string[]) => void;
      onFocus?: (userId: string, active: boolean) => void;
      onTyping?: (userId: string) => void;
      onQuotesUpdate?: (quotes: BroadcastQuoteRow[]) => void;
      onStatus?: (status: string) => void;
    }
  ) => RoomSubscription;
};

// Passed to handleLine when the user is replying to a message; persisted as the
// new message's metadata so every client can render the quoted parent.
export type ReplyMetadata = {
  replyTo: string;
  replyToName: string;
  replyToSnippet: string;
};

export type ChatSessionSnapshot = {
  state: AppState;
  user: HychatUser | null;
  statusText: string;
  isBusy: boolean;
  helpLines: string[];
  shouldExit: boolean;
  colorPickerOpen: boolean;
  watchReorderOpen: boolean;
  notifySettings: NotifySettings;
};

// A tiny key/value store (e.g. JsonFileStorage) for local app preferences. Only
// the bits chat-session needs, so tests can pass a plain object.
type PreferencesStore = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export type CreateChatSessionOptions = {
  service: ChatServiceLike;
  realtime?: RealtimeLike;
  onSnapshotChange?: (snapshot: ChatSessionSnapshot) => void;
  // Whether to emit ephemeral "joined/left the room" activity lines on presence
  // changes. Defaults to true; the CLI wires this from HYCHAT_SHOW_PRESENCE_ACTIVITY.
  showPresenceActivity?: boolean;
  // Plays the @mention notification sound. Omitted in tests / headless.
  notifier?: Notifier;
  // Persists notification preferences locally. Omitted → in-memory defaults.
  prefs?: PreferencesStore;
};

const helpSections = [
  {
    title: 'Start',
    commands: [
      {
        usage: '/start <email> [invite-code]',
        description:
          'Log in or register with your email. A new account needs an invite code. Sends a code to your email.'
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
        description: 'List every room with its member count; (joined) marks yours.'
      },
      {
        usage: '/join <number|room id|room name>',
        description: 'Join any room and enter it. No invite needed.'
      },
      {
        usage: '/leave',
        description: 'Leave the current room and return to the room list.'
      }
    ]
  },
  {
    title: 'Members',
    commands: [
      {
        usage: '/invite-code',
        description:
          'Create a code that lets one friend register an account (admin only). They join rooms themselves with /rooms and /join.'
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
        usage: '/watch reorder',
        description: 'Open a panel to reorder the room watchlist (↑↓ move, Space grab, Enter save).'
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
        usage: '/name <new name>',
        description: 'Change the name shown in rooms. You can change it any time.'
      },
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
    title: 'Notifications',
    commands: [
      {
        usage: '/notify',
        description: 'Show how you are notified when someone @mentions you.'
      },
      {
        usage: '/notify off|bell|sound|banner',
        description:
          'Choose the @mention alert: silent, terminal bell, macOS sound, or a desktop banner.'
      },
      {
        usage: '/notify when always|unfocused',
        description: 'Ring on every mention, or only when the HyChat window is unfocused.'
      },
      {
        usage: '/notify test',
        description: 'Play your current notification once, to check it works.'
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

// A remote member's typing badge clears this long after their last keystroke
// broadcast; we re-broadcast our own typing at most this often while typing.
const typingTtlMs = 3000;
const typingThrottleMs = 1500;
// Kept under the server's 90s presence-stale window so one missed beat does not
// flip a room to "empty" and pause its scheduled quote refresh.
const heartbeatIntervalMs = 45000;

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
    case 'name':
      return 'Saving name…';
    case 'logout':
      return parsed.confirmed ? 'Signing out…' : null;
    case 'rooms':
      return 'Loading rooms…';
    case 'create-room':
      return `Creating room ${parsed.nameText}…`;
    case 'join':
      return `Joining ${parsed.room}…`;
    case 'leave':
      return 'Leaving…';
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
    case 'watch-reorder':
    case 'notify-show':
    case 'notify-set':
    case 'notify-when':
    case 'notify-test':
    case 'help':
    case 'quit':
      return null;
  }
}

const notifyUsageHint =
  '/notify off|bell|sound|banner · /notify when always|unfocused · /notify test';

const helpLines = helpSections.flatMap((section) =>
  section.commands.map((command) => command.usage)
);

export function createChatSession(options: CreateChatSessionOptions) {
  let state = createInitialAppState();
  let user: HychatUser | null = null;
  let statusText = signedOutStatus;
  let isBusy = false;
  let shouldExit = false;
  let colorPickerOpen = false;
  let watchReorderOpen = false;
  let subscription: RoomSubscription | undefined;
  let pendingAuth: { email: string; inviteCode?: string } | null = null;
  let verifiedEmail: string | null = null;
  // Per-remote-user timers that clear a "typing" badge if no further typing
  // broadcast arrives. Reset on each new join so they never leak across rooms.
  let typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let lastTypingSentAt = 0;
  // Presence heartbeat for the currently joined room; cleared on every teardown
  // so it never leaks across rooms or outlives the session.
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  // The local terminal's focus, mirrored into presence so peers can tell an
  // active member (tab focused) from one who is merely connected.
  let currentFocus: 'active' | 'online' = 'active';
  // Local @mention sound preference, loaded from prefs (defaults otherwise).
  let notifySettings: NotifySettings = options.prefs
    ? readNotifySettings((key) => options.prefs!.getItem(key))
    : DEFAULT_NOTIFY_SETTINGS;
  // The first presence sync after joining is the baseline (who is already here);
  // only later changes become "joined/left" activity lines. Reset on each join.
  let presenceBaselineEstablished = false;

  function clearTypingTimers(): void {
    for (const timer of typingTimers.values()) {
      clearTimeout(timer);
    }
    typingTimers = new Map();
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  }

  function startHeartbeat(roomId: string): void {
    stopHeartbeat();
    if (!options.service.touchPresence) {
      return;
    }
    const beat = () => void options.service.touchPresence?.(roomId).catch(() => {});
    // Announce presence right away so the room is "active" before the first
    // interval, then keep it warm.
    beat();
    heartbeatTimer = setInterval(beat, heartbeatIntervalMs);
  }

  function snapshot(): ChatSessionSnapshot {
    return {
      state,
      user,
      statusText,
      isBusy,
      helpLines,
      shouldExit,
      colorPickerOpen,
      watchReorderOpen,
      notifySettings
    };
  }

  function persistNotifySettings(): void {
    if (options.prefs) {
      writeNotifySettings((key, value) => options.prefs!.setItem(key, value), notifySettings);
    }
  }

  // Ring the local user when a freshly delivered message @mentions them. Pure
  // decision in shouldRingForMention; the notifier turns the choice into sound.
  function maybeRingForMention(message: ChatMessage): void {
    if (!options.notifier) {
      return;
    }
    const ring = shouldRingForMention({
      kind: message.kind,
      body: message.body,
      senderId: message.senderId,
      selfUserId: user?.id,
      selfName: user?.displayName,
      focused: currentFocus === 'active',
      settings: notifySettings
    });
    if (ring) {
      options.notifier.ring(notifySettings.channel, `${message.senderName} mentioned you`);
    }
  }

  function emitSnapshotChange(): void {
    options.onSnapshotChange?.(snapshot());
  }

  // Realtime-triggered reloads and off-critical-path quote refreshes run
  // fire-and-forget. A transient transport failure (e.g. `fetch failed` on a
  // Wi-Fi blip) must never become an unhandled rejection that crashes the TUI:
  // swallow it, surface a friendly hint, and keep whatever snapshot we had. The
  // next realtime event re-runs the reload, so there is nothing to retry here.
  function runBackground(task: () => Promise<unknown>): void {
    void task().catch((error: unknown) => {
      statusText = translateServiceError(
        error instanceof Error ? error.message : 'Update failed.'
      );
      emitSnapshotChange();
    });
  }

  function apply(action: Parameters<typeof reducer>[1]): void {
    state = reducer(state, action);
  }

  async function loadRooms(): Promise<void> {
    const rooms = await options.service.listRoomsWithCounts();
    apply({ type: 'rooms-loaded', rooms: rooms.map(toRoomSummary) });
  }

  async function enterSignedInState(message: string): Promise<void> {
    await loadRooms();
    apply({ type: 'connection-changed', status: 'connected' });
    statusText = message;
  }

  // Loads everything except stock quotes and returns the room's watched
  // symbols. Quote fetching hits an Edge Function that can take seconds, so the
  // join path runs it off the critical path (after presence is announced).
  async function loadRoomSnapshot(roomId: string): Promise<string[]> {
    const [messages, watchlist, members] = await Promise.all([
      options.service.listRecentMessages(roomId),
      options.service.listWatchlist(roomId),
      options.service.listMembers ? options.service.listMembers(roomId) : Promise.resolve([])
    ]);
    apply({ type: 'messages-loaded', roomId, messages: messages.map(toChatMessage) });
    apply({ type: 'members-loaded', roomId, members: members.map(toRoomMemberSummary) });
    const symbols = watchlist.map((item) => item.canonical_symbol);
    apply({ type: 'watchlist-updated', roomId, symbols });
    return symbols;
  }

  // Re-read the room (messages/watchlist/members), reflect it right away, then
  // refresh the remaining symbols' quotes in the background. Quote fetches hit a
  // slow Edge Function, so they must never gate the panel update — e.g. a removed
  // stock has to disappear at once, not after the refresh. Used by the realtime
  // watchlist handler, where a watchlist change may be an add or a remove.
  async function reloadRoomThenRefreshQuotes(roomId: string): Promise<void> {
    const symbols = await loadRoomSnapshot(roomId);
    emitSnapshotChange();
    if (symbols.length > 0) {
      runBackground(() => refreshQuotes(symbols, false).then(emitSnapshotChange));
    }
  }

  async function loadMembers(roomId: string): Promise<void> {
    const members = options.service.listMembers
      ? await options.service.listMembers(roomId)
      : [];
    apply({ type: 'members-loaded', roomId, members: members.map(toRoomMemberSummary) });
  }

  async function refreshQuotes(symbols: string[], force: boolean): Promise<QuoteApiResult> {
    const result = (await options.service.getQuotes(symbols, force)) as QuoteApiResult;
    const quotes = (result.quotes ?? []).map(toQuoteSummary);
    if (quotes.length > 0) {
      apply({ type: 'quotes-updated', quotes });
    }

    if (result.failed?.length) {
      statusText = `Stock refresh warning: ${result.failed
        .map((item) => `${item.symbol} ${describeQuoteFailure(item.reason)}`)
        .join(', ')}`;
    }

    return result;
  }

  function markTyping(roomId: string, userId: string): void {
    apply({ type: 'typing-started', roomId, userId });
    const existing = typingTimers.get(userId);
    if (existing) {
      clearTimeout(existing);
    }
    typingTimers.set(
      userId,
      setTimeout(() => {
        typingTimers.delete(userId);
        apply({ type: 'typing-stopped', roomId, userId });
        emitSnapshotChange();
      }, typingTtlMs)
    );
    emitSnapshotChange();
  }

  function stopTyping(roomId: string, userId: string): void {
    const existing = typingTimers.get(userId);
    if (existing) {
      clearTimeout(existing);
      typingTimers.delete(userId);
    }
    apply({ type: 'typing-stopped', roomId, userId });
  }

  // Append an ephemeral presence activity line ("X joined/left the room"). It
  // reuses the system-message shape so it renders like any activity line, but it
  // is client-only: never persisted, gone on reload, cleared on leave.
  function addPresenceActivity(
    roomId: string,
    userId: string,
    body: string,
    event: string
  ): void {
    const member = (state.membersByRoom[roomId] ?? []).find((m) => m.userId === userId);
    const createdAt = new Date().toISOString();
    apply({
      type: 'activity-added',
      roomId,
      activity: {
        id: `presence:${userId}:${createdAt}`,
        roomId,
        senderId: userId,
        senderName: member?.displayName ?? userId,
        senderColor: member?.displayColor,
        kind: 'system',
        body,
        metadata: { event },
        createdAt
      }
    });
  }

  function announcePresenceTransitions(
    roomId: string,
    previous: string[],
    current: string[]
  ): void {
    const { arrivedUserIds, leftUserIds } = computePresenceTransitions(
      previous,
      current,
      user?.id
    );
    for (const userId of arrivedUserIds) {
      addPresenceActivity(roomId, userId, 'joined the room', 'presence_online');
    }
    for (const userId of leftUserIds) {
      addPresenceActivity(roomId, userId, 'left the room', 'presence_offline');
    }
  }

  async function joinRoom(roomId: string): Promise<void> {
    subscription?.unsubscribe();
    clearTypingTimers();
    stopHeartbeat();
    // A fresh room: the next presence sync is its baseline, not a wave of joins.
    presenceBaselineEstablished = false;
    apply({ type: 'room-joined', roomId });
    // Load messages/members/watchlist first (so messages-loaded cannot clobber
    // a realtime message), then subscribe so presence is announced before the
    // slow quote refresh runs.
    const symbols = await loadRoomSnapshot(roomId);

    subscription = options.realtime?.subscribeToRoom(roomId, {
      userId: user?.id,
      onMessage(message) {
        // A delivered message ends that sender's typing badge immediately.
        stopTyping(roomId, message.sender_id);
        const chatMessage = toChatMessage(message);
        apply({ type: 'message-received', message: chatMessage });
        maybeRingForMention(chatMessage);
        emitSnapshotChange();
      },
      onWatchlistChange() {
        runBackground(() => reloadRoomThenRefreshQuotes(roomId));
      },
      onMembersChange() {
        runBackground(() => loadMembers(roomId).then(emitSnapshotChange));
      },
      onPresenceChange(onlineUserIds) {
        const previous = state.onlineByRoom[roomId] ?? [];
        apply({ type: 'presence-synced', roomId, userIds: onlineUserIds });
        // First sync is the baseline; afterwards, arrivals/departures become
        // ephemeral "joined/left the room" activity lines.
        if (presenceBaselineEstablished) {
          if (options.showPresenceActivity ?? true) {
            announcePresenceTransitions(roomId, previous, onlineUserIds);
          }
        } else {
          presenceBaselineEstablished = true;
        }
        // Presence changed, so re-announce our focus — a member who just joined
        // would otherwise not learn the focus of those already here.
        subscription?.sendFocus?.(currentFocus === 'active');
        emitSnapshotChange();
      },
      onFocus(focusUserId, active) {
        if (focusUserId === user?.id) {
          return;
        }
        apply({ type: 'focus-changed', roomId, userId: focusUserId, active });
        emitSnapshotChange();
      },
      onTyping(typingUserId) {
        if (typingUserId === user?.id) {
          return;
        }
        markTyping(roomId, typingUserId);
      },
      onQuotesUpdate(quotes) {
        if (quotes.length === 0) {
          return;
        }
        apply({
          type: 'quotes-updated',
          quotes: quotes.map((quote) => ({
            symbol: quote.symbol,
            name: quote.name ?? undefined,
            price: quote.price ?? undefined,
            changePercent: quote.changePercent ?? undefined,
            cacheStatus: (quote.cacheStatus as QuoteSummary['cacheStatus']) ?? 'refreshed'
          }))
        });
        emitSnapshotChange();
      },
      onStatus(status) {
        apply({ type: 'connection-changed', status: status === 'SUBSCRIBED' ? 'connected' : 'connecting' });
        emitSnapshotChange();
      }
    });

    // Mark this room present so the server-side scheduled refresh keeps its
    // quotes warm while we are here.
    startHeartbeat(roomId);

    // Off the critical path: the room is already interactive and presence is
    // announced, so refresh quotes without blocking the join.
    if (symbols.length > 0) {
      runBackground(() => refreshQuotes(symbols, false).then(emitSnapshotChange));
    }
  }

  function requireUser(): HychatUser {
    if (!user) {
      throw new Error('Please /start first.');
    }

    return user;
  }

  // Persist a profile color, reflect it in the member panel immediately, and
  // report the result. Shared by `/color set` and the picker's pickColor.
  async function applyColor(name: string): Promise<{ ok: boolean }> {
    if (!isProfileColorName(name)) {
      return { ok: false };
    }
    user = await options.service.updateProfileColor(name);
    apply({ type: 'member-color-changed', userId: user.id, color: user.displayColor });
    return { ok: true };
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

        const authedEmail = verifiedEmail ?? (await options.service.getAuthEmail());
        if (authedEmail === command.email) {
          user = await options.service.ensureProfile(command.inviteCode);
          await enterSignedInState(signedInStatus(user));
          return;
        }

        await options.service.sendOtp(command.email);
        pendingAuth = {
          email: command.email,
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

        user = await options.service.ensureProfile(pendingAuth?.inviteCode);
        pendingAuth = null;
        await enterSignedInState(signedInStatus(user));
        return;
      }

      case 'name': {
        requireUser();
        user = await options.service.setDisplayName(command.displayName);
        statusText = `Name set to ${user.displayName}.`;
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
        stopHeartbeat();
        await options.service.signOut();
        user = null;
        verifiedEmail = null;
        state = createInitialAppState();
        statusText = 'Signed out.';
        return;

      case 'invite-code': {
        requireUser();
        const code = await options.service.createInviteCode();
        statusText = `Invite code: ${code} (lets one friend register; they pick any room with /rooms then /join)`;
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
        await options.service.joinRoom(room.id);
        await joinRoom(room.id);
        statusText = `Joined ${room.name}.`;
        return;
      }

      case 'leave': {
        requireUser();
        const roomId = requireActiveRoom();
        const room = state.rooms.find((entry) => entry.id === roomId);
        if (options.service.leaveRoom) {
          await options.service.leaveRoom(roomId);
        }
        subscription?.unsubscribe();
        subscription = undefined;
        clearTypingTimers();
        stopHeartbeat();
        apply({ type: 'room-left', roomId });
        await loadRooms();
        statusText = `Left ${room?.name ?? roomId}.`;
        return;
      }

      case 'members': {
        requireUser();
        const roomId = requireActiveRoom();
        const members = options.service.listMembers
          ? await options.service.listMembers(roomId)
          : [];
        apply({ type: 'members-loaded', roomId, members: members.map(toRoomMemberSummary) });
        statusText = formatMemberList(
          computeMemberStatuses(
            state.membersByRoom[roomId] ?? [],
            state.onlineByRoom[roomId] ?? [],
            state.activeByRoom[roomId] ?? [],
            state.typingByRoom[roomId] ?? [],
            { currentUserId: user?.id, currentUserActive: currentFocus === 'active' }
          )
        );
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
        await loadRoomSnapshot(roomId);
        // Fetch just the new symbol's quote so the price shows on add; the other
        // symbols are already on screen and unchanged.
        await refreshQuotes([symbol], false);
        statusText = `Watching ${symbol}.`;
        return;
      }

      case 'watch-remove': {
        requireUser();
        const roomId = requireActiveRoom();
        const symbol = normalizeSymbol(command.symbol);
        await options.service.removeWatchSymbol(roomId, symbol);
        // Removing a symbol leaves the others' quotes untouched, so just reflect
        // the new watchlist — no quote refresh, so it disappears immediately.
        await loadRoomSnapshot(roomId);
        statusText = `Removed ${symbol}.`;
        return;
      }

      case 'watch-reorder': {
        requireUser();
        const roomId = requireActiveRoom();
        const symbols = state.watchlistByRoom[roomId] ?? [];
        if (symbols.length < 2) {
          statusText = 'Add at least two stocks before reordering.';
          return;
        }
        watchReorderOpen = true;
        return;
      }

      case 'stock': {
        // Stocks are a shared, in-room feature. Look the quote up first so a
        // typo isn't pinned to everyone's panel, then add it to the room
        // watchlist so it shows in the top Stocks line for the whole room.
        const currentUser = requireUser();
        const roomId = requireActiveRoom();
        const symbol = normalizeSymbol(command.symbol);
        const result = await refreshQuotes([symbol], false);
        const failure = result.failed?.find((item) => item.symbol === symbol);
        if (failure) {
          statusText =
            failure.reason === 'symbol_not_found'
              ? `No quote for ${symbol}. Check the symbol — e.g. AAPL.US, 0700.HK, 600519.CN, 7203.JP.`
              : `${symbol}: ${describeQuoteFailure(failure.reason)}`;
          return;
        }
        await options.service.addWatchSymbol({ roomId, symbol, addedBy: currentUser.id });
        // The quote was just fetched above, so only the watchlist needs reflecting.
        await loadRoomSnapshot(roomId);
        statusText = `Watching ${symbol}.`;
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
        colorPickerOpen = true;
        return;

      case 'color-set': {
        requireUser();
        const result = await applyColor(command.color);
        if (!result.ok) {
          statusText = `Unknown color: ${command.color}\n${formatProfileColorList()}`;
          return;
        }
        statusText = `Color set to ${user?.displayColor}.`;
        return;
      }

      case 'notify-show':
        statusText = `${describeNotifySettings(notifySettings)}\n${notifyUsageHint}`;
        return;

      case 'notify-set':
        notifySettings = { ...notifySettings, channel: command.channel };
        persistNotifySettings();
        statusText =
          command.channel === 'off'
            ? 'Mention notifications off.'
            : `Mention sound: ${command.channel} (when ${notifySettings.when}).`;
        return;

      case 'notify-when':
        notifySettings = { ...notifySettings, when: command.when };
        persistNotifySettings();
        statusText = `Mention sound rings ${
          command.when === 'unfocused' ? 'only when the window is unfocused' : 'on every mention'
        }.`;
        return;

      case 'notify-test':
        if (notifySettings.channel === 'off') {
          statusText = 'Notifications are off. Turn one on with /notify bell|sound|banner.';
          return;
        }
        options.notifier?.ring(notifySettings.channel, 'HyChat test notification');
        statusText = `Played a test ${notifySettings.channel} notification.`;
        return;

      case 'help':
        statusText = helpText;
        return;

      case 'quit':
        shouldExit = true;
        subscription?.unsubscribe();
        stopHeartbeat();
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

    // Called as the local user types in the composer. Throttled so a fast
    // typist broadcasts at most once per typingThrottleMs; remote clients
    // refresh their own clear-timer on each broadcast.
    notifyTyping(): void {
      if (!state.activeRoomId || !subscription?.sendTyping) {
        return;
      }
      const now = Date.now();
      if (now - lastTypingSentAt < typingThrottleMs) {
        return;
      }
      lastTypingSentAt = now;
      subscription.sendTyping();
    },

    // Called when the terminal gains/loses focus. Broadcast it so peers can
    // tell an active member (tab focused) from one who is merely connected.
    notifyFocus(focused: boolean): void {
      currentFocus = focused ? 'active' : 'online';
      subscription?.sendFocus?.(focused);
    },

    // Apply a color chosen in the interactive picker, then close it.
    async pickColor(name: string): Promise<void> {
      await applyColor(name);
      colorPickerOpen = false;
      emitSnapshotChange();
    },

    // Dismiss the interactive picker without changing the color.
    closeColorPicker(): void {
      colorPickerOpen = false;
      emitSnapshotChange();
    },

    // Persist a new watchlist order chosen in the reorder panel, then close it.
    async reorderWatchlist(orderedSymbols: string[]): Promise<void> {
      const roomId = state.activeRoomId;
      if (roomId && options.service.reorderWatchlist) {
        await options.service.reorderWatchlist(roomId, orderedSymbols);
        await loadRoomSnapshot(roomId);
      }
      watchReorderOpen = false;
      emitSnapshotChange();
    },

    // Dismiss the reorder panel without persisting any change.
    closeWatchReorder(): void {
      watchReorderOpen = false;
      emitSnapshotChange();
    },

    async handleLine(line: string, reply?: ReplyMetadata): Promise<ChatSessionSnapshot> {
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
            body: parsed.body,
            metadata: reply
              ? {
                  replyTo: reply.replyTo,
                  replyToName: reply.replyToName,
                  replyToSnippet: reply.replyToSnippet
                }
              : undefined
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

function toRoomSummary(room: ServiceRoomSummary | RoomWithCountRow): RoomSummary {
  const withCount = room as RoomWithCountRow;
  return {
    id: room.id,
    name: room.name,
    memberCount: withCount.member_count === undefined ? undefined : Number(withCount.member_count),
    isMember: withCount.is_member
  };
}

function toChatMessage(message: ChatMessageRow): ChatMessage {
  return {
    id: message.id,
    roomId: message.room_id,
    senderId: message.sender_id,
    senderName: message.sender_display_name ?? message.sender_id,
    senderColor: message.sender_display_color,
    kind: message.kind,
    body: message.body,
    metadata: message.metadata,
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
    name: quote.name,
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
  display_name_taken: 'That name is already taken. Pick another with /name <new name>.',
  invite_code_required: 'An invite code is required to register: /start <email> <invite-code>.',
  invalid_invite_code: 'That invite code is invalid, used, or expired.',
  not_admin: 'Only the admin can create global invite codes. Inside a room you own, /invite-code creates a room invite.',
  not_room_owner: 'Only the room owner can do that.',
  invite_code_not_found: 'No unused invite code of yours matches that value.',
  profile_not_found: 'No active profile with that nickname.'
};

function translateServiceError(message: string): string {
  // Node's `fetch` reports transport-layer failures (offline, DNS, reset host)
  // as `TypeError: fetch failed`. Show a friendly hint instead of the raw error.
  if (/fetch failed|network|enotfound|econnrefused|econnreset|etimedout/i.test(message)) {
    return 'Network error — check your connection and try again.';
  }

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

const startUsageStatus = 'Usage: /start <email> [invite-code].';
const signedOutStatus =
  'Use /start <email> to log in, or /start <email> <invite-code> to register.';

function signedInStatus(user: HychatUser): string {
  return `Signed in as ${user.displayName} (${user.role}). Change your name any time with /name <new name>.`;
}

// Turn a provider failure reason into short, human text for the status line.
function describeQuoteFailure(reason: string): string {
  if (reason === 'symbol_not_found') return 'not found';
  if (reason.startsWith('provider_http_')) return 'provider error';
  return reason;
}

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

function memberStatusDot(status: MemberView['status']): string {
  if (status === 'active') return '●';
  if (status === 'online') return '◉';
  return '○';
}

// Plain-text member roster for the status line: one member per line with a
// presence dot, the owner tag, and a typing mark. StatusText caps at 8 lines.
function formatMemberList(members: MemberView[]): string {
  if (members.length === 0) {
    return 'No members in this room yet.';
  }
  const visible = members.slice(0, 6);
  const hiddenCount = members.length - visible.length;
  const lines = visible.map((member) => {
    const typing = member.typing ? ' ✎' : '';
    return `  ${memberStatusDot(member.status)} ${member.displayName ?? member.userId}${typing}`;
  });
  if (hiddenCount > 0) {
    lines.push(`  +${hiddenCount} more`);
  }
  return `Members (${members.length}):\n${lines.join('\n')}\n● active  ◉ online  ○ away`;
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
    ...visible.map((room, index) => {
      const count = room.memberCount === undefined ? '' : ` (${room.memberCount})`;
      const joined = room.isMember ? ' (joined)' : '';
      return `  ${index + 1}. ${room.name}${count}${joined}`;
    })
  ];
  const hint = 'Join any with /join <number|room name>.';
  lines.push(hiddenCount > 0 ? `  +${hiddenCount} more. ${hint}` : hint);
  return lines.join('\n');
}
