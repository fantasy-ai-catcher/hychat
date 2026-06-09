import { describe, expect, it, vi } from 'vitest';

import { createChatSession } from './chat-session.js';

function createService() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const user = { id: 'user-1', displayName: 'liudong', role: 'admin' as const, status: 'active' as const };
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
      async listRecentMessages(roomId: string) {
        calls.push({ method: 'listRecentMessages', args: [roomId] });
        return [
          {
            id: 'message-1',
            room_id: roomId,
            sender_id: 'user-1',
            sender_display_name: 'liudong',
            kind: 'text' as const,
            body: 'hello',
            created_at: '2026-06-06T08:00:00.000Z'
          }
        ];
      },
      async sendTextMessage(input: unknown) {
        calls.push({ method: 'sendTextMessage', args: [input] });
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
        }
      ])
    );
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
});
