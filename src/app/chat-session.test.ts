import { describe, expect, it, vi } from 'vitest';

import { parseChatInput } from '../chat/commands.js';
import { buildPendingStatusText, createChatSession } from './chat-session.js';

function createService() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const user = {
    id: 'user-1',
    displayName: 'liudong',
    displayColor: 'white',
    role: 'admin' as const,
    status: 'active' as const
  };
  const room = { id: 'room-1', name: 'Friends' };

  return {
    calls,
    service: {
      async getCurrentUser(): Promise<typeof user | null> {
        calls.push({ method: 'getCurrentUser', args: [] });
        return null;
      },
      async sendOtp(email: string) {
        calls.push({ method: 'sendOtp', args: [email] });
      },
      async verifyOtp(email: string, code: string) {
        calls.push({ method: 'verifyOtp', args: [email, code] });
      },
      async verifyOtpLink(tokenHash: string) {
        calls.push({ method: 'verifyOtpLink', args: [tokenHash] });
      },
      async setSessionTokens(accessToken: string, refreshToken: string) {
        calls.push({ method: 'setSessionTokens', args: [accessToken, refreshToken] });
      },
      async getAuthEmail(): Promise<string | null> {
        calls.push({ method: 'getAuthEmail', args: [] });
        return null;
      },
      async ensureProfile(inviteCode?: string) {
        calls.push({ method: 'ensureProfile', args: [inviteCode] });
        return { ...user };
      },
      async setDisplayName(displayName: string) {
        calls.push({ method: 'setDisplayName', args: [displayName] });
        user.displayName = displayName;
        return { ...user };
      },
      async signOut() {
        calls.push({ method: 'signOut', args: [] });
      },
      async createInviteCode() {
        calls.push({ method: 'createInviteCode', args: [] });
        return 'invite123';
      },
      async listInviteCodes() {
        calls.push({ method: 'listInviteCodes', args: [] });
        return [
          {
            code: 'invite123',
            room_name: 'Friends',
            used_by_display_name: null,
            used_at: null,
            expires_at: '2026-07-10T00:00:00.000Z'
          },
          {
            code: 'used456',
            room_name: null,
            used_by_display_name: 'alice',
            used_at: '2026-06-09T00:00:00.000Z',
            expires_at: '2026-07-09T00:00:00.000Z'
          }
        ];
      },
      async revokeInviteCode(code: string) {
        calls.push({ method: 'revokeInviteCode', args: [code] });
      },
      async listRoomsWithCounts() {
        calls.push({ method: 'listRoomsWithCounts', args: [] });
        return [{ ...room, member_count: 2, is_member: true }];
      },
      async createRoom(name: string, userId: string) {
        calls.push({ method: 'createRoom', args: [name, userId] });
        return room;
      },
      async joinRoom(roomId: string) {
        calls.push({ method: 'joinRoom', args: [roomId] });
      },
      async leaveRoom(roomId: string) {
        calls.push({ method: 'leaveRoom', args: [roomId] });
      },
      async listMembers(roomId: string) {
        calls.push({ method: 'listMembers', args: [roomId] });
        return [
          {
            room_id: roomId,
            user_id: 'user-1',
            display_name: 'liudong',
            display_color: 'white',
            role: 'owner' as const,
            created_at: '2026-06-06T08:00:00.000Z'
          },
          {
            room_id: roomId,
            user_id: 'user-2',
            display_name: 'alice',
            display_color: 'rose',
            role: 'member' as const,
            created_at: '2026-06-06T08:01:00.000Z'
          }
        ];
      },
      async listRecentMessages(roomId: string) {
        calls.push({ method: 'listRecentMessages', args: [roomId] });
        return [
          {
            id: 'message-1',
            room_id: roomId,
            sender_id: 'user-1',
            sender_display_name: 'liudong',
            sender_display_color: 'white',
            kind: 'text' as const,
            body: 'hello',
            created_at: '2026-06-06T08:00:00.000Z'
          }
        ];
      },
      async sendTextMessage(input: unknown) {
        calls.push({ method: 'sendTextMessage', args: [input] });
        return {
          id: 'message-2',
          room_id: room.id,
          sender_id: user.id,
          sender_display_name: user.displayName,
          sender_display_color: user.displayColor,
          kind: 'text' as const,
          body: (input as { body: string }).body,
          created_at: '2026-06-06T08:02:00.000Z'
        };
      },
      async updateProfileColor(color: string) {
        calls.push({ method: 'updateProfileColor', args: [color] });
        user.displayColor = color;
        return { ...user };
      },
      async listWatchlist(roomId: string) {
        calls.push({ method: 'listWatchlist', args: [roomId] });
        return [
          {
            room_id: roomId,
            canonical_symbol: 'AAPL.US',
            added_by: 'user-1',
            created_at: '2026-06-06T08:00:00.000Z'
          }
        ];
      },
      async addWatchSymbol(input: unknown) {
        calls.push({ method: 'addWatchSymbol', args: [input] });
      },
      async removeWatchSymbol(roomId: string, symbol: string) {
        calls.push({ method: 'removeWatchSymbol', args: [roomId, symbol] });
      },
      async getQuotes(symbols: string[], force: boolean) {
        calls.push({ method: 'getQuotes', args: [symbols, force] });
        return {
          quotes: [{ symbol: 'AAPL.US', price: 123, changePercent: 1.2, cacheStatus: 'hit' }],
          failed: []
        };
      }
    }
  };
}

async function signIn(session: { handleLine: (line: string) => Promise<unknown> }) {
  await session.handleLine('/start ld@example.com invite123');
  await session.handleLine('/verify 482913');
}

describe('createChatSession', () => {
  it('sends an OTP on /start and registers a new profile on /verify', async () => {
    const { service, calls } = createService();
    const session = createChatSession({ service });

    let snapshot = await session.handleLine('/start ld@example.com invite123');

    expect(snapshot.user).toBeNull();
    expect(snapshot.statusText).toBe(
      'Code sent to ld@example.com. Run /verify with the code or link from the email.'
    );
    expect(calls).toEqual(
      expect.arrayContaining([{ method: 'sendOtp', args: ['ld@example.com'] }])
    );

    snapshot = await session.handleLine('/verify 482913');

    expect(snapshot.user?.id).toBe('user-1');
    expect(snapshot.statusText).toBe(
      'Signed in as liudong (admin). Change your name any time with /name <new name>.'
    );
    expect(snapshot.state.rooms).toEqual([
      { id: 'room-1', name: 'Friends', memberCount: 2, isMember: true }
    ]);
    expect(calls).toEqual(
      expect.arrayContaining([
        { method: 'verifyOtp', args: ['ld@example.com', '482913'] },
        { method: 'ensureProfile', args: ['invite123'] },
        { method: 'listRoomsWithCounts', args: [] }
      ])
    );
  });

  it('welcomes back an existing profile after /verify', async () => {
    const { service, calls } = createService();
    let verified = false;
    service.getCurrentUser = async () => {
      calls.push({ method: 'getCurrentUser', args: [] });
      return verified
        ? {
            id: 'user-1',
            displayName: 'liudong',
            displayColor: 'white',
            role: 'admin' as const,
            status: 'active' as const
          }
        : null;
    };
    service.verifyOtp = async (email: string, code: string) => {
      calls.push({ method: 'verifyOtp', args: [email, code] });
      verified = true;
    };
    const session = createChatSession({ service });

    await session.handleLine('/start ld@example.com');
    const snapshot = await session.handleLine('/verify 482913');

    expect(snapshot.user?.displayName).toBe('liudong');
    expect(snapshot.statusText).toBe('Welcome back, liudong.');
    expect(calls.filter((call) => call.method === 'ensureProfile')).toEqual([]);
  });

  it('accepts a pasted login link in /verify', async () => {
    const { service, calls } = createService();
    const session = createChatSession({ service });

    await session.handleLine('/start ld@example.com');
    await session.handleLine(
      '/verify https://example.supabase.co/auth/v1/verify?token=pkce_abc123&type=magiclink&redirect_to=http://localhost:3000'
    );

    expect(calls).toEqual(
      expect.arrayContaining([{ method: 'verifyOtpLink', args: ['pkce_abc123'] }])
    );
    expect(calls.some((call) => call.method === 'verifyOtp')).toBe(false);
  });

  it('rejects /verify before /start', async () => {
    const { service } = createService();
    const session = createChatSession({ service });

    const snapshot = await session.handleLine('/verify 482913');

    expect(snapshot.statusText).toBe('Run /start <email> first to request a code.');
  });

  it('logs in from a pasted post-click redirect URL without /start', async () => {
    const { service, calls } = createService();
    let signedIn = false;
    service.setSessionTokens = async (accessToken: string, refreshToken: string) => {
      calls.push({ method: 'setSessionTokens', args: [accessToken, refreshToken] });
      signedIn = true;
    };
    service.getCurrentUser = async () => {
      calls.push({ method: 'getCurrentUser', args: [] });
      return signedIn
        ? {
            id: 'user-1',
            displayName: 'liudong',
            displayColor: 'white',
            role: 'admin' as const,
            status: 'active' as const
          }
        : null;
    };
    const session = createChatSession({ service });

    const snapshot = await session.handleLine(
      '/verify http://localhost:3000/#access_token=header.payload.sig&expires_at=123&refresh_token=tdy4agjcmwcg&token_type=bearer&type=signup'
    );

    expect(calls).toEqual(
      expect.arrayContaining([
        { method: 'setSessionTokens', args: ['header.payload.sig', 'tdy4agjcmwcg'] }
      ])
    );
    expect(snapshot.statusText).toBe('Welcome back, liudong.');
  });

  it('surfaces the invite-code error when a brand-new email registers without one', async () => {
    const { service } = createService();
    service.ensureProfile = async () => {
      throw new Error('invite_code_required');
    };
    const session = createChatSession({ service });

    await session.handleLine('/start ld@example.com');
    const snapshot = await session.handleLine('/verify 482913');

    expect(snapshot.user).toBeNull();
    expect(snapshot.statusText).toBe(
      'An invite code is required to register: /start <email> <invite-code>.'
    );
  });

  it('registers without resending an email when already authenticated', async () => {
    const { service, calls } = createService();
    service.getAuthEmail = async () => {
      calls.push({ method: 'getAuthEmail', args: [] });
      return 'ld@example.com';
    };
    const session = createChatSession({ service });

    const snapshot = await session.handleLine('/start ld@example.com invite123');

    expect(snapshot.user?.displayName).toBe('liudong');
    expect(snapshot.statusText).toBe(
      'Signed in as liudong (admin). Change your name any time with /name <new name>.'
    );
    expect(calls).toEqual(
      expect.arrayContaining([{ method: 'ensureProfile', args: ['invite123'] }])
    );
    expect(calls.some((call) => call.method === 'sendOtp')).toBe(false);
  });

  it('renames the profile with /name', async () => {
    const { service, calls } = createService();
    const session = createChatSession({ service });

    await signIn(session);
    const snapshot = await session.handleLine('/name Cool Cat');

    expect(snapshot.user?.displayName).toBe('Cool Cat');
    expect(snapshot.statusText).toBe('Name set to Cool Cat.');
    expect(calls).toEqual(
      expect.arrayContaining([{ method: 'setDisplayName', args: ['Cool Cat'] }])
    );
  });

  it('rejects /name before signing in', async () => {
    const { service, calls } = createService();
    const session = createChatSession({ service });

    const snapshot = await session.handleLine('/name Cool Cat');

    expect(snapshot.statusText).toBe('Please /start first.');
    expect(calls.some((call) => call.method === 'setDisplayName')).toBe(false);
  });

  it('shows usage for a bare /start', async () => {
    const { service } = createService();
    const session = createChatSession({ service });

    const snapshot = await session.handleLine('/start');

    expect(snapshot.statusText).toBe('Usage: /start <email> [invite-code].');
  });

  it('starts with an invite code and can create an invite code as admin', async () => {
    const { service, calls } = createService();
    const session = createChatSession({ service });

    await signIn(session);
    const snapshot = await session.handleLine('/invite-code');

    expect(snapshot.statusText).toBe(
      'Invite code: invite123 (lets one friend register; they pick any room with /rooms then /join)'
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        { method: 'ensureProfile', args: ['invite123'] },
        { method: 'createInviteCode', args: [] }
      ])
    );
  });

  it('lists all rooms with member counts and a joined marker when /rooms runs', async () => {
    const { service } = createService();
    const session = createChatSession({ service });

    await signIn(session);
    const snapshot = await session.handleLine('/rooms');

    expect(snapshot.statusText).toContain('Rooms (1):');
    expect(snapshot.statusText).toContain('1. Friends (2) (joined)');
    expect(snapshot.statusText).toContain('/join <number|room name>');
  });

  it('self-joins any room by its /rooms list number', async () => {
    const { service, calls } = createService();
    const session = createChatSession({ service });

    await signIn(session);
    await session.handleLine('/rooms');
    const snapshot = await session.handleLine('/join 1');

    expect(snapshot.statusText).toBe('Joined Friends.');
    expect(snapshot.state.activeRoomId).toBe('room-1');
    expect(calls).toEqual(
      expect.arrayContaining([{ method: 'joinRoom', args: ['room-1'] }])
    );
  });

  it('rejects a /join number that is out of range', async () => {
    const { service } = createService();
    const session = createChatSession({ service });

    await signIn(session);
    const snapshot = await session.handleLine('/join 5');

    expect(snapshot.statusText).toBe('Unknown room: 5');
  });

  it('lists and revokes invite codes', async () => {
    const { service, calls } = createService();
    const session = createChatSession({ service });

    await signIn(session);
    let snapshot = await session.handleLine('/invite-code list');

    expect(snapshot.statusText).toContain('invite123');
    expect(snapshot.statusText).toContain('room:Friends');
    expect(snapshot.statusText).toContain('unused');
    expect(snapshot.statusText).toContain('used456');
    expect(snapshot.statusText).toContain('used by alice');

    snapshot = await session.handleLine('/invite-code revoke invite123');

    expect(snapshot.statusText).toBe('Invite code invite123 revoked.');
    expect(calls).toEqual(
      expect.arrayContaining([
        { method: 'listInviteCodes', args: [] },
        { method: 'revokeInviteCode', args: ['invite123'] }
      ])
    );
  });

  it('requires explicit confirmation before logout', async () => {
    const { service, calls } = createService();
    const session = createChatSession({ service });

    await signIn(session);
    let snapshot = await session.handleLine('/logout');

    expect(snapshot.statusText).toContain('log back in with /start <email>');
    expect(snapshot.statusText).toContain('/logout confirm');
    expect(snapshot.user?.id).toBe('user-1');
    expect(calls.some((call) => call.method === 'signOut')).toBe(false);

    snapshot = await session.handleLine('/logout confirm');

    expect(snapshot.statusText).toBe('Signed out.');
    expect(snapshot.user).toBeNull();
    expect(calls.some((call) => call.method === 'signOut')).toBe(true);
  });

  it('creates a room, joins it, sends messages, and refreshes watched quotes', async () => {
    const { service, calls } = createService();
    const session = createChatSession({ service });

    await signIn(session);
    let snapshot = await session.handleLine('/create Friends');
    expect(snapshot.state.activeRoomId).toBe('room-1');
    expect(snapshot.state.membersByRoom['room-1']).toEqual([
      {
        roomId: 'room-1',
        userId: 'user-1',
        displayName: 'liudong',
        displayColor: 'white',
        role: 'owner'
      },
      {
        roomId: 'room-1',
        userId: 'user-2',
        displayName: 'alice',
        displayColor: 'rose',
        role: 'member'
      }
    ]);

    snapshot = await session.handleLine('/watch add AAPL.US');
    expect(snapshot.state.watchlistByRoom['room-1']).toEqual(['AAPL.US']);
    expect(snapshot.state.quotesBySymbol['AAPL.US']).toEqual(
      expect.objectContaining({ price: 123 })
    );

    await session.handleLine('hello from terminal');

    expect(snapshot.state.messagesByRoom['room-1']?.[0]?.senderName).toBe('liudong');
    expect(calls).toEqual(
      expect.arrayContaining([
        { method: 'createRoom', args: ['Friends', 'user-1'] },
        {
          method: 'addWatchSymbol',
          args: [{ roomId: 'room-1', symbol: 'AAPL.US', addedBy: 'user-1' }]
        },
        {
          method: 'sendTextMessage',
          args: [{ roomId: 'room-1', senderId: 'user-1', body: 'hello from terminal' }]
        },
        {
          method: 'listMembers',
          args: ['room-1']
        }
      ])
    );
  });

  it('appends the sent message without reloading room data', async () => {
    const { service, calls } = createService();
    const session = createChatSession({ service });

    await signIn(session);
    await session.handleLine('/join Friends');
    calls.length = 0;

    const snapshot = await session.handleLine('fast local echo');

    expect(snapshot.state.messagesByRoom['room-1']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'message-2',
          senderName: 'liudong',
          body: 'fast local echo'
        })
      ])
    );
    expect(calls).toEqual([
      {
        method: 'sendTextMessage',
        args: [{ roomId: 'room-1', senderId: 'user-1', body: 'fast local echo' }]
      }
    ]);
  });

  it('lists members with presence dots in the members command', async () => {
    const { service } = createService();
    const session = createChatSession({ service });

    await signIn(session);
    await session.handleLine('/join Friends');
    const snapshot = await session.handleLine('/members');

    // The current user (liudong) is online by definition; alice has no presence.
    expect(snapshot.statusText).toContain('Members (2):');
    expect(snapshot.statusText).toContain('liudong');
    expect(snapshot.statusText).toContain('alice');
    expect(snapshot.statusText).not.toContain('(owner');
    expect(snapshot.statusText).toContain('● active'); // legend present
  });

  it('shows and updates the current profile color', async () => {
    const { service, calls } = createService();
    const session = createChatSession({ service });

    await signIn(session);
    let snapshot = await session.handleLine('/color');
    expect(snapshot.statusText).toContain('Current color: white');
    expect(snapshot.statusText).toContain('1:red');

    snapshot = await session.handleLine('/color set rose');

    expect(snapshot.user?.displayColor).toBe('rose');
    expect(snapshot.statusText).toBe('Color set to rose.');
    expect(calls).toEqual(
      expect.arrayContaining([{ method: 'updateProfileColor', args: ['rose'] }])
    );
  });

  it('shows command usage, parameters, and descriptions in help', async () => {
    const { service } = createService();
    const session = createChatSession({ service });

    const snapshot = await session.handleLine('/help');

    expect(snapshot.statusText).toContain('Start');
    expect(snapshot.statusText).toContain('/start <email> [invite-code]');
    expect(snapshot.statusText).toContain('/name <new name>');
    expect(snapshot.statusText).toContain('/verify <code>');
    expect(snapshot.statusText).toContain('Sends a code to your email');
    expect(snapshot.statusText).toContain('/create <room name>');
    expect(snapshot.statusText).toContain('Create a room');
    expect(snapshot.statusText).toContain('/invite-code');
    expect(snapshot.statusText).not.toContain('/invite <nickname>');
    expect(snapshot.statusText).toContain('/watch add <symbol>');
    expect(snapshot.statusText).toContain('Add a stock');
    expect(snapshot.statusText).toContain('/refresh [symbol]');
    expect(snapshot.statusText).toContain('Refresh watched stock quotes');
    expect(snapshot.statusText).toContain('/color set <color>');
    expect(snapshot.statusText).toContain('/quit');
  });

  it('subscribes to realtime updates when a room is joined', async () => {
    const { service } = createService();
    const realtime = {
      subscribeToRoom: vi.fn(() => ({ unsubscribe: vi.fn() }))
    };
    const session = createChatSession({ service, realtime });

    await signIn(session);
    await session.handleLine('/join Friends');

    expect(realtime.subscribeToRoom).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        onMessage: expect.any(Function),
        onWatchlistChange: expect.any(Function),
        onMembersChange: expect.any(Function),
        onQuoteChange: expect.any(Function)
      })
    );
  });

  it('reloads members and emits a snapshot when membership changes', async () => {
    const { service, calls } = createService();
    let membersHandler: (() => void) | undefined;
    const onSnapshotChange = vi.fn();
    const realtime = {
      subscribeToRoom: vi.fn((_roomId, handlers) => {
        membersHandler = handlers.onMembersChange;
        return { unsubscribe: vi.fn() };
      })
    };
    const session = createChatSession({ service, realtime, onSnapshotChange });

    await signIn(session);
    await session.handleLine('/join Friends');
    onSnapshotChange.mockClear();
    const listMemberCallsBefore = calls.filter((c) => c.method === 'listMembers').length;

    membersHandler?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(
      calls.filter((c) => c.method === 'listMembers').length
    ).toBe(listMemberCallsBefore + 1);
    expect(onSnapshotChange).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({
          membersByRoom: expect.objectContaining({
            'room-1': expect.arrayContaining([
              expect.objectContaining({ displayName: 'liudong' })
            ])
          })
        })
      })
    );
  });

  it('leaves the active room, unsubscribes, and returns to the room list', async () => {
    const { service, calls } = createService();
    const unsubscribe = vi.fn();
    const realtime = {
      subscribeToRoom: vi.fn(() => ({ unsubscribe }))
    };
    const session = createChatSession({ service, realtime });

    await signIn(session);
    await session.handleLine('/join Friends');
    const snapshot = await session.handleLine('/leave');

    expect(calls.some((c) => c.method === 'leaveRoom' && c.args[0] === 'room-1')).toBe(true);
    expect(unsubscribe).toHaveBeenCalled();
    expect(snapshot.state.activeRoomId).toBeUndefined();
    expect(snapshot.statusText).toContain('Left');
  });

  it('applies realtime presence to the online member set', async () => {
    const { service } = createService();
    let presenceHandler: ((onlineUserIds: string[]) => void) | undefined;
    const onSnapshotChange = vi.fn();
    const realtime = {
      subscribeToRoom: vi.fn((_roomId, handlers) => {
        presenceHandler = handlers.onPresenceChange;
        return { unsubscribe: vi.fn(), sendFocus: vi.fn() };
      })
    };
    const session = createChatSession({ service, realtime, onSnapshotChange });

    await signIn(session);
    await session.handleLine('/join Friends');
    onSnapshotChange.mockClear();

    presenceHandler?.(['user-1', 'user-2']);

    expect(onSnapshotChange).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({
          onlineByRoom: expect.objectContaining({ 'room-1': ['user-1', 'user-2'] })
        })
      })
    );
  });

  it('applies a remote focus broadcast to the active member set', async () => {
    const { service } = createService();
    let focusHandler: ((userId: string, active: boolean) => void) | undefined;
    const onSnapshotChange = vi.fn();
    const realtime = {
      subscribeToRoom: vi.fn((_roomId, handlers) => {
        focusHandler = handlers.onFocus;
        return { unsubscribe: vi.fn(), sendFocus: vi.fn() };
      })
    };
    const session = createChatSession({ service, realtime, onSnapshotChange });

    await signIn(session);
    await session.handleLine('/join Friends');
    onSnapshotChange.mockClear();

    focusHandler?.('user-2', true);

    expect(onSnapshotChange).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({
          activeByRoom: expect.objectContaining({ 'room-1': ['user-2'] })
        })
      })
    );
  });

  it('broadcasts the current focus on join and when notified', async () => {
    const { service } = createService();
    const sendFocus = vi.fn();
    const realtime = {
      subscribeToRoom: vi.fn(() => ({ unsubscribe: vi.fn(), sendFocus }))
    };
    const session = createChatSession({ service, realtime });

    await signIn(session);
    await session.handleLine('/join Friends');

    session.notifyFocus(false);
    expect(sendFocus).toHaveBeenCalledWith(false);
    session.notifyFocus(true);
    expect(sendFocus).toHaveBeenCalledWith(true);
  });

  it('marks a remote user typing and clears it when their message arrives', async () => {
    const { service } = createService();
    let typingHandler: ((userId: string) => void) | undefined;
    let messageHandler: ((message: { id: string; room_id: string; sender_id: string; kind: 'text'; body: string; created_at: string }) => void) | undefined;
    const realtime = {
      subscribeToRoom: vi.fn((_roomId, handlers) => {
        typingHandler = handlers.onTyping;
        messageHandler = handlers.onMessage;
        return { unsubscribe: vi.fn() };
      })
    };
    let latest: Awaited<ReturnType<typeof session.handleLine>> | undefined;
    const session = createChatSession({
      service,
      realtime,
      onSnapshotChange: (snapshot) => {
        latest = snapshot;
      }
    });

    await signIn(session);
    await session.handleLine('/join Friends');

    typingHandler?.('user-2');
    expect(latest?.state.typingByRoom['room-1']).toEqual(['user-2']);

    messageHandler?.({
      id: 'm-1',
      room_id: 'room-1',
      sender_id: 'user-2',
      kind: 'text',
      body: 'hi',
      created_at: '2026-06-06T08:05:00.000Z'
    });
    expect(latest?.state.typingByRoom['room-1']).toEqual([]);
  });

  it('throttles outgoing typing broadcasts', async () => {
    const { service } = createService();
    const sendTyping = vi.fn();
    const realtime = {
      subscribeToRoom: vi.fn(() => ({ unsubscribe: vi.fn(), sendTyping }))
    };
    const session = createChatSession({ service, realtime });

    await signIn(session);
    await session.handleLine('/join Friends');

    session.notifyTyping();
    session.notifyTyping();

    expect(sendTyping).toHaveBeenCalledTimes(1);
  });

  it('applies realtime quote updates to the visible quote map', async () => {
    const { service } = createService();
    let quoteHandler:
      | ((quote: {
          canonical_symbol: string;
          price?: number | null;
          change_percent?: number | null;
        }) => void)
      | undefined;
    const onSnapshotChange = vi.fn();
    const realtime = {
      subscribeToRoom: vi.fn((_roomId, handlers) => {
        quoteHandler = handlers.onQuoteChange;
        return { unsubscribe: vi.fn() };
      })
    };
    const session = createChatSession({ service, realtime, onSnapshotChange });

    await signIn(session);
    await session.handleLine('/join Friends');
    onSnapshotChange.mockClear();

    quoteHandler?.({
      canonical_symbol: 'AAPL.US',
      price: 222.5,
      change_percent: 2.1
    });

    expect(onSnapshotChange).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({
          quotesBySymbol: expect.objectContaining({
            'AAPL.US': expect.objectContaining({ price: 222.5, changePercent: 2.1 })
          })
        })
      })
    );
  });

  it('emits a fresh snapshot when realtime messages arrive', async () => {
    const { service } = createService();
    let messageHandler:
      | ((message: {
          id: string;
          room_id: string;
          sender_id: string;
          sender_display_name?: string;
          sender_display_color?: string;
          kind: 'text' | 'system';
          body: string;
          created_at: string;
        }) => void)
      | undefined;
    const onSnapshotChange = vi.fn();
    const realtime = {
      subscribeToRoom: vi.fn((_roomId, handlers) => {
        messageHandler = handlers.onMessage;
        return { unsubscribe: vi.fn() };
      })
    };
    const session = createChatSession({ service, realtime, onSnapshotChange });

    await signIn(session);
    await session.handleLine('/join Friends');
    onSnapshotChange.mockClear();

    messageHandler?.({
      id: 'message-2',
      room_id: 'room-1',
      sender_id: 'user-2',
      sender_display_name: 'test',
      sender_display_color: 'rose',
      kind: 'text',
      body: 'from another terminal',
      created_at: '2026-06-06T08:02:00.000Z'
    });

    expect(onSnapshotChange).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({
          messagesByRoom: expect.objectContaining({
            'room-1': expect.arrayContaining([
              expect.objectContaining({
                id: 'message-2',
                senderName: 'test',
                senderColor: 'rose',
                body: 'from another terminal'
              })
            ])
          })
        })
      })
    );
  });

  it('emits a pending status snapshot before a slow command resolves', async () => {
    const { service } = createService();
    let resolveSendOtp: (() => void) | undefined;
    service.sendOtp = () =>
      new Promise<void>((resolve) => {
        resolveSendOtp = resolve;
      });
    const onSnapshotChange = vi.fn();
    const session = createChatSession({ service, onSnapshotChange });

    const result = session.handleLine('/start ld@example.com');
    await Promise.resolve();

    expect(onSnapshotChange).toHaveBeenCalledWith(
      expect.objectContaining({ statusText: 'Signing in…', isBusy: true })
    );

    resolveSendOtp?.();
    const snapshot = await result;
    expect(snapshot.statusText).toBe(
      'Code sent to ld@example.com. Run /verify with the code or link from the email.'
    );
    expect(snapshot.isBusy).toBe(false);
  });

  it('does not emit a pending status for local commands', async () => {
    const { service } = createService();
    const onSnapshotChange = vi.fn();
    const session = createChatSession({ service, onSnapshotChange });

    await session.handleLine('/help');
    await session.handleLine('');
    await session.handleLine('/nope');

    expect(onSnapshotChange).not.toHaveBeenCalled();
  });
});

describe('buildPendingStatusText', () => {
  it.each([
    ['hello there', 'Sending…'],
    ['/start ld@example.com', 'Signing in…'],
    ['/start ld@example.com invite123', 'Signing in…'],
    ['/verify 482913', 'Verifying…'],
    ['/name Cool Cat', 'Saving name…'],
    ['/logout confirm', 'Signing out…'],
    ['/rooms', 'Loading rooms…'],
    ['/create My Room', 'Creating room My Room…'],
    ['/join Friends', 'Joining Friends…'],
    ['/invite-code', 'Creating invite code…'],
    ['/invite-code list', 'Loading invite codes…'],
    ['/invite-code revoke invite123', 'Revoking invite code…'],
    ['/members', 'Loading members…'],
    ['/watch add AAPL.US', 'Adding AAPL.US…'],
    ['/watch remove AAPL.US', 'Removing AAPL.US…'],
    ['/stock AAPL.US', 'Loading AAPL.US…'],
    ['/refresh', 'Refreshing quotes…'],
    ['/color set rose', 'Saving color…']
  ])('maps %s to a pending status', (input, expected) => {
    expect(buildPendingStatusText(parseChatInput(input))).toBe(expected);
  });

  it.each([
    [''],
    ['/help'],
    ['/quit'],
    ['/logout'],
    ['/start'],
    ['/color'],
    ['/color list'],
    ['/nope']
  ])('returns null for instant input %s', (input) => {
    expect(buildPendingStatusText(parseChatInput(input))).toBeNull();
  });
});
