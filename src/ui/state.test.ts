import { describe, expect, it } from 'vitest';

import {
  buildWelcomeLines,
  computeMemberStatuses,
  createInitialAppState,
  reducer,
  resolveShellView
} from './state.js';

describe('UI state reducer', () => {
  it('loads rooms and joins a room', () => {
    const state = reducer(createInitialAppState(), {
      type: 'rooms-loaded',
      rooms: [{ id: 'room-1', name: 'Friends' }]
    });

    expect(state.rooms).toEqual([{ id: 'room-1', name: 'Friends' }]);

    expect(reducer(state, { type: 'room-joined', roomId: 'room-1' }).activeRoomId).toBe(
      'room-1'
    );
  });

  it('tracks presence and clears room-scoped state on leave', () => {
    let state = reducer(createInitialAppState(), { type: 'room-joined', roomId: 'room-1' });
    state = reducer(state, {
      type: 'presence-synced',
      roomId: 'room-1',
      userIds: ['user-1', 'user-2']
    });
    state = reducer(state, { type: 'typing-started', roomId: 'room-1', userId: 'user-2' });

    expect(state.onlineByRoom['room-1']).toEqual(['user-1', 'user-2']);
    expect(state.typingByRoom['room-1']).toEqual(['user-2']);

    const left = reducer(state, { type: 'room-left', roomId: 'room-1' });
    expect(left.activeRoomId).toBeUndefined();
    expect(left.onlineByRoom['room-1']).toBeUndefined();
    expect(left.typingByRoom['room-1']).toBeUndefined();
  });

  it('adds and removes typing users without duplicates', () => {
    let state = reducer(createInitialAppState(), {
      type: 'typing-started',
      roomId: 'room-1',
      userId: 'user-2'
    });
    state = reducer(state, { type: 'typing-started', roomId: 'room-1', userId: 'user-2' });
    expect(state.typingByRoom['room-1']).toEqual(['user-2']);

    state = reducer(state, { type: 'typing-stopped', roomId: 'room-1', userId: 'user-2' });
    expect(state.typingByRoom['room-1']).toEqual([]);
  });

  it('appends received messages per room', () => {
    const state = reducer(createInitialAppState(), {
      type: 'message-received',
      message: {
        id: 'message-1',
        roomId: 'room-1',
        senderId: 'user-1',
        senderName: 'liudong',
        body: 'hello',
        createdAt: '2026-06-06T08:00:00.000Z'
      }
    });

    expect(state.messagesByRoom['room-1']).toHaveLength(1);
  });

  it('ignores duplicate received messages by id', () => {
    const message = {
      id: 'message-1',
      roomId: 'room-1',
      senderId: 'user-1',
      senderName: 'liudong',
      body: 'hello',
      createdAt: '2026-06-06T08:00:00.000Z'
    };
    const state = reducer(
      reducer(createInitialAppState(), {
        type: 'message-received',
        message
      }),
      {
        type: 'message-received',
        message
      }
    );

    expect(state.messagesByRoom['room-1']).toEqual([message]);
  });

  it('replaces messages when a room is reloaded', () => {
    const initial = reducer(createInitialAppState(), {
      type: 'message-received',
      message: {
        id: 'old-message',
        roomId: 'room-1',
        senderId: 'user-1',
        senderName: 'liudong',
        body: 'old',
        createdAt: '2026-06-06T08:00:00.000Z'
      }
    });

    const state = reducer(initial, {
      type: 'messages-loaded',
      roomId: 'room-1',
      messages: [
        {
          id: 'new-message',
          roomId: 'room-1',
          senderId: 'user-2',
          senderName: 'alice',
          body: 'new',
          createdAt: '2026-06-06T08:01:00.000Z'
        }
      ]
    });

    expect(state.messagesByRoom['room-1']).toEqual([
      {
        id: 'new-message',
        roomId: 'room-1',
        senderId: 'user-2',
        senderName: 'alice',
        body: 'new',
        createdAt: '2026-06-06T08:01:00.000Z'
      }
    ]);
  });

  it('updates watchlist and quotes', () => {
    const state = reducer(
      reducer(createInitialAppState(), {
        type: 'watchlist-updated',
        roomId: 'room-1',
        symbols: ['AAPL.US', '0700.HK']
      }),
      {
        type: 'quotes-updated',
        quotes: [
          {
            symbol: 'AAPL.US',
            price: 123,
            changePercent: 1.2,
            cacheStatus: 'hit'
          }
        ]
      }
    );

    expect(state.watchlistByRoom['room-1']).toEqual(['AAPL.US', '0700.HK']);
    expect(state.quotesBySymbol['AAPL.US']).toEqual({
      symbol: 'AAPL.US',
      price: 123,
      changePercent: 1.2,
      cacheStatus: 'hit'
    });
  });

  it('stores room members per room', () => {
    const state = reducer(createInitialAppState(), {
      type: 'members-loaded',
      roomId: 'room-1',
      members: [
        {
          roomId: 'room-1',
          userId: 'user-1',
          displayName: 'liudong',
          role: 'owner'
        },
        {
          roomId: 'room-1',
          userId: 'user-2',
          displayName: 'alice',
          role: 'member'
        }
      ]
    });

    expect(state.membersByRoom['room-1']).toEqual([
      {
        roomId: 'room-1',
        userId: 'user-1',
        displayName: 'liudong',
        role: 'owner'
      },
      {
        roomId: 'room-1',
        userId: 'user-2',
        displayName: 'alice',
        role: 'member'
      }
    ]);
  });

  it('tracks connection status', () => {
    expect(
      reducer(createInitialAppState(), {
        type: 'connection-changed',
        status: 'connected'
      }).connectionStatus
    ).toBe('connected');
  });
});

describe('resolveShellView', () => {
  it('returns welcome when no room is active', () => {
    expect(resolveShellView(createInitialAppState())).toBe('welcome');
  });

  it('returns chat when a room is active', () => {
    const state = reducer(
      reducer(createInitialAppState(), {
        type: 'rooms-loaded',
        rooms: [{ id: 'room-1', name: 'Friends' }]
      }),
      { type: 'room-joined', roomId: 'room-1' }
    );

    expect(resolveShellView(state)).toBe('chat');
  });
});

describe('buildWelcomeLines', () => {
  it('walks a new user through start, rooms, and join', () => {
    const lines = buildWelcomeLines();
    const text = lines.join('\n');

    expect(lines[0]).toBe('Get started:');
    expect(text).toContain('/start <email> [invite-code]');
    expect(text).toContain('/verify <code or pasted link>');
    expect(text).toContain('/join <room>');
    expect(text).toContain('/help');
    expect(text).not.toContain('undefined');
  });

  it('greets a started user and suggests room commands', () => {
    const lines = buildWelcomeLines('liudong');
    const text = lines.join('\n');

    expect(lines[0]).toBe('Hi liudong! You are not in a room yet.');
    expect(text).not.toContain('/start');
    expect(text).toContain('/rooms');
    expect(text).toContain('/create <room name>');
    expect(text).toContain('/join <room>');
    expect(text).toContain('/help');
  });
});

describe('computeMemberStatuses', () => {
  const members = [
    { roomId: 'room-1', userId: 'user-1', displayName: 'alice', role: 'owner' as const },
    { roomId: 'room-1', userId: 'user-2', displayName: 'bob', role: 'member' as const }
  ];

  it('marks members in the presence set online and the rest offline', () => {
    const result = computeMemberStatuses(members, ['user-1'], []);
    expect(result.map((m) => [m.userId, m.status])).toEqual([
      ['user-1', 'online'],
      ['user-2', 'offline']
    ]);
  });

  it('only shows typing for an online member', () => {
    const result = computeMemberStatuses(members, ['user-1'], ['user-1', 'user-2']);
    expect(result.find((m) => m.userId === 'user-1')?.typing).toBe(true);
    // user-2 is typing in the set but offline, so it must not surface.
    expect(result.find((m) => m.userId === 'user-2')?.typing).toBe(false);
  });
});
