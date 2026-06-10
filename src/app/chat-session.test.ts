import { describe, expect, it, vi } from 'vitest';

import { createChatSession } from './chat-session.js';

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
      async getCurrentUser() {
        calls.push({ method: 'getCurrentUser', args: [] });
        return null;
      },
      async startProfile(displayName: string, inviteCode?: string) {
        calls.push({ method: 'startProfile', args: [displayName, inviteCode] });
        return user;
      },
      async signOut() {
        calls.push({ method: 'signOut', args: [] });
      },
      async createInviteCode() {
        calls.push({ method: 'createInviteCode', args: [] });
        return 'invite123';
      },
      async listRooms() {
        calls.push({ method: 'listRooms', args: [] });
        return [room];
      },
      async createRoom(name: string, userId: string) {
        calls.push({ method: 'createRoom', args: [name, userId] });
        return room;
      },
      async inviteMember(roomId: string, displayName: string) {
        calls.push({ method: 'inviteMember', args: [roomId, displayName] });
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

describe('createChatSession', () => {
  it('starts an anonymous profile with the default nickname and loads rooms', async () => {
    const { service, calls } = createService();
    const session = createChatSession({ service, defaultDisplayName: 'liudong' });

    const snapshot = await session.handleLine('/start');

    expect(snapshot.user?.id).toBe('user-1');
    expect(snapshot.user?.displayName).toBe('liudong');
    expect(snapshot.user?.displayColor).toBe('white');
    expect(snapshot.state.rooms).toEqual([{ id: 'room-1', name: 'Friends' }]);
    expect(calls).toEqual(
      expect.arrayContaining([
        { method: 'startProfile', args: ['liudong', undefined] },
        { method: 'listRooms', args: [] }
      ])
    );
  });

  it('starts with an invite code and can create an invite code as admin', async () => {
    const { service, calls } = createService();
    const session = createChatSession({ service });

    let snapshot = await session.handleLine('/start alice invite123');
    expect(snapshot.statusText).toBe('Started as liudong (admin).');

    snapshot = await session.handleLine('/invite-code');

    expect(snapshot.statusText).toBe('Invite code: invite123');
    expect(calls).toEqual(
      expect.arrayContaining([
        { method: 'startProfile', args: ['alice', 'invite123'] },
        { method: 'createInviteCode', args: [] }
      ])
    );
  });

  it('creates a room, joins it, sends messages, and refreshes watched quotes', async () => {
    const { service, calls } = createService();
    const session = createChatSession({ service });

    await session.handleLine('/start liudong');
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

    await session.handleLine('/start liudong');
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

  it('shows member nicknames in the members command', async () => {
    const { service } = createService();
    const session = createChatSession({ service });

    await session.handleLine('/start liudong');
    await session.handleLine('/join Friends');
    const snapshot = await session.handleLine('/members');

    expect(snapshot.statusText).toBe('owner:liudong member:alice');
  });

  it('shows and updates the current profile color', async () => {
    const { service, calls } = createService();
    const session = createChatSession({ service });

    await session.handleLine('/start liudong');
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
    expect(snapshot.statusText).toContain('/start [nickname] [invite-code]');
    expect(snapshot.statusText).toContain('Activate this terminal user');
    expect(snapshot.statusText).toContain('/create <room name>');
    expect(snapshot.statusText).toContain('Create a room');
    expect(snapshot.statusText).toContain('/invite <nickname>');
    expect(snapshot.statusText).toContain('Invite an active profile');
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

    await session.handleLine('/start liudong');
    await session.handleLine('/join Friends');

    expect(realtime.subscribeToRoom).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        onMessage: expect.any(Function),
        onWatchlistChange: expect.any(Function)
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

    await session.handleLine('/start liudong');
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
});
