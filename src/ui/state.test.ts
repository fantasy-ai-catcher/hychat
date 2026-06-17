import { describe, expect, it } from 'vitest';

import {
  buildWelcomeLines,
  computeMemberStatuses,
  createInitialAppState,
  formatBeijingTime,
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

  it('tracks online + focus presence and clears room-scoped state on leave', () => {
    let state = reducer(createInitialAppState(), { type: 'room-joined', roomId: 'room-1' });
    state = reducer(state, {
      type: 'presence-synced',
      roomId: 'room-1',
      userIds: ['user-1', 'user-2']
    });
    state = reducer(state, { type: 'focus-changed', roomId: 'room-1', userId: 'user-1', active: true });
    state = reducer(state, { type: 'typing-started', roomId: 'room-1', userId: 'user-2' });

    expect(state.onlineByRoom['room-1']).toEqual(['user-1', 'user-2']);
    expect(state.activeByRoom['room-1']).toEqual(['user-1']);
    expect(state.typingByRoom['room-1']).toEqual(['user-2']);

    // A member dropping out of presence loses their active mark.
    const afterLeave = reducer(state, {
      type: 'presence-synced',
      roomId: 'room-1',
      userIds: ['user-2']
    });
    expect(afterLeave.activeByRoom['room-1']).toEqual([]);

    const left = reducer(state, { type: 'room-left', roomId: 'room-1' });
    expect(left.activeRoomId).toBeUndefined();
    expect(left.onlineByRoom['room-1']).toBeUndefined();
    expect(left.activeByRoom['room-1']).toBeUndefined();
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

  it('distinguishes active, online, and offline', () => {
    // user-1 connected + focused, user-2 connected + unfocused, no presence for the rest.
    const result = computeMemberStatuses(members, ['user-1', 'user-2'], ['user-1'], []);
    expect(result.map((m) => [m.userId, m.status])).toEqual([
      ['user-1', 'active'],
      ['user-2', 'online']
    ]);
  });

  it('marks members absent from presence as offline', () => {
    const result = computeMemberStatuses(members, ['user-1'], ['user-1'], []);
    expect(result.find((m) => m.userId === 'user-2')?.status).toBe('offline');
  });

  it('only shows typing for an online member', () => {
    const result = computeMemberStatuses(members, ['user-1'], [], ['user-1', 'user-2']);
    expect(result.find((m) => m.userId === 'user-1')?.typing).toBe(true);
    // user-2 is typing in the set but offline, so it must not surface.
    expect(result.find((m) => m.userId === 'user-2')?.typing).toBe(false);
  });

  it('treats the current user as online (or active) without waiting on presence', () => {
    // Empty presence set, but user-2 is the current client.
    const online = computeMemberStatuses(members, [], [], [], { currentUserId: 'user-2' });
    expect(online.find((m) => m.userId === 'user-2')?.status).toBe('online');
    expect(online.find((m) => m.userId === 'user-1')?.status).toBe('offline');

    const active = computeMemberStatuses(members, [], [], [], {
      currentUserId: 'user-2',
      currentUserActive: true
    });
    expect(active.find((m) => m.userId === 'user-2')?.status).toBe('active');
  });
});

describe('formatBeijingTime', () => {
  it('converts a UTC timestamp to Beijing MM-DD HH:MM (UTC+8)', () => {
    // 07:25 UTC -> 15:25 Beijing, same day.
    expect(formatBeijingTime('2026-06-17T07:25:36.435592+00:00')).toBe('06-17 15:25');
  });

  it('handles a Z-suffixed UTC timestamp', () => {
    expect(formatBeijingTime('2026-06-15T12:24:10.618966Z')).toBe('06-15 20:24');
  });

  it('rolls the date forward when Beijing crosses a day boundary', () => {
    // 18:00 UTC on 06-17 -> 02:00 Beijing on 06-18; the date makes this visible.
    expect(formatBeijingTime('2026-06-17T18:00:00+00:00')).toBe('06-18 02:00');
  });

  it('renders midnight as 00:00, not 24:00', () => {
    // 16:00 UTC -> 00:00 next-day Beijing.
    expect(formatBeijingTime('2026-06-17T16:00:00+00:00')).toBe('06-18 00:00');
  });

  it('respects an explicit offset, not the wall-clock digits', () => {
    // 15:25 at +08:00 is already Beijing time.
    expect(formatBeijingTime('2026-06-17T15:25:00+08:00')).toBe('06-17 15:25');
  });

  it('returns an empty string for an unparseable input', () => {
    expect(formatBeijingTime('not a date')).toBe('');
    expect(formatBeijingTime('')).toBe('');
  });
});
